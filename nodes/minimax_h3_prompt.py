"""Plain STRING prompt with a browser-side MiniMax H3 syntax editor."""


class SzandorMiniMaxH3Prompt:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"prompt": ("STRING", {
            "default": "",
            "multiline": True,
            "dynamicPrompts": False,
            "widgetType": "SZANDOR_H3_PROMPT",
        })}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "encode"
    CATEGORY = "Szandor/Prompt"
    DESCRIPTION = "MiniMax H3 prompt editor with syntax highlighting, tag insertion and suggestions. Outputs the text exactly as typed."

    def encode(self, prompt):
        return (prompt,)


NODE_CLASS_MAPPINGS = {"SzandorMiniMaxH3Prompt": SzandorMiniMaxH3Prompt}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SzandorMiniMaxH3Prompt": "MiniMax H3 Prompt Editor (Szandor)",
}
