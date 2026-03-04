import os
import torch
import numpy as np
import requests
from PIL import Image
from io import BytesIO
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

class QwenImageGenNode:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "default": "A majestic dragon flying over a futuristic city, high detail, 8k"}),
                "aspect_ratio": ([
                    "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"
                ], {"default": "1:1"}),
                "model": ([
                    "wan2.1-t2i-14b",
                    "wan2.1-t2i-turbo",
                    "qwen-vl-max-2025-12", # jeśli używasz modelu multimodalnego
                ], {"default": "wan2.1-t2i-14b"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "negative_prompt": ("STRING", {"multiline": True, "default": "low resolution, blurry, distorted"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "final_prompt")
    FUNCTION = "generate_image"
    CATEGORY = "LLM/Alibaba"

    def generate_image(self, prompt, aspect_ratio, model, seed, negative_prompt=""):
        api_key = os.getenv("DASHSCOPE_API_KEY")
        if not api_key:
            raise Exception("Brak DASHSCOPE_API_KEY w zmiennych środowiskowych!")

        # Mapowanie rozdzielczości zgodnie z Twoim życzeniem
        aspect_ratios = {
            "1:1": (1328, 1328),
            "16:9": (1664, 928),
            "9:16": (928, 1664),
            "4:3": (1472, 1104),
            "3:4": (1104, 1472),
            "3:2": (1584, 1056),
            "2:3": (1056, 1584),
        }

        width, height = aspect_ratios.get(aspect_ratio, (1328, 1328))

        # Przygotowanie klienta OpenAI (kompatybilny z DashScope)
        client = OpenAI(
            api_key=api_key,
            base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        )

        try:
            # Wywołanie generowania obrazu
            # Uwaga: Modele Wan2.1/Qwen Image używają endpointu images.generate
            response = client.images.generate(
                model=model,
                prompt=prompt,
                n=1,
                size=f"{width}*{height}", # Format specyficzny dla Wan2.1
                extra_body={
                    "seed": seed,
                }
            )

            image_url = response.data[0].url

            # Pobieranie obrazu z URL
            img_response = requests.get(image_url)
            img = Image.open(BytesIO(img_response.content)).convert("RGB")

            # Konwersja PIL Image -> Torch Tensor (format ComfyUI)
            image_np = np.array(img).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_np)[None, ...]

            return (image_tensor, prompt)

        except Exception as e:
            print(f"Błąd podczas generowania obrazu: {str(e)}")
            raise e

# Rejestracja noda
NODE_CLASS_MAPPINGS = {
    "QwenImageGenNode": QwenImageGenNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "QwenImageGenNode": "Alibaba Wan2.1/Qwen Image Gen"
}