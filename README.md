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
*   **LoRA Stack z miniaturami (Szandor)**: Nakłada wiele LoRA kolejno na wejścia `MODEL` i `CLIP`. Każdy wiersz ma przełącznik, suwak siły i automatyczną miniaturę; najechanie na miniaturę pokazuje większy podgląd. Obraz podglądu należy umieścić obok LoRA pod tą samą nazwą, np. `styl.safetensors` + `styl.png` (obsługiwane są PNG, JPG, JPEG i WebP).
    *   **Triggery**: Pod nazwą pliku wyświetla się tekst triggera. „Kopiuj” kopiuje go do schowka, a „Edytuj” pozwala obejrzeć cały tekst, zmienić go lub ponownie odczytać z pliku. Tekst i checkbox są zapisywane w workflow; edycja nie zmienia pliku LoRA.
    *   **Automatyczny odczyt**: Kolejno z `styl.trigger.txt` (zwykły tekst), `styl.metadata.json` (LoRA Manager), `styl.civitai.info`, `styl.info`, `styl.json`, następnie z metadanych `styl.safetensors`. JSON obsługuje pola `trainedWords`, `triggerWords`, `trigger_words`, `activation text`, `activation_text`, `ss_trigger_words`, także wewnątrz `modelVersion` i `civitai`. Odczytywane są wyłącznie jawne triggery, bez zgadywania na podstawie tagów treningowych. Jeśli ich brak, wpisz tekst przez „Edytuj”. Nie wymaga dostępu do Internetu.
    *   **Własne modele bez Civitai**: „Edytuj” pokazuje podpowiedzi odczytane bezpośrednio z `.safetensors`: frazy `class_tokens` z `ss_datasets` oraz słowa z `ss_tag_frequency`, uporządkowane według częstotliwości. Kliknij wybraną frazę, potem „Zapisz” i zaznacz „Do promptu”. Podpowiedzi nie są automatycznie uznawane za wymagane triggery.
    *   **Dołączanie do promptu**: Zaznacz „Do promptu” przy wybranych LoRA. Podłącz swój tekst do opcjonalnego wejścia `prompt`, a wyjście `prompt_with_triggers` do wejścia `text` w `CLIP Text Encode` (pole tekstowe zamień na wejście z menu kontekstowego, jeśli jest to potrzebne). Wyjście `clip` podłącz do tego samego kodera. Osobne wyjście `trigger_words` zawiera same zaznaczone triggery. Wyłączone LoRA i LoRA o sile 0 nie dodają triggerów. Checkboxy są domyślnie odznaczone, a dotychczasowe wyjścia `model` i `clip` zachowują swoją kolejność.
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

### 🎬 Teledyski (Video) — 🚧 w budowie
*   **Reżyser Teledysku (MiniMax H3)** *(roboczo, jeszcze nieukończone)*: Eksperymentalny węzeł do tworzenia teledysków. Wczytujesz utwór, rozstawiasz klatki kluczowe na oscylogramie (odstęp 5–15 s, taki jest limit modelu MiniMax H3), do każdej klatki podłączasz obraz i prompt, a węzeł generuje osobne segmenty wideo (przez płatne API MiniMax H3, rozliczane kredytami comfy.org) i skleja je w jedno finalne wideo z podłożonym audio. Ma tryb `dry_run` (walidacja + szacowany koszt bez generowania), lokalny cache segmentów (żeby nie płacić drugi raz za niezmieniony fragment) oraz opcjonalny tryb „lokalny" (`video_in_01..39`) do podłączenia gotowych klipów z własnego, lokalnego workflow zamiast płatnego API.
    *   ⚠️ **Status: praca w toku, jeszcze nieukończone.** Interfejs oscylogramu (dynamiczne gniazda, canvas) bywa niestabilny wizualnie i jest wciąż dopracowywany — zanim zaczniesz go używać na poważnie, przetestuj najpierw z `dry_run=True`.

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
*   **LoRA Stack with thumbnails (Szandor)**: Applies multiple LoRAs in order to `MODEL` and `CLIP`. Each row has an enable toggle, strength slider, and an automatically matched thumbnail; hovering the thumbnail opens a larger preview. Store the image beside the LoRA with the same stem, for example `style.safetensors` + `style.png` (PNG, JPG, JPEG, and WebP are supported).
    *   **Triggers**: Each row displays trigger text with copy and edit controls. Text and the “Do promptu” checkbox are saved in the workflow. Editing does not modify the LoRA file. The editor can also reload metadata.
    *   **Local metadata**: Reads `style.trigger.txt` (plain text), then `style.metadata.json` (LoRA Manager), `style.civitai.info`, `style.info`, `style.json`, then the safetensors header. Supported JSON fields: `trainedWords`, `triggerWords`, `trigger_words`, `activation text`, `activation_text`, `ss_trigger_words`, including nested `modelVersion` and `civitai`. Training tag frequencies are not treated as triggers. Missing triggers can be entered manually; no Internet access is required.
    *   **Private models without Civitai**: The editor offers `class_tokens` from `ss_datasets` and frequency-sorted words from `ss_tag_frequency`, read directly from the safetensors header. Click a candidate, save, then enable “Do promptu”. Training candidates are not automatically treated as required triggers.
    *   **Prompt wiring**: Enable “Do promptu” for the desired rows. Connect your prompt text to the optional `prompt` input and connect `prompt_with_triggers` to `CLIP Text Encode`'s `text` input (convert its text widget to an input if needed). Connect the stack's `clip` output to the same encoder. `trigger_words` provides just the selected triggers. Disabled or zero-strength LoRAs contribute no triggers. Checkboxes default to off; the original `model` and `clip` output positions are preserved.
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

### 🎬 Music Videos — 🚧 work in progress
*   **Music Video Director (MiniMax H3)** *(work in progress, not finished yet)*: Experimental node for building music videos. Load a track, place keyframes on the waveform (5–15 s apart, MiniMax H3's clip-length limit), attach an image + prompt to each keyframe, and the node generates one video segment per gap (via the paid MiniMax H3 API, billed through your comfy.org credits) and stitches them into a final video with the audio muxed in. Includes a `dry_run` mode (validate + estimate cost without generating), on-disk segment caching (so you don't pay twice for an unchanged segment), and an optional "local" backend (`video_in_01..39`) to plug in clips generated by your own local workflow instead of the paid API.
    *   ⚠️ **Status: work in progress, not finished yet.** The waveform UI (dynamic sockets, canvas widget) can still be visually unstable and is actively being refined — test with `dry_run=True` first before relying on it.

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
