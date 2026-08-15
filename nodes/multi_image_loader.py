import os
import hashlib
import torch
import numpy as np
from PIL import Image, ImageOps
import folder_paths

MAX_IMAGES = 16


def _load_image_tensor(image_name: str) -> torch.Tensor:
    path = folder_paths.get_annotated_filepath(image_name)
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    img = img.convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]


def _blank() -> torch.Tensor:
    return torch.zeros(1, 8, 8, 3)


class MultiImageLoader:
    MAX_IMAGES = MAX_IMAGES

    @classmethod
    def INPUT_TYPES(cls):
        inputs: dict = {
            "required": {
                "image_count": ("INT", {
                    "default": 2,
                    "min": 1,
                    "max": cls.MAX_IMAGES,
                    "step": 1,
                    "display": "slider",
                }),
            },
            "optional": {},
        }
        for i in range(1, cls.MAX_IMAGES + 1):
            inputs["optional"][f"image_{i:02d}"] = ("STRING", {"default": ""})
        return inputs

    RETURN_TYPES = tuple(["IMAGE"] * MAX_IMAGES)
    RETURN_NAMES = tuple([f"obraz_{i}" for i in range(1, MAX_IMAGES + 1)])
    FUNCTION = "load_images"
    CATEGORY = "Moje Nody"

    def load_images(self, image_count: int, **kwargs):
        results = []
        for i in range(1, self.MAX_IMAGES + 1):
            val = (kwargs.get(f"image_{i:02d}") or "").strip()
            if i <= image_count and val:
                try:
                    results.append(_load_image_tensor(val))
                except Exception as e:
                    print(f"[MultiImageLoader] Błąd ładowania '{val}': {e}")
                    results.append(_blank())
            else:
                results.append(_blank())
        return tuple(results)

    @classmethod
    def IS_CHANGED(cls, image_count: int, **kwargs):
        m = hashlib.md5()
        m.update(str(image_count).encode())
        for i in range(1, image_count + 1):
            val = (kwargs.get(f"image_{i:02d}") or "").strip()
            if val:
                try:
                    path = folder_paths.get_annotated_filepath(val)
                    m.update(str(os.path.getmtime(path)).encode())
                except Exception:
                    pass
        return m.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, image_count: int, **kwargs):
        for i in range(1, image_count + 1):
            val = (kwargs.get(f"image_{i:02d}") or "").strip()
            if val and not folder_paths.exists_annotated_filepath(val):
                return f"Plik nie istnieje: {val}"
        return True


NODE_CLASS_MAPPINGS = {"MultiImageLoader": MultiImageLoader}
NODE_DISPLAY_NAME_MAPPINGS = {"MultiImageLoader": "Multi Image Loader (Szandor)"}
