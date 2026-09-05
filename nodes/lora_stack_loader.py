import json
import math
import os
from pathlib import Path

import comfy.sd
import comfy.utils
import folder_paths
from aiohttp import web
from server import PromptServer


THUMBNAIL_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
MAX_METADATA_BYTES = 16 * 1024 * 1024


def _trigger_text(value):
    if isinstance(value, str):
        # Safetensors metadata may contain a JSON-encoded list.
        if value.lstrip().startswith("["):
            try:
                return _trigger_text(json.loads(value))
            except json.JSONDecodeError:
                pass
        return value.strip()
    if isinstance(value, list):
        return ", ".join(dict.fromkeys(
            word.strip() for word in value if isinstance(word, str) and word.strip()
        ))
    return ""


def _metadata_triggers(metadata):
    if not isinstance(metadata, dict):
        return ""
    for key in ("trainedWords", "triggerWords", "trigger_words", "activation text",
                "activation_text", "ss_trigger_words"):
        text = _trigger_text(metadata.get(key))
        if text:
            return text
    # LoRA Manager also stores manually selected, local words under "civitai".
    for key in ("modelVersion", "civitai"):
        nested = metadata.get(key)
        text = _metadata_triggers(nested) if isinstance(nested, dict) else ""
        if text:
            return text
    return ""


def _training_suggestions(metadata):
    """Expose training words for selection, without silently activating them."""
    def decoded(key):
        value = metadata.get(key)
        if isinstance(value, str):
            try:
                return json.loads(value)
            except (ValueError, RecursionError):
                return None
        return value

    class_tokens = []
    datasets = decoded("ss_datasets")
    for dataset in datasets if isinstance(datasets, list) else []:
        subsets = dataset.get("subsets") if isinstance(dataset, dict) else None
        for subset in subsets if isinstance(subsets, list) else []:
            token = _trigger_text(subset.get("class_tokens")) if isinstance(subset, dict) else ""
            if token and token not in class_tokens:
                class_tokens.append(token)

    frequencies = {}
    groups = decoded("ss_tag_frequency")
    for tags in groups.values() if isinstance(groups, dict) else []:
        if not isinstance(tags, dict):
            continue
        for word, count in tags.items():
            if not isinstance(word, str) or not word.strip():
                continue
            if isinstance(count, bool) or not isinstance(count, (int, float)):
                continue
            if count < 0 or not math.isfinite(count):
                continue
            word = word.strip()
            frequencies[word] = frequencies.get(word, 0) + count
    suggestions = [{"text": word, "source": "class_tokens"} for word in class_tokens]
    suggestions.extend(
        {"text": word, "source": "ss_tag_frequency", "count": count}
        for word, count in sorted(frequencies.items(), key=lambda item: (-item[1], item[0]))
        if word not in class_tokens
    )
    return suggestions


def _safetensors_metadata(lora_file):
    if lora_file.suffix.lower() != ".safetensors":
        return {}
    try:
        # Only read the bounded JSON header, never the tensor payload.
        with lora_file.open("rb") as stream:
            size_bytes = stream.read(8)
            size = int.from_bytes(size_bytes, "little")
            if len(size_bytes) == 8 and 0 < size <= MAX_METADATA_BYTES:
                header = json.loads(stream.read(size))
                metadata = header.get("__metadata__") if isinstance(header, dict) else None
                return metadata if isinstance(metadata, dict) else {}
    except (OSError, UnicodeError, ValueError, RecursionError):
        pass
    return {}


def _triggers_for_lora(lora_name):
    """Read saved triggers and offer separate candidates from training metadata."""
    result = {"trigger": "", "source": "", "suggestions": []}
    if not lora_name or lora_name not in _available_loras():
        return result
    path = folder_paths.get_full_path("loras", lora_name)
    if not path:
        return result
    lora_file = Path(path)
    metadata = _safetensors_metadata(lora_file)
    result["suggestions"] = _training_suggestions(metadata)
    for suffix in (".trigger.txt", ".metadata.json", ".civitai.info", ".info", ".json"):
        sidecar = lora_file.with_suffix(suffix)
        try:
            with sidecar.open("rb") as stream:
                raw = stream.read(MAX_METADATA_BYTES + 1)
            if len(raw) > MAX_METADATA_BYTES:
                continue
            content = raw.decode("utf-8-sig")
            trigger = content.strip() if suffix == ".trigger.txt" else _metadata_triggers(json.loads(content))
            if trigger:
                result.update(trigger=trigger, source=sidecar.name)
                return result
        except (OSError, UnicodeError, ValueError, RecursionError):
            continue
    trigger = _metadata_triggers(metadata)
    if trigger:
        result.update(trigger=trigger, source="metadane safetensors")
    return result


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


@PromptServer.instance.routes.get("/szandor/lora-triggers")
async def lora_triggers(request):
    import asyncio

    name = request.query.get("name", "")
    if name not in _available_loras():
        raise web.HTTPNotFound(text="Nie znaleziono LoRA")
    return web.json_response(await asyncio.to_thread(_triggers_for_lora, name))


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
            },
            "optional": {
                "prompt": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING", "STRING")
    RETURN_NAMES = ("model", "clip", "trigger_words", "prompt_with_triggers")
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

    def apply_loras(self, model, clip, lora_stack, prompt=""):
        available = set(_available_loras())
        triggers = []
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

            strength = max(0.0, min(2.0, strength))
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
            if row.get("use_trigger", False):
                trigger = row.get("trigger")
                if trigger is None:
                    trigger = _triggers_for_lora(name)["trigger"]
                trigger = _trigger_text(trigger)
                if trigger and trigger not in triggers:
                    triggers.append(trigger)

        trigger_words = ", ".join(triggers)
        combined_prompt = ", ".join(part for part in (trigger_words, prompt) if part)
        return model, clip, trigger_words, combined_prompt


NODE_CLASS_MAPPINGS = {"SzandorLoraStackLoader": SzandorLoraStackLoader}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SzandorLoraStackLoader": "LoRA Stack z miniaturami (Szandor)"
}
