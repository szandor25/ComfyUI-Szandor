import torch

MAX_SLOTS = 30


def _blank() -> torch.Tensor:
    return torch.zeros(1, 8, 8, 3)


class ImagePassthrough:
    MAX_SLOTS = MAX_SLOTS

    @classmethod
    def INPUT_TYPES(cls):
        inputs: dict = {
            "required": {
                "slot_count": ("INT", {
                    "default": 2,
                    "min": 1,
                    "max": cls.MAX_SLOTS,
                    "step": 1,
                    "display": "slider",
                }),
            },
            "optional": {},
        }
        for i in range(1, cls.MAX_SLOTS + 1):
            inputs["optional"][f"in_{i}"] = ("IMAGE",)
        return inputs

    RETURN_TYPES = tuple(["IMAGE"] * MAX_SLOTS)
    RETURN_NAMES = tuple([f"out_{i}" for i in range(1, MAX_SLOTS + 1)])
    FUNCTION = "passthrough"
    CATEGORY = "Moje Nody"

    def passthrough(self, slot_count: int, **kwargs):
        results = []
        for i in range(1, self.MAX_SLOTS + 1):
            img = kwargs.get(f"in_{i}")
            results.append(img if (i <= slot_count and img is not None) else _blank())
        return tuple(results)


NODE_CLASS_MAPPINGS = {"ImagePassthrough": ImagePassthrough}
NODE_DISPLAY_NAME_MAPPINGS = {"ImagePassthrough": "Image Passthrough (Szandor)"}
