# ComfyUI-Szandor Custom Nodes

[PL] Poniżej znajduje się opis w języku polskim.  
[EN] Scroll down for English description.

---

# 🇵🇱 Wersja Polska

Zestaw zaawansowanych węzłów (Custom Nodes) do ComfyUI, skupiający się na integracji z modelami językowymi (LLM) oraz narzędziach do testowania modeli LoRA.

## 📦 Dostępne Węzły

### 🧠 Integracja AI / LLM
*   **Qwen Image Gen Node**: Wykorzystuje model Qwen (via Dashscope) do zamiany krótkich polskich haseł na rozbudowane, szczegółowe prompty w języku angielskim, idealne dla generatorów obrazów.
*   **Universal LLM Node**: Wszechstronny węzeł obsługujący wielu dostawców (OpenAI, DeepSeek, X.AI/Grok, Alibaba Qwen). Pozwala na generowanie tekstu i chat wewnątrz ComfyUI. Konfiguracja odbywa się przez `config.json`.
*   **Qwen Wan Resolution Node**: Węzeł pomocniczy dedykowany do pracy z modelami wideo (np. Wan2.1), zarządzający rozdzielczością i formatowaniem promptów wideo.

### 🧪 Testowanie LoRA (LoRA Testing)
*   **Lora Tester Selector**: Pozwala wybrać wiele modeli LoRA i zdefiniować ich siłę (strength). Umożliwia łatwe tworzenie testów porównawczych (A/B testing).
*   **Lora Grid Saver**: Automatycznie układa wygenerowane obrazy w siatkę (Grid) z opisami, co ułatwia wizualne porównanie wpływu różnych modeli LoRA na generowany obraz.

### 🛠️ Narzędzia (Utils)
*   **Batch Image Loader With Name**: Wczytywanie obrazów z folderu wraz z ich nazwami (przydatne przy img2img).
*   **Text Directory Loader**: Wczytywanie zawartości plików tekstowych z całego katalogu.
*   **Save Text File**: Prosty zapis wygenerowanych tekstów (np. promptów) do pliku.

## ⚙️ Instalacja

1.  Przejdź do folderu `custom_nodes` w swojej instalacji ComfyUI:
    ```bash
    cd ComfyUI/custom_nodes/
    ```
2.  Sklonuj repozytorium:
    ```bash
    git clone https://github.com/TWOJA_NAZWA/ComfyUI-Szandor.git
    ```
3.  Zainstaluj wymagane biblioteki:
    ```bash
    cd ComfyUI-Szandor
    pip install -r requirements.txt
    ```

## 🔑 Konfiguracja

Aby korzystać z węzłów LLM, musisz skonfigurować klucze API.
1.  Edytuj plik `config.json` (opcjonalnie, aby dodać własne modele).
2.  Ustaw zmienne środowiskowe w systemie lub pliku startowym:
    *   `DASHSCOPE_API_KEY` (dla Qwen)
    *   `OPENAI_API_KEY` (dla OpenAI)
    *   `DEEPSEEK_API_KEY` (dla DeepSeek)
    *   `XAI_API_KEY` (dla Grok)

---

# 🇬🇧 English Version

A collection of custom nodes for ComfyUI, focusing on LLM integration (Prompt Engineering) and LoRA testing workflows.

## 📦 Available Nodes

### 🧠 AI / LLM Integration
*   **Qwen Image Gen Node**: Uses the Qwen model (via Dashscope) to transform short keywords into elaborate, detailed image prompts in English. Optimized for high-quality image generation.
*   **Universal LLM Node**: A versatile node supporting multiple providers (OpenAI, DeepSeek, X.AI/Grok, Alibaba Qwen). Allows for text generation and chat capabilities directly within ComfyUI. Configurable via `config.json`.
*   **Qwen Wan Resolution Node**: A helper node dedicated to video models (e.g., Wan2.1), managing resolution settings and video prompt formatting.

### 🧪 LoRA Testing Tools
*   **Lora Tester Selector**: Allows selection of multiple LoRA models and definition of their strengths. Enables easy benchmarking and A/B testing.
*   **Lora Grid Saver**: Automatically arranges generated images into a labeled grid, making it easy to visually compare the impact of different LoRA models.

### 🛠️ Utilities
*   **Batch Image Loader With Name**: Loads images from a folder along with their filenames (useful for batch img2img).
*   **Text Directory Loader**: Loads the content of text files from a specified directory.
*   **Save Text File**: Simple node to save generated text (e.g., prompts) to a file.

## ⚙️ Installation

1.  Navigate to the `custom_nodes` folder in your ComfyUI installation:
    ```bash
    cd ComfyUI/custom_nodes/
    ```
2.  Clone the repository:
    ```bash
    git clone https://github.com/YOUR_USERNAME/ComfyUI-Szandor.git
    ```
3.  Install required requirements:
    ```bash
    cd ComfyUI-Szandor
    pip install -r requirements.txt
    ```

## 🔑 Configuration

To use the LLM nodes, you need to configure API keys.
1.  Edit `config.json` (optional, to add custom models).
2.  Set environment variables in your system or startup script:
    *   `DASHSCOPE_API_KEY` (for Qwen)
    *   `OPENAI_API_KEY` (for OpenAI)
    *   `DEEPSEEK_API_KEY` (for DeepSeek)
    *   `XAI_API_KEY` (for Grok)
