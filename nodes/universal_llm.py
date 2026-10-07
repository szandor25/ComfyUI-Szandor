import os
import json
import time
import re
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

# ĹšcieĹĽki absolutne
BASE_PATH = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_PATH)
CONFIG_PATH = os.path.join(PROJECT_ROOT, "config.json")
INSTRUCTIONS_DIR = os.path.join(PROJECT_ROOT, "system_instructions")

REASONING_EFFORTS = ["auto", "none", "low", "medium", "high", "xhigh", "max"]
OUTPUT_FORMATS = ["text", "json_object", "json_schema"]
DEFAULT_JSON_SCHEMA = json.dumps({
    "type": "object",
    "properties": {"text": {"type": "string"}},
    "required": ["text"],
    "additionalProperties": False,
}, indent=2)

# Verified provider contracts and their sources: docs/universal_llm.md.
# Unknown models retain the legacy text path; new controls require a known profile.
MODEL_PROFILES = {
    "OpenAI": {
        "gpt-6-astra": {"efforts": ("low", "medium", "high", "xhigh", "max"), "max_tokens": 128000},
        "gpt-5.6-sol": {"efforts": ("none", "low", "medium", "high", "xhigh", "max"), "max_tokens": 128000},
        "gpt-5.6-terra": {"efforts": ("none", "low", "medium", "high", "xhigh", "max"), "max_tokens": 128000},
        "gpt-5.6-luna": {"efforts": ("none", "low", "medium", "high", "xhigh", "max"), "max_tokens": 128000},
        "gpt-4o": {"efforts": (), "max_tokens": 16384},
        "gpt-4o-mini": {"efforts": (), "max_tokens": 16384},
    },
    "Alibaba Qwen": {
        "qwen3.8-max": {"efforts": ("none", "low", "medium", "high", "xhigh", "max"), "budget": True},
        "qwen3.8-flash": {"efforts": ("none", "low", "medium", "high", "xhigh", "max"), "budget": True},
        "qwen3.7-plus": {"efforts": ("none",), "budget": True},
    },
    "DeepSeek": {
        "deepseek-flash": {"efforts": ("none", "low", "medium", "high", "xhigh", "max"), "schema_api": "responses"},
        "deepseek-v4-pro": {"efforts": ("none", "low", "medium", "high", "xhigh", "max"), "schema_api": "responses"},
    },
    "X.AI (Grok)": {
        # This legacy slug is redirected by xAI; keep its default reasoning unchanged.
        "grok-4-1-fast-reasoning": {"efforts": ()},
        "grok-4.5": {"efforts": ("low", "medium", "high", "xhigh")},
        "grok-4.6": {"efforts": ("low", "medium", "high", "xhigh")},
    },
}


def get_model_profile(provider, model):
    profiles = MODEL_PROFILES.get(provider, {})
    if model in profiles:
        return profiles[model]
    # Only dated snapshots inherit a base model's capabilities, not arbitrary variants.
    for base, profile in profiles.items():
        suffix = model.removeprefix(base + "-")
        if model.startswith(base + "-") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", suffix):
            return profile
    return None


def _parse_json_schema(schema_text):
    try:
        schema = json.loads(schema_text)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"The json_schema field must contain valid JSON: {exc}") from exc
    if not isinstance(schema, dict) or schema.get("type") != "object":
        raise ValueError("json_schema: the root type must be 'object' (paste the schema itself, without response_format).")
    if not isinstance(schema.get("properties"), dict):
        raise ValueError("json_schema: provide a 'properties' object describing the response fields.")
    if schema.get("additionalProperties") is not False:
        raise ValueError("json_schema: set additionalProperties to false for strict mode.")
    required = schema.get("required")
    if (not isinstance(required, list) or not all(isinstance(key, str) for key in required)
            or set(required) != set(schema["properties"])):
        raise ValueError("json_schema: required must list every properties field; optional fields can allow null.")
    return schema


