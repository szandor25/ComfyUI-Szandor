# ComfyUI-Szandor

Zestaw custom nodow dla ComfyUI w jednym projekcie.

## Zawartosc
- BatchImageLoaderWithName
- SaveTextFile
- TextDirectoryLoader
- QwenImageGenNode
- QwenWanResolutionNode
- UniversalLLMNode
- LoraTesterSelector
- LoraGridSaver

## Instalacja
1. Skopiuj folder `ComfyUI-Szandor` do `ComfyUI/custom_nodes/`.
2. Ustaw wymagane klucze API w zmiennych srodowiskowych (`DASHSCOPE_API_KEY`, `OPENAI_API_KEY`, itd.).
3. Uruchom ponownie ComfyUI.

## Konfiguracja LLM
Edytuj plik `config.json`, aby ustawic providerow i modele.
