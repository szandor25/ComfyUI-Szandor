import os
import math
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

class TextFilePickerLoader:
    _ui_directory = "C:/prompty"
    _ui_sort_by = "name"
    _ui_sort_order = "asc"
    _ui_refresh_counter = 0
    _ui_files_cache = ["<no_txt_files>"]

    @classmethod
    def _list_txt_files(cls, directory_path, sort_by="name", sort_order="asc"):
        if not os.path.isdir(directory_path):
            return []

        files = [
            f for f in os.listdir(directory_path)
            if f.lower().endswith(".txt")
        ]

        reverse = sort_order == "desc"

        if sort_by == "modified_time":
            files.sort(
                key=lambda f: os.path.getmtime(os.path.join(directory_path, f)),
                reverse=reverse
            )
        else:
            files.sort(key=lambda f: f.lower(), reverse=reverse)

        return files

    @classmethod
    def _refresh_ui_cache(cls, directory_path, sort_by="name", sort_order="asc", refresh_counter=0):
        cls._ui_directory = directory_path
        cls._ui_sort_by = sort_by
        cls._ui_sort_order = sort_order
        cls._ui_refresh_counter = refresh_counter
        files = cls._list_txt_files(directory_path, sort_by, sort_order)
        cls._ui_files_cache = files if files else ["<no_txt_files>"]

    @classmethod
    def INPUT_TYPES(cls):
        cls._refresh_ui_cache(
            cls._ui_directory,
            cls._ui_sort_by,
            cls._ui_sort_order,
            cls._ui_refresh_counter
        )

        return {
            "required": {
                "directory_path": ("STRING", {"default": cls._ui_directory}),
                "sort_by": (["name", "modified_time"], {"default": cls._ui_sort_by}),
                "sort_order": (["asc", "desc"], {"default": cls._ui_sort_order}),
                "refresh_counter": ("INT", {"default": cls._ui_refresh_counter, "min": 0, "max": 0xffffffffffffffff}),
                "selected_file": (cls._ui_files_cache, {"default": cls._ui_files_cache[0]}),
                "index_fallback": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "INT", "STRING")
    RETURN_NAMES = ("text", "filename", "total_files", "available_files")
    FUNCTION = "load_selected_text"
    CATEGORY = "Moje Nody"

    def load_selected_text(self, directory_path, sort_by, sort_order, refresh_counter, selected_file, index_fallback):
        files = self._list_txt_files(directory_path, sort_by, sort_order)
        self._refresh_ui_cache(directory_path, sort_by, sort_order, refresh_counter)

        if not os.path.isdir(directory_path):
            return ("Folder nie istnieje!", "", 0, "")

        if not files:
            return ("Brak plikow .txt w folderze", "", 0, "")

        if selected_file in files:
            filename = selected_file
        else:
            filename = files[index_fallback % len(files)]

        file_path = os.path.join(directory_path, filename)

        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()

        available_files = "\n".join(files)

        return (content, filename, len(files), available_files)

class SzandorAutoCrop:
    ASPECT_RATIOS = {
        "9:16": (9, 16),
        "16:9": (16, 9),
        "1:1": (1, 1),
        "4:3": (4, 3),
        "3:4": (3, 4),
        "keep original": None,
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "crop_method": (list(cls.ASPECT_RATIOS.keys()), {"default": "9:16"}),
                "crop_position": (["center", "top/left", "bottom/right"], {"default": "center"}),
                "divisible_by": (["64", "32", "16", "8"], {"default": "64"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "auto_crop"
    CATEGORY = "Moje Nody"

    @staticmethod
    def _largest_divisible_size(width, height, ratio, divisible_by):
        if ratio is None:
            crop_width = (width // divisible_by) * divisible_by
            crop_height = (height // divisible_by) * divisible_by
            return max(crop_width, 1), max(crop_height, 1)

        ratio_width, ratio_height = ratio
        max_scale = min(width // ratio_width, height // ratio_height)
        scale_step = math.lcm(
            divisible_by // math.gcd(ratio_width, divisible_by),
            divisible_by // math.gcd(ratio_height, divisible_by),
        )
        scale = (max_scale // scale_step) * scale_step

        if scale > 0:
            return ratio_width * scale, ratio_height * scale

        crop_width = (width // divisible_by) * divisible_by
        crop_height = (height // divisible_by) * divisible_by
        return max(crop_width, 1), max(crop_height, 1)

    @staticmethod
    def _offset(source_size, crop_size, crop_position):
        if crop_position == "top/left":
            return 0
        if crop_position == "bottom/right":
            return source_size - crop_size
        return (source_size - crop_size) // 2

    def auto_crop(self, image, crop_method, crop_position, divisible_by):
        if image.ndim != 4:
            raise ValueError("Szandor Auto Crop oczekuje obrazu IMAGE w formacie B,H,W,C.")

        _, height, width, _ = image.shape
        ratio = self.ASPECT_RATIOS[crop_method]
        crop_width, crop_height = self._largest_divisible_size(
            width,
            height,
            ratio,
            int(divisible_by),
        )

        crop_width = min(crop_width, width)
        crop_height = min(crop_height, height)
        x = self._offset(width, crop_width, crop_position)
        y = self._offset(height, crop_height, crop_position)

        return (image[:, y:y + crop_height, x:x + crop_width, :].contiguous(),)

NODE_CLASS_MAPPINGS = {
    "BatchImageLoaderWithName": BatchImageLoaderWithName,
    "SaveTextFile": SaveTextFile,
    "TextDirectoryLoader": TextDirectoryLoader,
    "TextFilePickerLoader": TextFilePickerLoader,
    "SzandorAutoCrop": SzandorAutoCrop
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BatchImageLoaderWithName": "Batch Image Loader (Folder)",
    "SaveTextFile": "Save Text File (Custom Path)",
    "TextDirectoryLoader": "Text Batch Loader (Folder)",
    "TextFilePickerLoader": "Text File Picker (Folder)",
    "SzandorAutoCrop": "Szandor Auto Crop"
}