def _apply_generation_options(payload, provider, model, thinking_budget, reasoning_effort,
                              output_format, json_schema):
    """Apply only controls documented for the selected provider/model."""
    profile = get_model_profile(provider, model)
    if reasoning_effort not in REASONING_EFFORTS:
        raise ValueError(f"Unknown reasoning_effort: {reasoning_effort}.")
    if output_format not in OUTPUT_FORMATS:
        raise ValueError(f"Unknown output_format: {output_format}.")
    if reasoning_effort != "auto":
        allowed = profile.get("efforts", ()) if profile is not None else ()
        if reasoning_effort not in allowed:
            raise ValueError(
                f"{model}: available reasoning_effort: {', '.join(('auto',) + allowed)}. "
                "auto keeps the API default; thinking_budget is for Qwen models."
            )
        effort = reasoning_effort
        if provider == "Alibaba Qwen":
            payload.setdefault("extra_body", {})["enable_thinking"] = effort != "none"
            if model.startswith("qwen3.8-") and effort != "none":
                effort = {"high": "xhigh", "max": "xhigh"}.get(effort, effort)
                payload["reasoning_effort"] = effort
        elif provider == "DeepSeek":
            effort = {"medium": "high", "xhigh": "high"}.get(effort, effort)
            payload["reasoning_effort"] = effort
            payload.setdefault("extra_body", {})["thinking"] = {
                "type": "disabled" if effort == "none" else "enabled"
            }
        else:
            if provider == "X.AI (Grok)" and model.startswith("grok-4.5") and effort == "xhigh":
                effort = "high"
            payload["reasoning_effort"] = effort
        if effort != reasoning_effort:
            print(f"[UniversalLLM] {model}: reasoning_effort {reasoning_effort} → {effort}.")

    if thinking_budget > 0:
        if profile is not None and profile.get("budget"):
            if reasoning_effort == "auto":
                payload.setdefault("extra_body", {})["thinking_budget"] = thinking_budget
            else:
                print("[UniversalLLM] thinking_budget ignored: the selected reasoning_effort takes precedence.")
        elif provider not in MODEL_PROFILES or (provider == "Alibaba Qwen" and profile is None):
            # Preserve custom OpenAI-compatible integrations already using this extension.
            payload.setdefault("extra_body", {})["thinking_budget"] = thinking_budget
        else:
            print(f"[UniversalLLM] {model}: thinking_budget ignored; use reasoning_effort.")

    if output_format == "text":
        return "chat"
    if profile is None:
        raise ValueError(f"{model}: {output_format} support is not confirmed; choose output_format=text.")
    if output_format == "json_object":
        payload["response_format"] = {"type": "json_object"}
        payload["messages"][0]["content"] += "\n\nReturn only a valid JSON object, without Markdown fences."
        return "chat"
    schema = _parse_json_schema(json_schema)
    payload["response_format"] = {
        "type": "json_schema",
        "json_schema": {"name": "result", "strict": True, "schema": schema},
    }
    return profile.get("schema_api", "chat")


def _responses_payload(chat_payload):
    """DeepSeek supports JSON Schema on Responses, but only JSON object on Chat."""
    payload = {
        "model": chat_payload["model"],
        "input": chat_payload["messages"],
        "max_output_tokens": chat_payload["max_tokens"],
        "text": {"format": {
            "type": "json_schema", "name": "result",
            "schema": chat_payload["response_format"]["json_schema"]["schema"],
        }},
    }
    if "reasoning_effort" in chat_payload:
        payload["reasoning"] = {"effort": chat_payload["reasoning_effort"]}
    if chat_payload.get("reasoning_effort") == "none":
        payload["temperature"] = chat_payload["temperature"]
    return payload

# Automatyczne tworzenie folderu na instrukcje
if not os.path.exists(INSTRUCTIONS_DIR):
    os.makedirs(INSTRUCTIONS_DIR)

def load_llm_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[UniversalLLM] Error loading config.json: {e}")
    return []

def get_instruction_files():
    files = ["None"]
    if os.path.exists(INSTRUCTIONS_DIR):
        txt_files = sorted([f for f in os.listdir(INSTRUCTIONS_DIR) if f.endswith(".txt")])
        files.extend(txt_files)
    return files

def _is_openai_reasoning_family(model_id: str) -> bool:
    """Modele używające max_completion_tokens i pomijające temperature.

    Zachowuje dotychczasową obsługę GPT-5 / serii 'o' i dodaje GPT-6 Astra,
    który nie akceptuje temperature nawet przy wartości 1.
    """
    return (
        model_id.startswith(("gpt-5", "o1", "o3", "o4"))
        or model_id == "gpt-6-astra"
        or model_id.startswith("gpt-6-astra-")
    )

