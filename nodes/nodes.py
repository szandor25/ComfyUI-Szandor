import os
import torch
import numpy as np
from PIL import Image, ImageOps

# Ulepszona funkcja pomocnicza - teraz zwraca obraz i maskę
def load_image_with_mask(path):
    i = Image.open(path)
    i = ImageOps.exif_transpose(i)

    # 1. Przetwarzanie obrazu (RGB)
    image = i.convert("RGB")
    image = np.array(image).astype(np.float32) / 255.0
    image = torch.from_numpy(image)[None,]

    # 2. Przetwarzanie maski
    if 'A' in i.getbands():
        # Jeśli obraz ma kanał alfa, wyciągamy go
        mask = np.array(i.getchannel('A')).astype(np.float32) / 255.0
        # W ComfyUI maska 1.0 oznacza obszar zakryty, więc odwracamy (jeśli trzeba)
        mask = 1. - torch.from_numpy(mask)
    else:
        # Jeśli nie ma kanału alfa, tworzymy pustą czarną maskę o wymiarach obrazu
        mask = torch.zeros((i.size[1], i.size[0]), dtype=torch.float32)

    return image, mask[None,]

class BatchImageLoaderWithName:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "directory_path": ("STRING", {"default": "C:\\Sciezka\\Do\\Zdjec"}),
                "index": ("INT", {"default": 0, "min": 0, "max": 99999, "step": 1}),
            }
        }

    # Dodano MASK do typów zwracanych
    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("image", "mask", "filename_text")
    FUNCTION = "load_batch_images"
    CATEGORY = "Moje Nody"

    def load_batch_images(self, directory_path, index):
        if not os.path.isdir(directory_path):
            raise FileNotFoundError(f"Katalog nie istnieje: {directory_path}")

        valid_extensions = ('.png', '.jpg', '.jpeg', '.bmp', '.webp')
        files = sorted([
            f for f in os.listdir(directory_path)
            if f.lower().endswith(valid_extensions)
        ])

        if not files:
            raise FileNotFoundError("Brak obrazków w podanym katalogu.")

        file_to_load = files[index % len(files)]
        image_path = os.path.join(directory_path, file_to_load)

        # Używamy nowej funkcji, która zwraca image i mask
        image, mask = load_image_with_mask(image_path)

        filename_without_ext = os.path.splitext(file_to_load)[0]

        return (image, mask, filename_without_ext)

class SaveTextFile:
    def __init__(self):
        import folder_paths
        self.output_dir = folder_paths.get_output_directory()

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "filename": ("STRING", {"forceInput": True}),
                "text_content": ("STRING", {"forceInput": True}),
                "custom_path": ("STRING", {"default": "", "multiline": False, "placeholder": "Opcjonalnie: C:\\Inny\\Folder (puste = folder output)"}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "save_text"
    OUTPUT_NODE = True
    CATEGORY = "Moje Nody"

    def save_text(self, filename, text_content, custom_path):
        if custom_path.strip() != "":
            target_dir = custom_path
            if not os.path.exists(target_dir):
                os.makedirs(target_dir)
        else:
            target_dir = self.output_dir

        full_path = os.path.join(target_dir, f"{filename}.txt")
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(text_content)

        print(f"Zapisano opis dla: {filename}")
        return {}

class TextDirectoryLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "directory_path": ("STRING", {"default": "C:/prompty"}),
                "index": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "INT")
    RETURN_NAMES = ("text", "filename", "total_files")
    FUNCTION = "load_text"
    CATEGORY = "Moje Nody"

    def load_text(self, directory_path, index):
        if not os.path.isdir(directory_path):
            return ("Folder nie istnieje!", "", 0)

        files = sorted([f for f in os.listdir(directory_path) if f.endswith('.txt')])

        if not files:
            return ("Brak plików .txt w folderze", "", 0)

        actual_index = index % len(files)
        file_path = os.path.join(directory_path, files[actual_index])

        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        return (content, files[actual_index], len(files))

NODE_CLASS_MAPPINGS = {
    "BatchImageLoaderWithName": BatchImageLoaderWithName,
    "SaveTextFile": SaveTextFile,
    "TextDirectoryLoader": TextDirectoryLoader
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BatchImageLoaderWithName": "Batch Image Loader (Folder)",
    "SaveTextFile": "Save Text File (Custom Path)",
    "TextDirectoryLoader": "Text Batch Loader (Folder)"
}