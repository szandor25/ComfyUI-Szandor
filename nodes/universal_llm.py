import os
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

# ĹšcieĹĽki absolutne
BASE_PATH = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_PATH)
CONFIG_PATH = os.path.join(PROJECT_ROOT, "config.json")
INSTRUCTIONS_DIR = os.path.join(PROJECT_ROOT, "system_instructions")

# Automatyczne tworzenie folderu na instrukcje
if not os.path.exists(INSTRUCTIONS_DIR):
    os.makedirs(INSTRUCTIONS_DIR)

def load_llm_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"BĹ‚Ä…d Ĺ‚adowania config.json: {e}")
    return []

def get_instruction_files():
    files = ["None"]
    if os.path.exists(INSTRUCTIONS_DIR):
        txt_files = sorted([f for f in os.listdir(INSTRUCTIONS_DIR) if f.endswith(".txt")])
        files.extend(txt_files)
    return files

def get_model_list():
    config = load_llm_config()
    model_display_names = []
    for entry in config:
        provider = entry.get("provider", "Unknown")
        models = entry.get("models", {})
        for friendly_name in models.keys():
            model_display_names.append(f"{provider}: {friendly_name}")
    return model_display_names if model_display_names else ["Brak modeli w config.json"]

class UniversalLLMNode:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        models = get_model_list()
        instructions = get_instruction_files()
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "default": "Witaj, co u Ciebie?"}),
                "selected_model": (models, {"default": models[0] if models else ""}),
                "instruction_file": (instructions, {"default": "None"}),
                "system_instruction_fallback": ("STRING", {"multiline": True, "default": "JesteĹ› pomocnym asystentem AI."}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.01}),
                "max_tokens": ("INT", {"default": 1024, "min": 1, "max": 16384}),
            },
            "optional": {
                "thinking_budget": ("INT", {"default": 0, "min": 0, "max": 16000, "step": 128}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text_output",)
    FUNCTION = "generate"
    CATEGORY = "LLM/Universal"

    def generate(self, prompt, selected_model, instruction_file, system_instruction_fallback, temperature, max_tokens, thinking_budget, seed):
        if ":" not in selected_model:
            return ("BĹ‚Ä…d: Musisz skonfigurowaÄ‡ config.json i zrestartowaÄ‡ ComfyUI.",)

        # 1. Parsowanie wyboru
        provider_name, friendly_name = selected_model.split(": ", 1)
        config = load_llm_config()
        provider_data = next((item for item in config if item["provider"] == provider_name), None)

        if not provider_data:
            return (f"BĹ‚Ä…d: Nie znaleziono dostawcy {provider_name}",)

        # 2. API Key
        api_key = os.getenv(provider_data["env_key"])
        if not api_key:
            return (f"BĹ‚Ä…d: Brak klucza {provider_data['env_key']} w zmiennych Ĺ›rodowiskowych",)

        # 3. System Instruction
        final_system = system_instruction_fallback
        if instruction_file != "None":
            file_path = os.path.join(INSTRUCTIONS_DIR, instruction_file)
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    final_system = f.read().strip()
            except Exception as e:
                print(f"BĹ‚Ä…d czytania pliku instrukcji: {e}")

        # 4. WywoĹ‚anie API
        try:
            client = OpenAI(api_key=api_key, base_url=provider_data["baseurl"])
            real_model_id = provider_data["models"][friendly_name]

            payload = {
                "model": real_model_id,
                "messages": [
                    {"role": "system", "content": final_system},
                    {"role": "user", "content": prompt}
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
            }

            # Gemini nie obsługuje parametru seed przez OpenAI-compatible endpoint
            if provider_name != "Google (Gemini)":
                payload["seed"] = seed % 1000000

            if thinking_budget > 0:
                payload["extra_body"] = {"thinking_budget": thinking_budget}

            completion = client.chat.completions.create(**payload)
            return (completion.choices[0].message.content,)

        except Exception as e:
            return (f"BĹ‚Ä…d API {provider_name}: {str(e)}",)

NODE_CLASS_MAPPINGS = {"UniversalLLMNode": UniversalLLMNode}
NODE_DISPLAY_NAME_MAPPINGS = {"UniversalLLMNode": "Universal LLM Gateway Pro"}