def get_model_list():
    config = load_llm_config()
    model_display_names = []
    for entry in config:
        provider = entry.get("provider", "Unknown")
        models = entry.get("models", {})
        for friendly_name in models.keys():
            model_display_names.append(f"{provider}: {friendly_name}")
    return model_display_names if model_display_names else ["No models in config.json"]

class UniversalLLMNode:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        models = get_model_list()
        instructions = get_instruction_files()
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "default": "Hello, how are you?"}),
                "selected_model": (models, {"default": models[0] if models else ""}),
                "instruction_file": (instructions, {"default": "None"}),
                "system_instruction_fallback": ("STRING", {"multiline": True, "default": "You are a helpful AI assistant."}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.01}),
                "max_tokens": ("INT", {"default": 1024, "min": 1, "max": 393216,
                    "tooltip": "Response limit (for OpenAI/DeepSeek it also covers reasoning). Limits depend on the model; Astra/GPT-5.6: 128000, GPT-4o: 16384."}),
            },
            "optional": {
                "thinking_budget": ("INT", {"default": 0, "min": 0, "max": 16000, "step": 128,
                    "tooltip": "Qwen thinking budget; 0 = default. Works with reasoning_effort=auto. OpenAI, DeepSeek and Grok ignore it."}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                "reasoning_effort": (REASONING_EFFORTS, {"default": "auto",
                    "tooltip": "auto = API default. Astra: low–max; GPT-5.6: none–max; GPT-4o and Grok 4-1: auto; Qwen 3.7: auto/none. Details in docs/universal_llm.md."}),
                "output_format": (OUTPUT_FORMATS, {"default": "text",
                    "tooltip": "text = plain answer; json_object = valid JSON; json_schema = the structure from the field below. DeepSeek uses Responses for json_schema."}),
                "json_schema": ("STRING", {"multiline": True, "default": DEFAULT_JSON_SCHEMA,
                    "tooltip": "The JSON Schema itself; used only with output_format=json_schema. Root type object, every field in required, additionalProperties=false."}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text_output",)
    FUNCTION = "generate"
    CATEGORY = "Szandor/LLM"
    DESCRIPTION = "Text generation through OpenAI, DeepSeek, X.AI (Grok) or Alibaba Qwen, configured in config.json."

    def generate(self, prompt, selected_model, instruction_file, system_instruction_fallback,
                 temperature, max_tokens, thinking_budget=0, seed=0, reasoning_effort="auto",
                 output_format="text", json_schema=DEFAULT_JSON_SCHEMA):
        if ": " not in selected_model:
            return ("Error: configure config.json and restart ComfyUI.",)

        # 1. Parsowanie wyboru
        provider_name, friendly_name = selected_model.split(": ", 1)
        config = load_llm_config()
        provider_data = next((item for item in config if item["provider"] == provider_name), None)

        if not provider_data:
            return (f"Error: provider not found: {provider_name}",)

        # 2. API Key
        api_key = os.getenv(provider_data["env_key"])
        if not api_key:
            return (f"Error: the {provider_data['env_key']} key is not set in the environment",)

        # 3. System Instruction
        final_system = system_instruction_fallback
        if instruction_file != "None":
            file_path = os.path.join(INSTRUCTIONS_DIR, instruction_file)
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    final_system = f.read().strip()
            except Exception as e:
                print(f"[UniversalLLM] Error reading the instruction file: {e}")

        # 4. API call
        try:
            real_model_id = provider_data["models"][friendly_name]
            profile = get_model_profile(provider_name, real_model_id)
            token_limit = profile.get("max_tokens", 393216) if profile is not None else 393216
            if not 1 <= max_tokens <= token_limit:
                return (f"Settings error: {real_model_id}: max_tokens must be within 1–{token_limit}.",)
            if not 0 <= thinking_budget <= 16000:
                return ("Settings error: thinking_budget must be within 0–16000.",)

            payload = {
                "model": real_model_id,
                "messages": [
                    {"role": "system", "content": final_system},
                    {"role": "user", "content": prompt}
                ],
            }

            is_openai_reasoning = provider_name == "OpenAI" and _is_openai_reasoning_family(real_model_id)

            # GPT-6 Astra i dotychczasowe modele GPT-5 / "o" używają tutaj
            # max_completion_tokens bez wysyłania temperature —
            # pozostali dostawcy (Grok, Qwen, DeepSeek, Gemini) i GPT-4* działają jak dotychczas.
            if is_openai_reasoning:
                payload["max_completion_tokens"] = max_tokens
            else:
                payload["max_tokens"] = max_tokens
                payload["temperature"] = temperature

            # Gemini nie obsługuje parametru seed przez OpenAI-compatible endpoint
            if provider_name != "Google (Gemini)":
                payload["seed"] = seed % 1000000

            api_mode = _apply_generation_options(
                payload, provider_name, real_model_id, thinking_budget,
                reasoning_effort, output_format, json_schema,
            )

            client = OpenAI(api_key=api_key, base_url=provider_data["baseurl"])
            start_time = time.time()
            if api_mode == "responses":
                if not hasattr(client, "responses"):
                    raise RuntimeError("JSON Schema for DeepSeek needs a newer openai package. Update the node dependencies.")
                completion = client.responses.create(**_responses_payload(payload))
                if getattr(completion, "error", None):
                    raise RuntimeError(f"Responses API: {completion.error}")
                status = getattr(completion, "status", None)
                if status != "completed":
                    details = getattr(completion, "incomplete_details", None)
                    raise RuntimeError(
                        f"The JSON response was not completed: {status}, {details}. "
                        "If max_output_tokens was reached, increase max_tokens."
                    )
                content = completion.output_text or ""
                finish_reason = status
                details_key, input_key, output_key = "output_tokens_details", "input_tokens", "output_tokens"
            else:
                completion = client.chat.completions.create(**payload)
                choice = completion.choices[0]
                refusal = getattr(choice.message, "refusal", None)
                if refusal:
                    raise RuntimeError(f"The model refused to answer: {refusal}")
                content = choice.message.content or ""
                finish_reason = getattr(choice, "finish_reason", None)
                details_key, input_key, output_key = "completion_tokens_details", "prompt_tokens", "completion_tokens"
            elapsed = time.time() - start_time

            usage = getattr(completion, "usage", None)
            usage_info = "no token usage data"
            if usage:
                details = getattr(usage, details_key, None)
                reasoning_tokens = getattr(details, "reasoning_tokens", None) if details else None
                reasoning_part = f", incl. reasoning={reasoning_tokens}" if reasoning_tokens else ""
                usage_info = (
                    f"prompt={getattr(usage, input_key)} completion={getattr(usage, output_key)}"
                    f"{reasoning_part} total={usage.total_tokens} tokens"
                )

            print(
                f"[UniversalLLM] {provider_name}: {friendly_name} | {usage_info} | "
                f"finish_reason={finish_reason} | {elapsed:.2f}s"
            )

            if output_format != "text":
                if finish_reason not in ("stop", "completed"):
                    raise RuntimeError(
                        f"Incomplete JSON response: finish_reason={finish_reason}. "
                        "If the token limit was reached, increase max_tokens."
                    )
                try:
                    parsed = json.loads(content)
                except ValueError as exc:
                    raise RuntimeError("The model did not return valid JSON.") from exc
                if not isinstance(parsed, dict):
                    raise RuntimeError("The model did not return a JSON object.")

            # Modele rozumujące (GPT-6 Astra / GPT-5 / "o") zużywają część max_completion_tokens
            # na wewnętrzne, niewidoczne rozumowanie. Gdy limit się wyczerpie zanim model
            # wygeneruje właściwą treść, content wraca puste mimo poprawnej odpowiedzi API.
            if not content and finish_reason == "length":
                warning = (
                    f"[UniversalLLM] Empty response: model {friendly_name} used up the token limit "
                    f"({max_tokens}) before producing content — probably on internal reasoning. "
                    f"Increase 'max_tokens' in the node and try again."
                )
                print(warning)
                content = warning

            return (content,)

        except ValueError as e:
            return (f"Settings error {provider_name}: {e}",)
        except Exception as e:
            return (f"API error {provider_name}: {e}",)

NODE_CLASS_MAPPINGS = {"UniversalLLMNode": UniversalLLMNode}
NODE_DISPLAY_NAME_MAPPINGS = {"UniversalLLMNode": "Universal LLM Gateway Pro (Szandor)"}
