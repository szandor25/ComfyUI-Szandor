import re

class QwenWanResolutionNode:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        # Lista z nazwami proporcji i widocznymi rozdzielczościami
        return {
            "required": {
                "aspect_ratio": ([
                    "1:1 (1328 x 1328)",
                    "16:9 (1664 x 928)",
                    "9:16 (1080 x 1920)",
                    "9:16 (928 x 1664)",
                    "9:16 (720 x 1280)",
                    "9:16 (576 x 1024)",
                    "4:3 (1472 x 1104)",
                    "4:5 (1080 x 1350)",
                    "3:4 (1104 x 1472)",
                    "3:2 (1584 x 1056)",
                    "2:3 (1056 x 1584)",
                ], {"default": "1:1 (1328 x 1328)"}),
            }
        }

    # Wyjścia: Szerokość, Wysokość oraz String z informacją
    RETURN_TYPES = ("INT", "INT", "STRING")
    RETURN_NAMES = ("width", "height", "text_info")
    FUNCTION = "get_dimensions"
    CATEGORY = "LLM/Alibaba/Utils"

    def get_dimensions(self, aspect_ratio):
        # Wyciągamy liczby z ciągu tekstowego za pomocą wyrażenia regularnego
        # Szukamy wszystkiego co jest w nawiasie (np. "1328 x 1328")
        match = re.search(r"\((\d+)\s*x\s*(\d+)\)", aspect_ratio)

        if match:
            width = int(match.group(1))
            height = int(match.group(2))
        else:
            # Failsafe (domyślne 1:1 jeśli coś pójdzie nie tak)
            width, height = 1328, 1328

        info = f"Rozdzielczość: {width}x{height} (Proporcje {aspect_ratio.split(' ')[0]})"

        return (width, height, info)

# Rejestracja noda
NODE_CLASS_MAPPINGS = {
    "QwenWanResolutionNode": QwenWanResolutionNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "QwenWanResolutionNode": "Qwen/Wan Resolution Selector"
}
