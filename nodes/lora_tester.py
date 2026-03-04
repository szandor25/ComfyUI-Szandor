import os
import torch
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import folder_paths
import comfy.utils
import comfy.sd
import json
from PIL.PngImagePlugin import PngInfo

# Globalny magazyn na dane, aby przetrwały między krokami generowania
GRID_ACCUMULATOR = {
    "images": [],
    "labels": []
}

class LoraTesterSelector:
    @classmethod
    def INPUT_TYPES(s):
        # Pobieramy listę LoRA i dodajemy opcję "None"
        lora_list = ["None"] + folder_paths.get_filename_list("loras")
        
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "strengths": ("STRING", {"multiline": False, "default": "0.6, 0.8, 1.0"}),
                "index": ("INT", {"default": 0, "min": 0, "max": 10000}),
                # 5 stałych slotów rozwijanych
                "lora_1": (lora_list, {"default": "None"}),
                "lora_2": (lora_list, {"default": "None"}),
                "lora_3": (lora_list, {"default": "None"}),
                "lora_4": (lora_list, {"default": "None"}),
                "lora_5": (lora_list, {"default": "None"}),
            },
            "optional": {
                # Pole tekstowe na dodatkowe LoRy (wpisywane ręcznie nazwa pod nazwą)
                "extra_loras": ("STRING", {"multiline": True, "default": ""}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING", "INT")
    RETURN_NAMES = ("MODEL", "CLIP", "label", "total_combos")
    FUNCTION = "select_lora"
    CATEGORY = "Moje_Nody"

    def select_lora(self, model, clip, strengths, index, lora_1, lora_2, lora_3, lora_4, lora_5, extra_loras=""):
        # 1. Zbieramy LoRy ze slotów (pomijamy "None")
        selected_loras = []
        for lora in [lora_1, lora_2, lora_3, lora_4, lora_5]:
            if lora != "None":
                selected_loras.append(lora)
        
        # 2. Dodajemy te z pola tekstowego (jeśli są)
        if extra_loras.strip():
            for line in extra_loras.split('\n'):
                name = line.strip()
                if name:
                    # Jeśli użytkownik zapomniał rozszerzenia, spróbujemy je dodać
                    if not name.endswith(".safetensors") and not name.endswith(".ckpt"):
                        name += ".safetensors"
                    selected_loras.append(name)

        # 3. Parsujemy siły
        s_text = strengths.replace(',', ' ')
        strength_list = [float(s) for s in s_text.split() if s.strip()]
        if not strength_list: strength_list = [1.0]

        # 4. Budujemy listę wszystkich kombinacji
        combinations = []
        for l_name in selected_loras:
            for s_val in strength_list:
                combinations.append((l_name, s_val))
        
        total = len(combinations)
        if total == 0:
            return (model, clip, "No LoRA Selected", 0)

        # 5. Wybieramy aktualną kombinację
        current_idx = index % total
        selected_lora, selected_strength = combinations[current_idx]

        # 6. Ładowanie wybranej LoRA
        lora_path = folder_paths.get_full_path("loras", selected_lora)
        if lora_path and os.path.exists(lora_path):
            lora_data = comfy.utils.load_torch_file(lora_path)
            model, clip = comfy.sd.load_lora_for_models(model, clip, lora_data, selected_strength, selected_strength)
            print(f"LoRA Tester: [{current_idx+1}/{total}] Testing: {selected_lora} @ {selected_strength}")
        else:
            print(f"!!! BŁĄD: Nie znaleziono pliku {selected_lora}")

        label = f"{selected_lora}\nStr: {selected_strength}"
        return (model, clip, label, total)

class LoraGridSaver:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",),
                "label": ("STRING", {"forceInput": True}),
                "index": ("INT", {"default": 0, "min": 0, "max": 10000}),
                "total": ("INT", {"forceInput": True}),
                "columns": ("INT", {"default": 3}),
                "filename_prefix": ("STRING", {"default": "LoRA_Test"}),
            },
            # Te dwa pola poniżej pozwalają ComfyUI automatycznie przesłać metadane
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "Moje_Nody"

    def save(self, image, label, index, total, columns, filename_prefix, prompt=None, extra_pnginfo=None):
        global GRID_ACCUMULATOR
        
        if index == 0:
            GRID_ACCUMULATOR["images"] = []
            GRID_ACCUMULATOR["labels"] = []
            # Zapisujemy metadane tylko raz (z pierwszego obrazka w serii)
            GRID_ACCUMULATOR["prompt"] = prompt
            GRID_ACCUMULATOR["extra_pnginfo"] = extra_pnginfo

        i = 255. * image[0].cpu().numpy()
        img_pil = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
        GRID_ACCUMULATOR["images"].append(img_pil)
        GRID_ACCUMULATOR["labels"].append(label)

        if len(GRID_ACCUMULATOR["images"]) >= total and total > 0:
            self.create_grid(columns, filename_prefix)
            
        return (image,)

    def create_grid(self, cols, prefix):
        imgs = GRID_ACCUMULATOR["images"]
        lbls = GRID_ACCUMULATOR["labels"]
        n = len(imgs)
        rows = (n + cols - 1) // cols
        w, h = imgs[0].size
        
        grid = Image.new('RGB', (cols * w, rows * h), (0,0,0))
        draw = ImageDraw.Draw(grid)
        
        font_size = 60
        font = None
        for font_name in ["arial.ttf", "DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:\\Windows\\Fonts\\arialbd.ttf"]:
            try:
                font = ImageFont.truetype(font_name, font_size)
                break
            except:
                continue
        
        if font is None:
            font = ImageFont.load_default()

        for i, img in enumerate(imgs):
            x, y = (i % cols) * w, (i // cols) * h
            grid.paste(img, (x, y))
            txt = lbls[i]
            offset = 2 
            for ox, oy in [(-offset, -offset), (offset, -offset), (-offset, offset), (offset, offset)]:
                draw.text((x + 20 + ox, y + 20 + oy), txt, fill="black", font=font)
            draw.text((x + 20, y + 20), txt, fill="white", font=font)

        # --- OBSŁUGA METADANYCH ---
        metadata = PngInfo()
        if GRID_ACCUMULATOR["prompt"] is not None:
            metadata.add_text("prompt", json.dumps(GRID_ACCUMULATOR["prompt"]))
        if GRID_ACCUMULATOR["extra_pnginfo"] is not None:
            for r in GRID_ACCUMULATOR["extra_pnginfo"]:
                metadata.add_text(r, json.dumps(GRID_ACCUMULATOR["extra_pnginfo"][r]))
        # ---------------------------

        out = folder_paths.get_output_directory()
        import time
        ts = time.strftime("%Y%m%d-%H%M%S")
        save_path = os.path.join(out, f"{prefix}_{ts}.png")
        
        # Zapisujemy obraz z metadanymi
        grid.save(save_path, pnginfo=metadata)
        print(f"*** GRID ZAPISANY Z METADANYMI: {save_path} ***")



NODE_CLASS_MAPPINGS = {
    "LoraTesterSelector": LoraTesterSelector,
    "LoraGridSaver": LoraGridSaver
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoraTesterSelector": "LoRA Tester Selector (XYZ)",
    "LoraGridSaver": "LoRA Grid Saver (XYZ)"
}
