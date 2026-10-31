import hashlib
import os
import re

import numpy as np
import torch
from PIL import Image, ImageOps
from aiohttp import web
from server import PromptServer

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff")
SORT_OPTIONS = ["name A→Z", "name Z→A", "date modified: newest first", "date modified: oldest first"]
DEFAULT_SORT = SORT_OPTIONS[0]


def _natural_key(name):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name)]


def _list_images(directory, sort_by=DEFAULT_SORT):
    if not directory or not os.path.isdir(directory):
        return []
    entries = []
    try:
        with os.scandir(directory) as it:
            for entry in it:
                try:
                    if entry.name.lower().endswith(IMAGE_EXTENSIONS) and entry.is_file():
                        entries.append((entry.name, entry.stat().st_mtime))
                except OSError:
                    continue  # An entry may disappear during a scan.
    except OSError:
        return []
    # Sort by name first so equal dates keep a stable, natural name order.
    entries.sort(key=lambda item: _natural_key(item[0]), reverse=sort_by == "name Z→A")
    if sort_by.startswith("date modified"):
        entries.sort(key=lambda item: item[1], reverse=sort_by == "date modified: newest first")
    return [name for name, _ in entries]


def _dir_signature(directory, names):
    h = hashlib.sha1()
    for name in names:
        try:
            mtime = os.path.getmtime(os.path.join(directory, name))
        except OSError:
            mtime = 0
        h.update(f"{name}:{mtime}".encode("utf-8", "ignore"))
    return h.hexdigest()


def _resolve_in_directory(directory, filename):
    """Zwraca bezpieczną, pełną ścieżkę do pliku wewnątrz katalogu (bez podkatalogów)."""
    if not directory or not filename:
        return None
    base = os.path.abspath(directory)
    candidate = os.path.abspath(os.path.join(base, filename))
    if os.path.dirname(candidate) != base:
        return None
    if not os.path.isfile(candidate):
        return None
    return candidate


def _browse_directory(directory):
    """List one level of server folders and images without changing the selection."""
    if not directory:
        roots = ([f"{letter}:\\" for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                  if os.path.isdir(f"{letter}:\\")] if os.name == "nt" else ["/"])
        return {"directory": "", "parent": None,
                "directories": [{"name": root, "path": root} for root in roots], "images": []}

    directory = os.path.abspath(directory)
    folders, images = [], []
    with os.scandir(directory) as entries:
        for entry in entries:
            try:
                if entry.is_dir():
                    folders.append({"name": entry.name, "path": entry.path})
                elif entry.name.lower().endswith(IMAGE_EXTENSIONS) and entry.is_file():
                    images.append(entry.name)
            except OSError:
                continue  # An entry may disappear during a scan.
    folders.sort(key=lambda item: _natural_key(item["name"]))
    images.sort(key=_natural_key)
    parent = os.path.dirname(directory)
    return {"directory": directory, "parent": parent if parent != directory else "",
            "directories": folders, "images": images}


@PromptServer.instance.routes.get("/szandor/browse-directory")
async def szandor_browse_directory(request):
    directory = (request.query.get("directory") or "").strip()
    try:
        return web.json_response(_browse_directory(directory))
    except PermissionError:
        return web.json_response({"error": "Permission denied for this folder."}, status=403)
    except (FileNotFoundError, NotADirectoryError):
        return web.json_response({"error": "Folder does not exist."}, status=404)
    except (OSError, ValueError):
        return web.json_response({"error": "Could not open this folder."}, status=400)


@PromptServer.instance.routes.get("/szandor/dir-images")
async def szandor_list_dir_images(request):
    directory = (request.query.get("directory") or "").strip()
    sort_by = request.query.get("sort") or DEFAULT_SORT
    names = _list_images(directory, sort_by if sort_by in SORT_OPTIONS else DEFAULT_SORT)
    return web.json_response({
        "images": names,
        "signature": _dir_signature(directory, names) if directory else "",
    })


@PromptServer.instance.routes.get("/szandor/dir-image-view")
async def szandor_dir_image_view(request):
    directory = (request.query.get("directory") or "").strip()
    filename = (request.query.get("filename") or "").strip()
    path = _resolve_in_directory(directory, filename)
    if path is None:
        raise web.HTTPNotFound(text="File not found in the folder.")
    return web.FileResponse(path=path, headers={"Cache-Control": "no-cache"})


class SzandorDirectoryImageLoader:
    """Wczytuje pojedynczy obraz wskazany z dowolnego katalogu na dysku."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "directory": ("STRING", {"default": ""}),
                "filename": ("STRING", {"default": ""}),
            },
            "optional": {
                "sort_by": (SORT_OPTIONS, {"default": DEFAULT_SORT,
                                           "tooltip": "Order of images when stepping with the arrows."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "load"
    CATEGORY = "Szandor/Image"
    DESCRIPTION = "Loads a single image chosen from any folder on disk, with thumbnails and recent folders."

    def load(self, directory, filename, sort_by=DEFAULT_SORT):
        path = _resolve_in_directory(directory, filename)
        if path is None:
            raise FileNotFoundError(f"Image '{filename}' not found in folder '{directory}'.")

        img = Image.open(path)
        img = ImageOps.exif_transpose(img)

        if img.mode == "I":
            img = img.point(lambda i: i * (1 / 255))
        rgb = img.convert("RGB")
        arr = np.array(rgb).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(arr)[None,]

        if "A" in img.getbands():
            alpha = np.array(img.getchannel("A")).astype(np.float32) / 255.0
            mask_tensor = (1.0 - torch.from_numpy(alpha))[None,]
        elif img.mode == "P" and "transparency" in img.info:
            alpha = np.array(img.convert("RGBA").getchannel("A")).astype(np.float32) / 255.0
            mask_tensor = (1.0 - torch.from_numpy(alpha))[None,]
        else:
            mask_tensor = torch.zeros((1, 64, 64), dtype=torch.float32)

        return (image_tensor, mask_tensor)

    @classmethod
    def IS_CHANGED(cls, directory, filename, sort_by=DEFAULT_SORT):
        path = _resolve_in_directory(directory, filename)
        if path is None:
            return ""
        try:
            return str(os.path.getmtime(path))
        except OSError:
            return ""

    @classmethod
    def VALIDATE_INPUTS(cls, directory, filename):
        if not directory:
            return "No folder given."
        if not os.path.isdir(directory):
            return f"Folder does not exist: {directory}"
        if not filename:
            return "No image selected from the folder."
        if _resolve_in_directory(directory, filename) is None:
            return f"File does not exist in the folder: {filename}"
        return True


NODE_CLASS_MAPPINGS = {"SzandorDirectoryImageLoader": SzandorDirectoryImageLoader}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SzandorDirectoryImageLoader": "Load Image From Directory v2 (Szandor)"
}
