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

### 🖼️ Ładowanie Obrazów (Image Loading)
*   **Multi Image Loader**: Zaawansowany węzeł do wczytywania wielu obrazów jednocześnie (do 16). Funkcje:
    *   Suwak `image_count` (1–16) – kontroluje liczbę aktywnych slotów i wyjść
    *   Miniaturki – każdy załadowany obraz wyświetla podgląd bezpośrednio w nodzie
    *   Kliknięcie slotu – otwiera okno wyboru pliku i przesyła go do ComfyUI
    *   Drag & Drop – przeciągnięcie obrazów na noda automatycznie je dodaje (wypełnia kolejne wolne sloty; `image_count` rozszerza się automatycznie)
    *   Przycisk ✕ – usuwa zdjęcie z danego slotu
    *   Dynamiczne wyjścia – tyle wyjść `obraz_N` ile wynosi `image_count`
    *   Zapis/odczyt workflow – stan (nazwy plików, liczba slotów) jest zapisywany w pliku workflow

### 🛠️ Narzędzia (Utils)
*   **Batch Image Loader With Name**: Wczytywanie obrazów z folderu wraz z ich nazwami (przydatne przy img2img).
*   **Text Directory Loader**: Wczytywanie zawartości plików tekstowych z całego katalogu.
*   **Text File Picker (Folder)**: Wczytuje prompt z wybranego pliku `.txt` w podanym katalogu, z opcjami sortowania (nazwa/data modyfikacji, rosnąco/malejąco).
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

### 🖼️ Image Loading
*   **Multi Image Loader**: An advanced node for loading multiple images at once (up to 16). Features:
    *   `image_count` slider (1–16) – controls the number of active slots and output pins
    *   Thumbnails – each loaded image displays a preview directly inside the node
    *   Click to upload – clicking an empty slot opens a file picker and uploads the image to ComfyUI
    *   Drag & Drop – drag one or more images onto the node to fill slots automatically (`image_count` expands if needed)
    *   ✕ button – removes the image from a slot
    *   Dynamic outputs – exactly `image_count` outputs named `obraz_N`
    *   Workflow save/load – slot filenames and count are saved in the workflow JSON

### 🛠️ Utilities
*   **Batch Image Loader With Name**: Loads images from a folder along with their filenames (useful for batch img2img).
*   **Text Directory Loader**: Loads the content of text files from a specified directory.
*   **Text File Picker (Folder)**: Loads a prompt from a selected `.txt` file in a target folder, with sorting options (name/modified date, ascending/descending).
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
