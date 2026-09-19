# Universal LLM Gateway Pro

Po aktualizacji zrestartuj ComfyUI i odśwież stronę przez Ctrl+F5. Nowe pola
są opcjonalne i znajdują się za istniejącymi polami. Stare workflowy używają
`reasoning_effort=auto` i `output_format=text`; domyślny `max_tokens` pozostaje
1024. Lista modeli nadal pochodzi z `config.json`.

## Ustawienia

- `reasoning_effort`: `auto` nie wysyła poziomu rozumowania i pozostawia domyślny
  wybór API. `none` oznacza wyłączenie myślenia, jeśli model to obsługuje.
  Pozostałe poziomy zależą od modelu — tabela poniżej. Większy poziom może
  zwiększyć czas odpowiedzi i zużycie tokenów.
- `max_tokens`: można wpisać do 393216, ale to zakres pola, a nie deklaracja
  możliwości każdego modelu. Node sprawdza limit 128000 dla Astry/GPT-5.6
  i 16384 dla GPT-4o/Mini. Pozostałe limity wyjścia i całego kontekstu
  sprawdza API dostawcy. Dla OpenAI i DeepSeek limit obejmuje odpowiedź
  oraz rozumowanie. Dla Qwena zachowano dotychczasowe `max_tokens`, ograniczające
  samą odpowiedź; myślenie ma osobny budżet.
- `thinking_budget`: dotychczasowy budżet Qwena, 0–16000; 0 pozostawia domyślny
  budżet API i **nie wyłącza** myślenia. Jest wysyłany tylko przy
  `reasoning_effort=auto`. Jawnie wybrany poziom ma pierwszeństwo, co zapobiega
  błędowi przy jednoczesnym wysłaniu obu parametrów do Qwen 3.8.
  OpenAI, DeepSeek i Grok pomijają ten parametr, także w starszych workflowach;
  informacja pojawia się w konsoli. Dla niestandardowych dostawców zachowano
  dotychczasowe przekazywanie budżetu.
- `output_format`: `text` to zwykły tekst; `json_object` to obiekt JSON;
  `json_schema` to odpowiedź o strukturze opisanej w polu `json_schema`.
- `json_schema`: sam schemat, bez otoczki `response_format`. Pole jest
  ignorowane w trybach `text` i `json_object`.

`temperature` pozostaje pomijane dla OpenAI GPT-5 i GPT-6 Astra. W trybie
myślenia DeepSeek ten parametr nie steruje odpowiedzią. Zmiana poziomu
rozumowania nie jest odpowiednikiem zmiany kreatywności.

## Modele z obecnej konfiguracji

Wszystkie wiersze obsługują `auto`. Mapowania poziomów są wypisywane w konsoli.
Nieobsługiwany wybór powoduje czytelny błąd lokalny, przed wywołaniem API;
node nie zastępuje wybranego modelu innym.

| Model | Dodatkowe wartości `reasoning_effort` | JSON Schema |
| --- | --- | --- |
| GPT-6 Astra | `low`, `medium`, `high`, `xhigh`, `max` | Chat Completions |
| GPT-5.6 Sol / Terra / Luna | `none`, `low`, `medium`, `high`, `xhigh`, `max` | Chat Completions |
| GPT-4o / GPT-4o Mini | brak — wybierz `auto` | Chat Completions |
| Qwen3.8 Max / Flash | `none`, `low`, `medium`, `xhigh`; `high` i `max` mapowane na `xhigh` | Chat Completions |
| Qwen3.7 Plus | `none` wyłącza myślenie; do ograniczenia myślenia użyj `auto` + `thinking_budget` | Chat Completions |
| DeepSeek Flash / V4 Pro | `none`, `low`, `high`, `max`; `medium` i `xhigh` mapowane na `high` | Responses API |
| Grok 4-1 Fast Reasoning | brak — pozostawione `auto` dla starego aliasu | Chat Completions |
| Grok 4.5 | `low`, `medium`, `high`; `xhigh` mapowane na `high` | Chat Completions |
| Grok 4.6 | `low`, `medium`, `high`, `xhigh` | Chat Completions |

Wszystkie powyższe modele używają Chat Completions dla `text` i `json_object`.
DeepSeek przełącza się na Responses **tylko dla `json_schema`**, ponieważ jego
Chat Completions obsługuje `json_object`, ale nie `json_schema`. Ta ścieżka
nie wysyła parametrów specyficznych dla Chat, takich jak `seed`.
Wymaga wersji pakietu `openai` z obsługą `client.responses`; w razie komunikatu
o brakującej obsłudze zaktualizuj pakiet w środowisku Pythona ComfyUI:
`python -m pip install --upgrade openai`.

Alias `grok-4-1-fast-reasoning` jest według dokumentacji xAI przekierowywany
przez dostawcę do Grok 4.3 z niskim poziomem rozumowania. Node pozostawia
identyfikator z Twojego `config.json` bez zmian.

Nowy, nierozpoznany model nadal działa w trybie tekstowym z `auto`.
Obsługa nowych opcji wymaga dodania zweryfikowanego profilu w `MODEL_PROFILES`
w `nodes/universal_llm.py`. Sama nazwa przypominająca model innego dostawcy
nie włącza jego parametrów.

## Przykład JSON Schema

Wybierz `output_format=json_schema` i wklej do pola `json_schema`:

```json
{
  "type": "object",
  "properties": {
    "positive_prompt": {"type": "string"},
    "negative_prompt": {"type": "string"}
  },
  "required": ["positive_prompt", "negative_prompt"],
  "additionalProperties": false
}
```

W promptcie opisz, co model ma umieścić w obu polach. Wyjście noda nadal ma
typ `STRING` i zawiera tekst JSON. Node wstępnie sprawdza składnię i główną
strukturę schematu; szczegółowe ograniczenia schematu weryfikuje dostawca.
Dla zagnieżdżonych obiektów także ustaw `required` i `additionalProperties=false`.
Nie każdy dostawca obsługuje wszystkie słowa kluczowe JSON Schema.

W Chat Completions schemat jest wysyłany z `strict=true`; w DeepSeek Responses
używany jest udokumentowany format `text.format` z `type`, `name` i `schema`.
Node sprawdza, czy odpowiedź jest ukończona i stanowi poprawny obiekt JSON.
Nie wykonuje pełnej lokalnej walidacji wszystkich ograniczeń schematu.
Odmowa, niepoprawny JSON lub odpowiedź ucięta przez limit zwraca komunikat
błędu na dotychczasowym wyjściu tekstowym zamiast przedstawiać ją jako
ukończony wynik JSON. Node nie wykonuje automatycznych płatnych powtórzeń.

## Źródła i testy

Reguły sprawdzono 2026-09-19 w dokumentacji dostawców:

- OpenAI: [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra),
  [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
  [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra),
  [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
  [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
- Alibaba: [parametry Chat Completions](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions),
  [Structured Outputs](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output).
- DeepSeek: [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/),
  [Responses](https://api-docs.deepseek.com/api/create-response/).
- xAI: [rozumowanie](https://docs.x.ai/developers/model-capabilities/text/reasoning),
  [Structured Outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs),
  [stare aliasy](https://docs.x.ai/developers/migration/may-15-retirement).

Testy bez kluczy i połączeń sieciowych:
`python -m unittest discover -s tests -p 'test_universal_llm.py' -v`.
Sprawdzają parametry żądań, mapowania, wybór endpointu, obsługę odpowiedzi
i błędów oraz zgodność domyślnych ustawień i kolejności pól ze starymi workflowami.
