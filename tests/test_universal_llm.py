"""Gateway request compatibility tests; no credentials or network required."""
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


def load_node():
    spec = importlib.util.spec_from_file_location(
        "universal_llm_under_test", Path(__file__).parents[1] / "nodes/universal_llm.py"
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {
        "openai": SimpleNamespace(OpenAI=Mock()),
        "dotenv": SimpleNamespace(load_dotenv=Mock()),
    }), patch("os.makedirs"):
        spec.loader.exec_module(module)
    return module


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.module = load_node()
        self.create = self.module.OpenAI.return_value.chat.completions.create
        self.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(
                message=SimpleNamespace(content="answer"), finish_reason="stop"
            )], usage=None,
        )

    def generate(self, provider, model, temperature=0.7, **options):
        config = [{
            "provider": provider, "env_key": "TEST_LLM_KEY",
            "baseurl": "https://example.invalid/v1", "models": {"Model": model},
        }]
        with patch.object(self.module, "load_llm_config", return_value=config), \
                patch.dict(self.module.os.environ, {"TEST_LLM_KEY": "test-key"}), \
                patch("builtins.print"):
            arguments = dict(
                prompt="question", selected_model=f"{provider}: Model",
                instruction_file="None", system_instruction_fallback="instruction",
                temperature=temperature, max_tokens=4096, thinking_budget=2048,
                seed=1000007,
            )
            arguments.update(options)
            return self.module.UniversalLLMNode().generate(**arguments)

    def expected_payload(self, model):
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": "instruction"},
                {"role": "user", "content": "question"},
            ],
            "seed": 7,
        }

    def test_astra_omits_unsupported_parameters(self):
        for model in ("gpt-6-astra", "gpt-6-astra-2026-09-03"):
            for temperature in (0.0, 0.7, 1.0, 2.0):
                with self.subTest(model=model, temperature=temperature):
                    self.assertEqual(self.generate("OpenAI", model, temperature), ("answer",))
                    expected = self.expected_payload(model)
                    expected["max_completion_tokens"] = 4096
                    self.assertEqual(self.create.call_args.kwargs, expected)

    def test_existing_openai_models_keep_their_requests(self):
        for model in ("gpt-4o", "gpt-4o-mini", "gpt-5", "gpt-5.6-sol",
                      "gpt-5.6-terra", "gpt-5.6-luna", "o1", "o3", "o4-mini"):
            with self.subTest(model=model):
                self.assertEqual(self.generate("OpenAI", model), ("answer",))
                expected = self.expected_payload(model)
                if model in ("gpt-4o", "gpt-4o-mini"):
                    expected.update(max_tokens=4096, temperature=0.7)
                else:
                    expected["max_completion_tokens"] = 4096
                self.assertEqual(self.create.call_args.kwargs, expected)

    def test_other_providers_keep_sampling_and_only_supported_budgets(self):
        for provider, model in (
            ("Alibaba Qwen", "qwen3.8-max"), ("DeepSeek", "deepseek-v4-pro"),
            ("X.AI (Grok)", "grok-4.6"), ("Google (Gemini)", "gemini-2.5-pro"),
            ("Custom", "gpt-6-astra"),
        ):
            with self.subTest(provider=provider):
                self.assertEqual(self.generate(provider, model), ("answer",))
                expected = self.expected_payload(model)
                expected.update(max_tokens=4096, temperature=0.7,
                                extra_body={"thinking_budget": 2048})
                if provider in ("DeepSeek", "X.AI (Grok)"):
                    del expected["extra_body"]
                if provider == "Google (Gemini)":
                    del expected["seed"]
                self.assertEqual(self.create.call_args.kwargs, expected)

    def test_astra_token_exhaustion_keeps_helpful_warning(self):
        self.create.return_value.choices[0].message.content = None
        self.create.return_value.choices[0].finish_reason = "length"
        result = self.generate("OpenAI", "gpt-6-astra")
        self.assertIn("Zwiększ wartość 'max_tokens'", result[0])
        self.assertIn("4096", result[0])

    def test_every_configured_model_has_a_profile_and_keeps_default_chat(self):
        config = json.loads((Path(__file__).parents[1] / "config.json").read_text(encoding="utf-8-sig"))
        for entry in config:
            for model in entry["models"].values():
                with self.subTest(model=model):
                    self.assertIsNotNone(self.module.get_model_profile(entry["provider"], model))
                    self.assertEqual(self.generate(entry["provider"], model, thinking_budget=0), ("answer",))
                    payload = self.create.call_args.kwargs
                    self.assertNotIn("reasoning_effort", payload)
                    self.assertNotIn("response_format", payload)
                    self.module.OpenAI.return_value.responses.create.assert_not_called()

    def test_openai_reasoning_efforts_and_large_limits(self):
        for model in ("gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"):
            efforts = ["low", "medium", "high", "xhigh", "max"]
            if model != "gpt-6-astra":
                efforts.append("none")
            for effort in efforts:
                with self.subTest(model=model, effort=effort):
                    self.assertEqual(self.generate("OpenAI", model, reasoning_effort=effort,
                                                   max_tokens=128000), ("answer",))
                    payload = self.create.call_args.kwargs
                    self.assertEqual(payload["reasoning_effort"], effort)
                    self.assertEqual(payload["max_completion_tokens"], 128000)
                    self.assertNotIn("temperature", payload)
                    self.assertNotIn("extra_body", payload)

    def test_unsupported_efforts_and_limits_fail_before_api_call(self):
        for provider, model, options in (
            ("OpenAI", "gpt-6-astra", {"reasoning_effort": "none"}),
            ("OpenAI", "gpt-6-astra", {"reasoning_effort": "minimal"}),
            ("OpenAI", "gpt-4o", {"reasoning_effort": "high"}),
            ("OpenAI", "gpt-4o-mini", {"max_tokens": 16385}),
            ("OpenAI", "gpt-6-astra", {"max_tokens": 128001}),
            ("OpenAI", "gpt-5.6-sol", {"max_tokens": 0}),
            ("X.AI (Grok)", "grok-4.6", {"reasoning_effort": "max"}),
            ("X.AI (Grok)", "grok-4.5", {"reasoning_effort": "none"}),
            ("Alibaba Qwen", "qwen3.7-plus", {"reasoning_effort": "high"}),
            ("Custom", "gpt-6-astra", {"output_format": "json_schema"}),
        ):
            with self.subTest(model=model, options=options):
                self.assertIn("Błąd ustawień", self.generate(provider, model, **options)[0])
                self.module.OpenAI.assert_not_called()

    def test_qwen_effort_takes_precedence_over_budget(self):
        for model in ("qwen3.8-max", "qwen3.8-flash"):
            for effort, expected in (("low", "low"), ("medium", "medium"),
                                     ("high", "xhigh"), ("xhigh", "xhigh"), ("max", "xhigh")):
                with self.subTest(model=model, effort=effort):
                    self.assertEqual(self.generate("Alibaba Qwen", model, reasoning_effort=effort), ("answer",))
                    payload = self.create.call_args.kwargs
                    self.assertEqual(payload["reasoning_effort"], expected)
                    self.assertEqual(payload["extra_body"], {"enable_thinking": True})

    def test_qwen_disabling_thinking_omits_positive_budget(self):
        for model in ("qwen3.8-max", "qwen3.8-flash", "qwen3.7-plus"):
            with self.subTest(model=model):
                self.assertEqual(self.generate("Alibaba Qwen", model, reasoning_effort="none"), ("answer",))
                payload = self.create.call_args.kwargs
                self.assertEqual(payload["extra_body"], {"enable_thinking": False})
                self.assertNotIn("reasoning_effort", payload)

    def test_deepseek_reasoning_mapping_and_toggle(self):
        for model in ("deepseek-flash", "deepseek-v4-pro"):
            for effort, expected in (("none", "none"), ("low", "low"), ("medium", "high"),
                                     ("high", "high"), ("xhigh", "high"), ("max", "max")):
                with self.subTest(model=model, effort=effort):
                    self.assertEqual(self.generate("DeepSeek", model, reasoning_effort=effort), ("answer",))
                    payload = self.create.call_args.kwargs
                    self.assertEqual(payload["reasoning_effort"], expected)
                    self.assertEqual(payload["extra_body"], {"thinking": {
                        "type": "disabled" if effort == "none" else "enabled",
                    }})

    def test_grok_effort_levels(self):
        for model in ("grok-4.5", "grok-4.6"):
            for effort in ("low", "medium", "high", "xhigh"):
                with self.subTest(model=model, effort=effort):
                    self.assertEqual(self.generate("X.AI (Grok)", model, reasoning_effort=effort), ("answer",))
                    expected = "high" if model == "grok-4.5" and effort == "xhigh" else effort
                    self.assertEqual(self.create.call_args.kwargs["reasoning_effort"], expected)
                    self.assertNotIn("extra_body", self.create.call_args.kwargs)

    def test_json_object_adds_instruction_and_keeps_chat_for_all_providers(self):
        self.create.return_value.choices[0].message.content = '{"text":"answer"}'
        for provider, model in (("OpenAI", "gpt-6-astra"), ("Alibaba Qwen", "qwen3.8-max"),
                                ("DeepSeek", "deepseek-flash"), ("X.AI (Grok)", "grok-4.6")):
            with self.subTest(provider=provider):
                result = self.generate(provider, model, output_format="json_object", json_schema="invalid")
                self.assertEqual(json.loads(result[0]), {"text": "answer"})
                payload = self.create.call_args.kwargs
                self.assertEqual(payload["response_format"], {"type": "json_object"})
                self.assertTrue(payload["messages"][0]["content"].startswith("instruction"))
                self.assertIn("JSON", payload["messages"][0]["content"])
                self.assertEqual(payload["messages"][1]["content"], "question")
                self.module.OpenAI.return_value.responses.create.assert_not_called()

    def test_chat_json_schema_preserves_schema(self):
        self.create.return_value.choices[0].message.content = '{"text":"answer"}'
        for provider, model in (("OpenAI", "gpt-6-astra"), ("OpenAI", "gpt-5.6-sol"),
                                ("OpenAI", "gpt-4o"), ("Alibaba Qwen", "qwen3.7-plus"),
                                ("Alibaba Qwen", "qwen3.8-flash"), ("X.AI (Grok)", "grok-4.6")):
            with self.subTest(model=model):
                result = self.generate(provider, model, output_format="json_schema")
                self.assertEqual(json.loads(result[0]), {"text": "answer"})
                payload = self.create.call_args.kwargs
                self.assertEqual(payload["response_format"], {
                    "type": "json_schema", "json_schema": {"name": "result", "strict": True,
                        "schema": json.loads(self.module.DEFAULT_JSON_SCHEMA)},
                })
                self.assertEqual(payload["messages"], self.expected_payload(model)["messages"])

    def test_deepseek_schema_uses_responses_and_reads_response_usage(self):
        responses = self.module.OpenAI.return_value.responses.create
        responses.return_value = SimpleNamespace(
            status="completed", error=None, output_text='{"text":"answer"}',
            usage=SimpleNamespace(input_tokens=10, output_tokens=20, total_tokens=30,
                                  output_tokens_details=SimpleNamespace(reasoning_tokens=12)),
        )
        for model in ("deepseek-flash", "deepseek-v4-pro"):
            for effort in ("auto", "none", "max"):
                with self.subTest(model=model, effort=effort):
                    result = self.generate("DeepSeek", model, output_format="json_schema", reasoning_effort=effort)
                    self.assertEqual(json.loads(result[0]), {"text": "answer"})
                    payload = responses.call_args.kwargs
                    expected = {
                        "model": model, "input": self.expected_payload(model)["messages"],
                        "max_output_tokens": 4096,
                        "text": {"format": {"type": "json_schema", "name": "result",
                                 "schema": json.loads(self.module.DEFAULT_JSON_SCHEMA)}},
                    }
                    if effort != "auto":
                        expected["reasoning"] = {"effort": effort}
                    if effort == "none":
                        expected["temperature"] = 0.7
                    self.assertEqual(payload, expected)
                    self.create.assert_not_called()

    def test_bad_schemas_fail_before_api_call(self):
        for schema in ("invalid", "[]", '{}', '{"type":"array"}',
                       '{"type":"object","properties":{}}',
                       '{"type":"object","properties":{"x":{"type":"string"}},'
                       '"required":[],"additionalProperties":false}'):
            with self.subTest(schema=schema):
                result = self.generate("OpenAI", "gpt-6-astra", output_format="json_schema", json_schema=schema)
                self.assertIn("Błąd ustawień", result[0])
                self.module.OpenAI.assert_not_called()

    def test_invalid_or_truncated_json_is_reported(self):
        for content, finish in (("invalid", "stop"), ('{"text":', "length"),
                                ('{"text":"partial"}', "length"), ("[]", "stop")):
            with self.subTest(content=content, finish=finish):
                choice = self.create.return_value.choices[0]
                choice.message.content, choice.finish_reason = content, finish
                self.assertIn("Błąd API", self.generate("OpenAI", "gpt-6-astra", output_format="json_object")[0])

    def test_incomplete_or_failed_responses_are_reported(self):
        responses = self.module.OpenAI.return_value.responses.create
        for status, error in (("incomplete", None), ("failed", SimpleNamespace(message="failure"))):
            with self.subTest(status=status):
                responses.return_value = SimpleNamespace(status=status, error=error,
                    incomplete_details=SimpleNamespace(reason="max_output_tokens"), output_text="")
                result = self.generate("DeepSeek", "deepseek-flash", output_format="json_schema")
                self.assertIn("Błąd API", result[0])

    def test_legacy_optional_arguments_and_widget_order(self):
        schema = self.module.UniversalLLMNode.INPUT_TYPES()
        self.assertEqual(list(schema["optional"])[:2], ["thinking_budget", "seed"])
        self.assertEqual(schema["required"]["max_tokens"][1]["default"], 1024)
        with patch.object(self.module, "load_llm_config", return_value=[{
            "provider": "OpenAI", "env_key": "TEST_LLM_KEY", "baseurl": "https://example.invalid/v1",
            "models": {"Model": "gpt-6-astra"},
        }]), patch.dict(self.module.os.environ, {"TEST_LLM_KEY": "test-key"}), patch("builtins.print"):
            self.assertEqual(self.module.UniversalLLMNode().generate(
                "question", "OpenAI: Model", "None", "instruction", 0.7, 1024,
            ), ("answer",))
        self.assertNotIn("reasoning_effort", self.create.call_args.kwargs)


if __name__ == "__main__":
    unittest.main()
