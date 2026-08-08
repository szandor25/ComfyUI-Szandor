import hashlib
import os
import re

import numpy as np
import torch
from PIL import Image, ImageOps
from aiohttp import web
from server import PromptServer

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff")


def _natural_key(name):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name)]


def _list_images(directory):
    if not directory or not os.path.isdir(directory):
        return []
    try:
        names = [
            f for f in os.listdir(directory)
            if f.lower().endswith(IMAGE_EXTENSIONS) and os.path.isfile(os.path.join(directory, f))
        ]
    except OSError:
        return []
    names.sort(key=_natural_key)
    return names


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


@PromptServer.instance.routes.get("/szandor/dir-images")
async def szandor_list_dir_images(request):
    directory = (request.query.get("directory") or "").strip()
    names = _list_images(directory)
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
        raise web.HTTPNotFound(text="Nie znaleziono pliku w katalogu.")
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
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "load"
    CATEGORY = "Moje Nody/Image"

    def load(self, directory, filename):
        path = _resolve_in_directory(directory, filename)
        if path is None:
            raise FileNotFoundError(f"Nie znaleziono obrazu '{filename}' w katalogu '{directory}'.")

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
    def IS_CHANGED(cls, directory, filename):
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
            return "Nie podano katalogu."
        if not os.path.isdir(directory):
            return f"Katalog nie istnieje: {directory}"
        if not filename:
            return "Nie wybrano obrazu z katalogu."
        if _resolve_in_directory(directory, filename) is None:
            return f"Plik nie istnieje w katalogu: {filename}"
        return True


NODE_CLASS_MAPPINGS = {"SzandorDirectoryImageLoader": SzandorDirectoryImageLoader}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SzandorDirectoryImageLoader": "Load Image From Directory v2 (Szandor)"
}
