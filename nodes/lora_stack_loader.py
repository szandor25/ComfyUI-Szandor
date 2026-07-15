import json
import os
from pathlib import Path

import comfy.sd
import comfy.utils
import folder_paths
from aiohttp import web
from server import PromptServer


THUMBNAIL_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")


def _available_loras():
    return folder_paths.get_filename_list("loras")


def _thumbnail_for_lora(lora_name):
    """Return a sidecar image with the same stem as an installed LoRA."""
    if not lora_name or lora_name not in _available_loras():
        return None

    lora_path = folder_paths.get_full_path("loras", lora_name)
    if not lora_path:
        return None

    lora_file = Path(lora_path)
    try:
        files_by_name = {
            child.name.lower(): child
            for child in lora_file.parent.iterdir()
            if child.is_file()
        }
    except OSError:
        return None

    for extension in THUMBNAIL_EXTENSIONS:
        thumbnail = files_by_name.get(f"{lora_file.stem}{extension}".lower())
        if thumbnail:
            return thumbnail
    return None


@PromptServer.instance.routes.get("/szandor/loras")
async def list_loras(_request):
    return web.json_response({"loras": _available_loras()})


@PromptServer.instance.routes.get("/szandor/lora-thumbnail")
async def lora_thumbnail(request):
    thumbnail = _thumbnail_for_lora(request.query.get("name", ""))
    if thumbnail is None:
        raise web.HTTPNotFound(text="Brak miniatury dla tej LoRA")
    return web.FileResponse(
        path=os.fspath(thumbnail),
        headers={"Cache-Control": "no-cache"},
    )


class SzandorLoraStackLoader:
    """Apply an ordered, UI-managed collection of LoRAs to MODEL and CLIP."""

    def __init__(self):
        self._cached_path = None
        self._cached_lora = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "lora_stack": ("STRING", {"default": "[]"}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP")
    RETURN_NAMES = ("model", "clip")
    FUNCTION = "apply_loras"
    CATEGORY = "Moje Nody/LoRA"

    @staticmethod
    def _parse_stack(value):
        try:
            rows = json.loads(value or "[]")
        except (TypeError, json.JSONDecodeError) as error:
            raise ValueError("Nieprawidłowe dane listy LoRA w workflow.") from error

        if not isinstance(rows, list):
            raise ValueError("Lista LoRA musi być tablicą JSON.")
        return rows

    def _load_lora(self, path):
        if path != self._cached_path:
            self._cached_lora = comfy.utils.load_torch_file(path, safe_load=True)
            self._cached_path = path
        return self._cached_lora

    def apply_loras(self, model, clip, lora_stack):
        available = set(_available_loras())
        for row in self._parse_stack(lora_stack):
            if not isinstance(row, dict) or not row.get("enabled", True):
                continue

            name = row.get("name", "")
            if name not in available:
                raise FileNotFoundError(f"Nie znaleziono LoRA: {name}")

            try:
                strength = float(row.get("strength", 1.0))
            except (TypeError, ValueError) as error:
                raise ValueError(f"Nieprawidłowa siła LoRA: {name}") from error

            strength = max(-4.0, min(4.0, strength))
            if strength == 0.0:
                continue

            path = folder_paths.get_full_path("loras", name)
            if not path:
                raise FileNotFoundError(f"Nie znaleziono LoRA: {name}")

            model, clip = comfy.sd.load_lora_for_models(
                model,
                clip,
                self._load_lora(path),
                strength,
                strength,
            )

        return model, clip


NODE_CLASS_MAPPINGS = {"SzandorLoraStackLoader": SzandorLoraStackLoader}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SzandorLoraStackLoader": "LoRA Stack z miniaturami (Szandor)"
}
