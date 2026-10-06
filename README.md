# ComfyUI-Szandor Custom Nodes

[PL] Poniżej znajduje się opis w języku polskim.  
[EN] Scroll down for English description.

---

# 🇵🇱 Wersja Polska

Zestaw 18 węzłów (Custom Nodes) do ComfyUI: edycja promptów MiniMax H3, integracje LLM, generowanie obrazów przez API, obsługa LoRA, obrazów i plików tekstowych oraz eksperymentalny reżyser teledysków.

## 📦 Dostępne Węzły

### 🧠 Integracja AI / LLM

*   **MiniMax H3 — Edytor promptów (Szandor)** (`Szandor/Prompt`): Zwykłe pole tekstowe z kolorowaniem składni H3 podczas pisania: dialogi `<d>[Polish]…</d>`, mówcy `(S1)`, ujęcia `[Shot 1]`, referencje `<Subject N>`, `<Picture N>`, `<Video N>`, `<Audio N>`, znaczniki `<scenetrans>` / `<cutoff>` oraz nazwy sekcji. Przy kursorze w znaczniku dialogu wyróżnia pasującą parę; niedomknięte dialogi i brak języka wskazuje pod polem.
    *   **Wstaw** dodaje wybrany znacznik w miejscu kursora lub obejmuje zaznaczony tekst dialogiem. Dostępne są też szkielety T2VA i Ref2VA do uzupełnienia; **Składnia** pokazuje krótką ściągę. Język, numery referencji i czasy cięć edytujesz w tekście. Standardowe zaznaczanie, wklejanie i cofanie działają jak w polu tekstowym.
    *   **Wklejanie ze schowka**: przycisk **📋** zastępuje cały prompt tekstem ze schowka; Ctrl+Z cofa zmianę. Pusty schowek pozostawia tekst bez zmian. Jeśli przeglądarka blokuje dostęp do schowka (np. przy połączeniu HTTP przez LAN), edytor zaznacza cały prompt i prosi o Ctrl+V / ⌘V.
    *   **Plik TXT / JSON**: przeciągnij jeden plik `.txt` (UTF-8) na pole lub pasek narzędzi edytora, aby zastąpić cały prompt. Z pliku `.json` wstawiany jest tylko prompt (pole `prompt`, a gdy jest puste — `text` lub `positive`, jak w **Folder Media + Prompt Loader**); czasy i inne pola są pomijane. JSON bez promptu nie zmienia tekstu. Obraz przeciągnięty razem ze swoim JSON-em jest ignorowany. Zachowane są znaki i podziały wierszy; Ctrl+Z cofa zmianę, a tekst zapisuje się w workflow. Pusty plik nie usuwa promptu. Odczyt odbywa się lokalnie w przeglądarce.
    *   **Rozmiar**: przeciągnij prawy dolny róg edytora albo zmień rozmiar noda. Pole dopasowuje się do noda, zawija długie wiersze i przewija tekst; rozmiar oraz prompt zapisują się w workflow.
    *   **Własne szablony**: kliknij **Szablony**, wpisz nazwę i wybierz **Zapisz nowy szablon**. Zapis obejmuje pełny prompt (z zachowaniem białych znaków), cały workflow z połączeniami, kolejnością referencji i ustawieniami generowania oraz niezależne kopie zdjęć z nodów **Load Image / Load Image (Mask)**, **Multi Image Loader (Szandor)** i **Load Image From Directory (Szandor)**. Możesz dodać notatkę oraz informacyjny czas w sekundach; dla rozpoznanej gałęzi H3 edytor podpowiada przybliżony czas z liczby klatek przy 24 fps. To pole nie zmienia parametrów generowania. Kolejny zapis tworzy nowy szablon, także przy tej samej nazwie.
    *   **Wczytywanie i pliki szablonów**: wybierz szablon z listy, obejrzyj prompt i zdjęcia, następnie kliknij **Wczytaj cały workflow ze zdjęciami**. To zastępuje bieżący workflow — wcześniej zapisz niezapisane zmiany. Kopie zdjęć są odtwarzane w `ComfyUI/input/szandor_h3_templates/<id>/`, a ścieżki w loaderach aktualizowane automatycznie. Biblioteka znajduje się w `ComfyUI/user/<użytkownik>/szandor_h3_templates/` (zwykle użytkownik `default`); do kopii zapasowej zachowaj cały ten katalog. Usunięcie oryginalnych zdjęć nie psuje szablonu. Limit wynosi 128 MB na obraz i 512 MB na szablon. Modele i LoRA nie są kopiowane. Źródła audio/wideo pozostają zewnętrznymi zależnościami z adnotacją w szablonie; media w podgrafach trzeba przed zapisem przenieść do głównego workflow. Nierozpoznany loader zdjęć zgłasza błąd zamiast zapisać niepełny zestaw.
    *   **Usuwanie szablonów**: wybierz wpis w bibliotece, kliknij **Usuń szablon**, a następnie **Usuń trwale** (lub **Anuluj**). Usuwany jest tylko wybrany szablon wraz ze zdjęciami w jego katalogu biblioteki. Oryginalne zdjęcia i kopie odtworzone wcześniej w `input/szandor_h3_templates/` pozostają, aby zapisane workflow nadal działały.
    *   **Podłączenie**: wyjście `prompt` (`STRING`) podłącz do wejścia `text` kodera tekstu używanego z H3; w razie potrzeby zamień pole kodera na wejście przez jego menu. Edytor działa lokalnie, bez klucza API; zwraca wpisany tekst bez przepisywania, tłumaczenia ani losowania `{a|b}`. Uwagi są pomocnicze i nie blokują generowania. Nieznane znaczniki pozostają w tekście.
    *   **Źródła składni**: oficjalne poradniki MiniMax [T2VA / klatki kluczowe](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/base-en.txt) i [Ref2VA](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt), sprawdzone 2026-09-09. Opisują zalecany format rozbudowanego promptu; node pozwala też swobodnie pisać zwykły tekst.
*   **Alibaba Wan2.1/Qwen Image Gen** (`QwenImageGenNode`): Wysyła prompt do API generowania obrazów DashScope. Pozwala wybrać model, proporcje i seed; zwraca obraz oraz oryginalny prompt. Wymaga `DASHSCOPE_API_KEY`. Pole `negative_prompt` jest obecnie widoczne, ale nie jest przesyłane do API.
*   **Universal LLM Node**: Wszechstronny węzeł obsługujący wielu dostawców (OpenAI, DeepSeek, X.AI/Grok, Alibaba Qwen). Pozwala na generowanie tekstu i chat wewnątrz ComfyUI. Konfiguracja odbywa się przez `config.json`.
    *   **Ustawienia generowania**: opcjonalny `reasoning_effort`, większy zakres `max_tokens` oraz formaty `text`, `json_object` i `json_schema`. Parametry są dobierane do dostawcy i modelu; `auto`/`text` zachowują domyślne działanie starszych workflowów. [Obsługiwane modele, ograniczenia i przykład JSON Schema](docs/universal_llm.md).
*   **Qwen/Wan Resolution Selector** (`QwenWanResolutionNode`): Wybierz preset proporcji i rozdzielczości. Wyjścia `width`, `height` i `text_info` zawierają szerokość, wysokość i opis wybranego ustawienia.

### 🧪 Testowanie LoRA (LoRA Testing)

*   **LoRA Stack z miniaturami (Szandor)**: Nakłada wiele LoRA kolejno na wejścia `MODEL` i `CLIP`. Każdy wiersz ma przełącznik, suwak siły i automatyczną miniaturę; najechanie na miniaturę pokazuje większy podgląd. Kliknij **LoRA / kol.** w nagłówku, aby wpisać liczbę pozycji na kolumnę (domyślnie 10). Kolejne pozycje trafiają do kolumn po prawej — np. 30 LoRA przy limicie 10 tworzy trzy kolumny. Ustawienie jest zapisywane w workflow; kolejność nakładania pozostaje od góry do dołu, następnie od lewej kolumny do prawej. Obraz podglądu należy umieścić obok LoRA pod tą samą nazwą, np. `styl.safetensors` + `styl.png` (obsługiwane są PNG, JPG, JPEG i WebP).
    *   **Stan i dostępność**: Włączone przełączniki są zielone. LoRA nieobecne na liście modeli ComfyUI mają czerwone obramowanie i napis „Brak pliku LoRA”, również gdy są wyłączone. Kontrola odbywa się przy wczytaniu workflow i zmianie listy; przycisk **Sprawdź** ponawia ją po dodaniu lub usunięciu plików. Brak miniatury nie oznacza braku modelu. Błąd pobrania listy pokazuje osobny komunikat „Nie udało się sprawdzić”.
    *   **Triggery**: Pod nazwą pliku wyświetla się tekst triggera. „Kopiuj” kopiuje go do schowka, a „Edytuj” pozwala obejrzeć cały tekst, zmienić go lub ponownie odczytać z pliku. Tekst i checkbox są zapisywane w workflow; edycja nie zmienia pliku LoRA.
    *   **Automatyczny odczyt**: Kolejno z `styl.trigger.txt` (zwykły tekst), `styl.metadata.json` (LoRA Manager), `styl.civitai.info`, `styl.info`, `styl.json`, następnie z metadanych `styl.safetensors`. JSON obsługuje pola `trainedWords`, `triggerWords`, `trigger_words`, `activation text`, `activation_text`, `ss_trigger_words`, także wewnątrz `modelVersion` i `civitai`. Odczytywane są wyłącznie jawne triggery, bez zgadywania na podstawie tagów treningowych. Jeśli ich brak, wpisz tekst przez „Edytuj”. Nie wymaga dostępu do Internetu.
    *   **Własne modele bez Civitai**: „Edytuj” pokazuje podpowiedzi odczytane bezpośrednio z `.safetensors`: frazy `class_tokens` z `ss_datasets` oraz słowa z `ss_tag_frequency`, uporządkowane według częstotliwości. Kliknij wybraną frazę, potem „Zapisz” i zaznacz „Do promptu”. Podpowiedzi nie są automatycznie uznawane za wymagane triggery.
    *   **Dołączanie do promptu**: Zaznacz „Do promptu” przy wybranych LoRA. Podłącz swój tekst do opcjonalnego wejścia `prompt`, a wyjście `prompt_with_triggers` do wejścia `text` w `CLIP Text Encode` (pole tekstowe zamień na wejście z menu kontekstowego, jeśli jest to potrzebne). Wyjście `clip` podłącz do tego samego kodera. Osobne wyjście `trigger_words` zawiera same zaznaczone triggery. Wyłączone LoRA i LoRA o sile 0 nie dodają triggerów. Checkboxy są domyślnie odznaczone, a dotychczasowe wyjścia `model` i `clip` zachowują swoją kolejność.
*   **Lora Tester Selector**: Pozwala wybrać wiele modeli LoRA i zdefiniować ich siłę (strength). Umożliwia łatwe tworzenie testów porównawczych (A/B testing).
*   **Lora Grid Saver**: Automatycznie układa wygenerowane obrazy w siatkę (Grid) z opisami, co ułatwia wizualne porównanie wpływu różnych modeli LoRA na generowany obraz.

### 🖼️ Ładowanie Obrazów (Image Loading)

*   **Load Image From Directory v2 (Szandor)** (`SzandorDirectoryImageLoader`): Wpisz ścieżkę katalogu na komputerze, na którym działa ComfyUI. Strzałkami wybierasz obraz; podgląd pokazuje nazwę i rozdzielczość. Historia katalogów jest przechowywana w przeglądarce, a wybrany katalog i plik w workflow. Przycisk odświeżania ponownie odczytuje listę plików. Wyjścia: `image` i `mask` (z przezroczystości obrazu).
*   **Image Passthrough (Szandor)** (`ImagePassthrough`): Rozdzielacz 1–30 par gniazd `in_N` → `out_N`. Ustaw `slot_count` i podłącz obrazy do odpowiednich wejść; aktywne, podłączone obrazy przechodzą bez zmian. Niepodłączone wyjścia zwracają czarny obraz 8 × 8.
*   **Folder Media + Prompt Loader (Szandor)** (`SzandorFolderMediaLoader`): Wczytuje z katalogu obraz, wideo lub audio razem z promptem i czasem. Pliki łączone są po nazwie bez rozszerzenia, np. `ujecie01.png` + `ujecie01.txt` albo `ujecie01.mp4` + `ujecie01.json` (+ opcjonalnie `ujecie01.wav`). Pozycją jest każda nazwa z plikiem mediów lub promptem, sortowana naturalnie (2 przed 10).
    *   **Prompt i czas**: `.txt` zawiera sam prompt (UTF-8). `.json` ma postać `{"time": 5, "prompt": "…"}`; `time` przyjmuje sekundy (`5`, `"5.5s"`) lub `"mm:ss"`. Prompt z JSON ma pierwszeństwo przed `.txt`. Bez `time` czas to długość wideo, potem audio, a na końcu `default_time`. Źródło czasu widać w podglądzie.
    *   **start_time / end_time (opcjonalne)**: JSON może zawierać np. `{"start_time": 2, "end_time": "00:07.5", "prompt": "…"}` (ten sam format co `time`). Brak pól niczego nie psuje: `start_time` = 0, a `end_time` = `start_time + time`. Gdy JSON ma oba pola, a nie ma `time`, czas = `end_time − start_time`. Błędna wartość lub `end_time` mniejszy od `start_time` daje ostrzeżenie w podglądzie, ale nie zatrzymuje workflow. Wartości trafiają tylko na wyjścia — node nie przycina wideo ani audio.
    *   **Liczba czy tekst (`time_output`)**: przełącznik decyduje, w jakiej postaci wychodzą `time`, `start_time` i `end_time`: `liczba` (FLOAT, sekundy, np. `5.5`), `tekst: sekundy` (`"5.5"`), `tekst: mm:ss.mmm` (`"00:05.500"`) albo `tekst: hh:mm:ss.mmm` (`"00:00:05.500"`). Wyjścia same zmieniają typ na FLOAT lub STRING; połączenia z wejściami, które nowego typu nie przyjmą, są odłączane. `frames` zawsze pozostaje liczbą. Ustawienie zapisuje się w workflow i jest pamiętane dla nowych nodów.
    *   **Format pliku JSON**: jeden obiekt w UTF-8, nazwany tak jak plik mediów (`ujecie01.mp4` → `ujecie01.json`). Wszystkie pola są opcjonalne; nieznane pola są ignorowane.

        | Pole | Zamienniki | Typ | Gdy brak |
        |---|---|---|---|
        | `prompt` | `text`, `positive` | tekst | prompt z `ujecie01.txt`, inaczej pusty |
        | `time` | `duration`, `seconds`, `czas` | czas | `end_time − start_time`, potem długość wideo/audio, potem `default_time` |
        | `start_time` | `start`, `time_start` | czas | `0` |
        | `end_time` | `end`, `time_end` | czas | `start_time + time` |

        Czas to liczba sekund (`5`, `2.5`) albo tekst: `"5"`, `"5s"`, `"2,5 sek"`, `"00:07.5"` (mm:ss), `"0:01:02.5"` (h:mm:ss). Pełny przykład:

        ```json
        {
          "start_time": "00:02",
          "end_time": 7.5,
          "time": 5.5,
          "prompt": "Wide shot of a foggy harbor at dawn, slow dolly-in. (S1) says: <d>[Polish] Dzień dobry!</d>"
        }
        ```

        Minimalne warianty: `{"time": 5, "prompt": "…"}` (bez zakresu: `start_time` = 0, `end_time` = 5) albo `{"start_time": 2, "end_time": 7, "prompt": "…"}` (czas wyliczony: 5 s). Znaki nowej linii w prompcie zapisuj jako `\n`.
    *   **Seed**: wybiera pozycję (`indeks = seed mod liczba pozycji`). Pod nim standardowe `control_after_generate`: `fixed` (stała), `increment` (+1), `decrement` (−1), `randomize` (losowa) — po każdym uruchomieniu kolejki. Strzałki ◀ ▶ w nodzie ustawiają seed.
    *   **Wyjścia**: `image` (obraz albo pierwsza klatka wideo; czarny 64×64 dla samego audio/promptu), `video` (typ `VIDEO`), `audio` (plik audio, inaczej ścieżka dźwiękowa wideo, inaczej cisza o długości `time`), `prompt`, `time` (s), `frames` (= `time × fps`), `seed`, `filename`, `index`, `count`, `start_time`, `end_time` (s). Podłączone wyjście `video` przy pozycji bez wideo zgłasza błąd — wtedy ustaw `media_filter = wideo`.
    *   **Podgląd**: obraz lub pierwsza klatka wideo (przycisk **▶ wideo** odtwarza plik), odtwarzacz audio, znaczniki plików, rozdzielczość, czas i prompt. Pokazuje pozycję, która zostanie wczytana w następnym uruchomieniu; pasek stanu podaje ostatnio wczytaną. Lista odświeża się sama co 5 s po zmianie plików.
    *   **Przeciąganie plików**: upuść na node obraz, wideo, audio, `.json` lub `.txt` (także kilka naraz). Gdy taki sam plik jest już w katalogu, node tylko przechodzi do jego pozycji (ustawia seed) — wczytuje się też JSON / obraz o tej samej nazwie, więc przeciągnięcie obrazu pokazuje jego prompt i odwrotnie. Nowe pliki są kopiowane do katalogu i od razu wybierane; obraz i JSON upuszczone razem tworzą jedną pozycję. Jeśli nazwa jest zajęta przez inny plik, cały komplet dostaje numer `_2`, `_3`… — istniejące pliki nie są nadpisywane. Bez wpisanego katalogu pliki trafiają do `ComfyUI/input/szandor_folder_media`, który staje się katalogiem noda. Pozycja ukryta przez `media_filter` przełącza filtr na `wszystko`.
    *   **Cały folder naraz**: przycisk **⏭ Wszystkie (N)** po potwierdzeniu ustawia seed na 0 i tryb `increment`, a następnie dodaje do kolejki N zadań — po jednym na każdą pozycję.
    *   **Ustawienia**: katalog, filtr, czasy, tryb seeda i rozmiar noda zapisują się w workflow; ostatnie ustawienia i historia katalogów (🕘) są też pamiętane w przeglądarce i używane przy dodawaniu nowego noda. Podgląd dopasowuje się do rozmiaru noda.
*   **Save As Source Name (Szandor)** (`SzandorSaveAsSource`): Opcjonalny zapis wyniku pod nazwą pozycji z loadera. Podłącz `filename` z **Folder Media + Prompt Loader**, a do wejść `image`, `video`, `audio`, `prompt` (i ewentualnie `time`, `start_time`, `end_time` — jako liczby lub tekst) wyniki workflow. Powstają np. `ujecie01.png`, `ujecie01.mp4`, `ujecie01.wav` oraz `ujecie01.txt` — albo `ujecie01.json` z promptem i podłączonymi czasami, gdy podłączony jest któryś z nich, więc wynik można znów wczytać loaderem. Przełącznik `enabled` wyłącza zapis bez rozłączania. `output_directory`: puste = `ComfyUI/output/szandor_folder_media`, ścieżka względna liczona od `ComfyUI/output`. `suffix` dopisuje tekst do nazwy (np. `_gen`). `on_exists`: `numeruj` (cały komplet dostaje wspólny numer `_2`, `_3`…), `nadpisz` lub `pomiń`. Batch obrazów zapisuje się jako `nazwa_0001.png`, `nazwa_0002.png`…; audio jako 16-bit WAV (maks. 2 kanały).
*   **Szandor Auto Crop** (`SzandorAutoCrop`): Przycina obraz lub batch do wybranych proporcji, z pozycją `center`, `top/left` albo `bottom/right` i wymaganą podzielnością wymiarów przez 64, 32, 16 lub 8. Podłącz `image`, wybierz ustawienia i odbierz przycięty `image`. Nie skaluje obrazu; jeśli obraz jest za mały dla wybranych proporcji i podzielności, używa wymiarów mieszczących się w źródle, więc proporcje mogą się różnić.
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
    git clone https://github.com/szandor25/ComfyUI-Szandor.git
    ```
3.  Zainstaluj wymagane biblioteki:
    ```bash
    cd ComfyUI-Szandor
    python -m pip install -r requirements.txt python-dotenv
    ```

Użyj Pythona ze środowiska ComfyUI. `python-dotenv` jest wymagany przez istniejące integracje LLM. Zrestartuj ComfyUI i odśwież stronę przez **Ctrl+F5**, aby załadować nody oraz ich interfejsy.

## 🔄 Aktualizacja i uruchomienie edytora H3

W katalogu zainstalowanego zestawu wykonaj `git pull --ff-only`, następnie zrestartuj ComfyUI i odśwież stronę przez **Ctrl+F5**. W wyszukiwarce nodów wpisz **MiniMax H3 — Edytor promptów (Szandor)**; znajduje się w kategorii `Szandor/Prompt`. Połącz `prompt` z `text` kodera tekstu H3, wpisz prompt i zapisz workflow, aby zachować tekst oraz rozmiar pola. Edytor sam nie ładuje modelu ani nie generuje filmu.

## 📝 Ostatnie zmiany

*   **2026-10-06 — Przeciąganie plików**: Folder Media Loader przyjmuje przeciągnięte obrazy, wideo, audio i JSON / TXT (wybiera istniejącą pozycję z kompletem albo kopiuje nowe pliki do katalogu); edytor MiniMax H3 wstawia prompt z przeciągniętego pliku `.json`.
*   **2026-09-29 — Folder Media Loader: `time_output`**: czasy na wyjściu jako liczba albo tekst (sekundy, mm:ss.mmm, hh:mm:ss.mmm).
*   **2026-09-28 — Folder Media Loader: start_time / end_time**: opcjonalne pola w JSON i nowe wyjścia `start_time` / `end_time`; opis formatu JSON z przykładem.
*   **2026-09-27 — Folder Media + Prompt Loader**: wczytywanie obrazów, wideo i audio z katalogu z promptem `.txt` / `.json` (czas), wyborem pozycji przez seed, responsywnym podglądem i kolejkowaniem całego folderu; opcjonalny zapis wyników pod nazwą źródła (**Save As Source Name**).
*   **2026-09-09 — Edytor MiniMax H3**: kolorowanie składni, wskazywanie par i błędów dialogów, wstawianie znaczników i szablonów, rozciąganie pola oraz zapis rozmiaru w workflow. Dodano testy składni i test interfejsu w Chromium.
*   **LoRA Stack — kolumny** (`9a16ac1`): konfigurowalna liczba pozycji na kolumnę, zapisywana w workflow.
*   **LoRA Stack — triggery** (`44c90e0`): odczyt lokalnych triggerów, edycja i dołączanie do promptu oraz podpowiedzi z metadanych treningowych.
*   **Dokumentacja**: uzupełniono brakujące opisy nodów obrazowych, poprawiono opisy Qwen oraz instrukcje instalacji i aktualizacji. Pełna historia znajduje się w [commitach repozytorium](https://github.com/szandor25/ComfyUI-Szandor/commits/main/).

## 🧪 Testy

Z katalogu repozytorium: `python -m unittest discover -s tests -p 'test_*.py'` oraz `node --test tests/test_h3_prompt_syntax.mjs` (Node.js z obsługą modułów ES w plikach `.js`, np. 22.7+). Test przeglądarkowy uruchom przez `CHROME_PATH=/ścieżka/do/chrome node tests/test_h3_prompt_browser.mjs`. Nie wymaga pakietów npm; używa uproszczonego hosta widgetów ComfyUI i nie wykonuje generowania H3.

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

A collection of 18 ComfyUI nodes for MiniMax H3 prompt editing, LLM integration, API image generation, LoRAs, images, text files, and an experimental music video director.

## 📦 Available Nodes

### 🧠 AI / LLM Integration

*   **MiniMax H3 — Prompt Editor (Szandor)** (`Szandor/Prompt`): Native text editing with live highlighting of dialogue, language and shot markers, speakers, references, boundary tags, and base/Ref2VA section names. Highlights matching dialogue tags at the caret and reports missing dialogue closures or language labels. Insert tags around a selection or add editable T2VA/Ref2VA templates; the **Składnia** button opens a syntax guide. Resize the editor using its bottom-right grip or resize the node; text and node dimensions persist in the workflow. Connect its `prompt` (`STRING`) output to your H3 text encoder's `text` input. Runs locally without API keys, preserves the prompt verbatim (including `{a|b}`), and never blocks generation on editor diagnostics. Based on MiniMax's official [base](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/base-en.txt) and [reference](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt) guides, consulted 2026-09-09.
    *   **Saved templates**: **Szablony** opens a local library. Save a name, the exact prompt, the complete workflow (including connections, reference ordering, seeds and generation settings), and independent copies of images from **Load Image / Load Image (Mask)**, **Multi Image Loader (Szandor)**, and **Load Image From Directory (Szandor)**. Optional notes and duration in seconds describe the template; a recognized H3 branch offers an estimate from its frame count at 24 fps. Duration metadata does not change generation settings. Every save creates a new entry, including duplicate names.
    *   **Restoring and backing up**: Preview a saved prompt and its images, then click **Wczytaj cały workflow ze zdjęciami** to replace the current workflow; save unfinished changes first. Image copies are restored under `ComfyUI/input/szandor_h3_templates/<id>/` and loader paths are updated. Back up the entire library at `ComfyUI/user/<user>/szandor_h3_templates/` (usually user `default`). Templates survive deletion of original images. Limits: 128 MB per image and 512 MB per template. Models and LoRAs are not copied. Audio/video sources remain external dependencies, recorded in template notes. Move media out of subgraphs before saving; unrecognized image loaders report an error instead of silently omitting photos.
    *   **Deleting templates**: Select an entry, click **Usuń szablon**, then **Usuń trwale** to confirm or **Anuluj** to cancel. Only the selected library directory and its archived images are removed. Original images and previously restored copies in `input/szandor_h3_templates/` remain available to existing workflows.
    *   **Clipboard**: **📋** replaces the entire prompt with clipboard text; Ctrl+Z undoes the change. An empty clipboard leaves the prompt intact. If clipboard access is blocked (for example over LAN HTTP), the editor selects the prompt and asks for Ctrl+V / ⌘V.
    *   **TXT / JSON files**: drop one UTF-8 `.txt` file onto the editor's text area or toolbar to replace the entire prompt. From a `.json` file only the prompt is inserted (`prompt`, or `text` / `positive` when empty, as in **Folder Media + Prompt Loader**); times and other fields are ignored. A JSON without a prompt leaves the text unchanged. An image dropped together with its JSON is ignored. Characters and line breaks are preserved; Ctrl+Z undoes the change, and the text persists in the workflow. Empty files leave the prompt intact. Files are read locally in the browser.
*   **Alibaba Wan2.1/Qwen Image Gen** (`QwenImageGenNode`): Calls the DashScope image generation API with a prompt, model, aspect ratio, and seed; returns the image and original prompt. Requires `DASHSCOPE_API_KEY`. The current `negative_prompt` field is not forwarded to the API.
*   **Universal LLM Node**: A versatile node supporting multiple providers (OpenAI, DeepSeek, X.AI/Grok, Alibaba Qwen). Allows for text generation and chat capabilities directly within ComfyUI. Configurable via `config.json`.
    *   **Generation controls**: optional `reasoning_effort`, a larger `max_tokens` range, and `text`, `json_object`, or `json_schema` output. Parameters are adapted to each provider/model; `auto`/`text` preserve the default behavior of existing workflows. [Supported models, limitations, and a JSON Schema example (Polish)](docs/universal_llm.md).
*   **Qwen/Wan Resolution Selector** (`QwenWanResolutionNode`): Select an aspect-ratio/resolution preset to obtain `width`, `height`, and a `text_info` description.

### 🧪 LoRA Testing Tools

*   **LoRA Stack with thumbnails (Szandor)**: Applies multiple LoRAs in order to `MODEL` and `CLIP`. Each row has an enable toggle, strength slider, and an automatically matched thumbnail; hovering the thumbnail opens a larger preview. Click **LoRA / kol.** in the header to enter the number of entries per column (default: 10). Additional entries flow into columns on the right, so 30 LoRAs with a limit of 10 produce three columns. The setting is saved in the workflow; application order remains top to bottom, then left column to right column. Store the image beside the LoRA with the same stem, for example `style.safetensors` + `style.png` (PNG, JPG, JPEG, and WebP are supported).
    *   **State and availability**: Enabled toggles are green. LoRAs absent from ComfyUI's model list have a red border and a “Brak pliku LoRA” (missing LoRA file) label, even when disabled. Availability is checked when loading a workflow or changing the selection; click **Sprawdź** to check again after adding or removing files. A missing thumbnail does not imply a missing model. A failed list request displays a separate “Nie udało się sprawdzić” (could not check) message.
    *   **Triggers**: Each row displays trigger text with copy and edit controls. Text and the “Do promptu” checkbox are saved in the workflow. Editing does not modify the LoRA file. The editor can also reload metadata.
    *   **Local metadata**: Reads `style.trigger.txt` (plain text), then `style.metadata.json` (LoRA Manager), `style.civitai.info`, `style.info`, `style.json`, then the safetensors header. Supported JSON fields: `trainedWords`, `triggerWords`, `trigger_words`, `activation text`, `activation_text`, `ss_trigger_words`, including nested `modelVersion` and `civitai`. Training tag frequencies are not treated as triggers. Missing triggers can be entered manually; no Internet access is required.
    *   **Private models without Civitai**: The editor offers `class_tokens` from `ss_datasets` and frequency-sorted words from `ss_tag_frequency`, read directly from the safetensors header. Click a candidate, save, then enable “Do promptu”. Training candidates are not automatically treated as required triggers.
    *   **Prompt wiring**: Enable “Do promptu” for the desired rows. Connect your prompt text to the optional `prompt` input and connect `prompt_with_triggers` to `CLIP Text Encode`'s `text` input (convert its text widget to an input if needed). Connect the stack's `clip` output to the same encoder. `trigger_words` provides just the selected triggers. Disabled or zero-strength LoRAs contribute no triggers. Checkboxes default to off; the original `model` and `clip` output positions are preserved.
*   **Lora Tester Selector**: Allows selection of multiple LoRA models and definition of their strengths. Enables easy benchmarking and A/B testing.
*   **Lora Grid Saver**: Automatically arranges generated images into a labeled grid, making it easy to visually compare the impact of different LoRA models.

### 🖼️ Image Loading

*   **Load Image From Directory v2 (Szandor)** (`SzandorDirectoryImageLoader`): Enter a directory on the ComfyUI server and use the arrows to select an image. Shows a preview, filename, and dimensions; refresh reloads the file list. Directory history is stored in the browser, while the selected directory and file persist in the workflow. Outputs `image` and a transparency-derived `mask`.
*   **Image Passthrough (Szandor)** (`ImagePassthrough`): Set `slot_count` to expose 1–30 matching `in_N` → `out_N` image pairs. Active connected inputs pass through unchanged; unconnected outputs return an 8 × 8 black image.
*   **Folder Media + Prompt Loader (Szandor)** (`SzandorFolderMediaLoader`): Loads an image, video, or audio file from a directory together with its prompt and duration. Files are grouped by name without extension, e.g. `shot01.png` + `shot01.txt` or `shot01.mp4` + `shot01.json` (+ optional `shot01.wav`), and sorted naturally.
    *   **Prompt and time**: `.txt` holds the prompt (UTF-8). `.json` looks like `{"time": 5, "prompt": "…"}`; `time` accepts seconds (`5`, `"5.5s"`) or `"mm:ss"`. A JSON prompt takes precedence over `.txt`. Without `time`, the video duration is used, then the audio duration, then `default_time`.
    *   **start_time / end_time (optional)**: JSON may also contain `start_time` and `end_time` (same formats as `time`). Missing fields are safe: `start_time` = 0 and `end_time` = `start_time + time`; with both present and no `time`, time = `end_time − start_time`. Invalid or reversed values only produce a warning. They are exposed as outputs; media is not trimmed.
    *   **Number or text (`time_output`)**: chooses how `time`, `start_time`, and `end_time` are output: `liczba` (FLOAT seconds), `tekst: sekundy` (`"5.5"`), `tekst: mm:ss.mmm` (`"00:05.500"`), or `tekst: hh:mm:ss.mmm` (`"00:00:05.500"`). The outputs switch between FLOAT and STRING; links to inputs that cannot accept the new type are disconnected. `frames` is always an integer.
    *   **JSON format**: a single UTF-8 object named after the media file (`shot01.mp4` → `shot01.json`). Every field is optional; unknown fields are ignored.

        | Field | Aliases | Type | When missing |
        |---|---|---|---|
        | `prompt` | `text`, `positive` | string | prompt from `shot01.txt`, else empty |
        | `time` | `duration`, `seconds`, `czas` | time | `end_time − start_time`, then video/audio duration, then `default_time` |
        | `start_time` | `start`, `time_start` | time | `0` |
        | `end_time` | `end`, `time_end` | time | `start_time + time` |

        A time is a number of seconds (`5`, `2.5`) or a string: `"5"`, `"5s"`, `"00:07.5"` (mm:ss), `"0:01:02.5"` (h:mm:ss). Full example:

        ```json
        {
          "start_time": "00:02",
          "end_time": 7.5,
          "time": 5.5,
          "prompt": "Wide shot of a foggy harbor at dawn, slow dolly-in."
        }
        ```

        Minimal variants: `{"time": 5, "prompt": "…"}` (no range: `start_time` = 0, `end_time` = 5) or `{"start_time": 2, "end_time": 7, "prompt": "…"}` (time computed as 5 s). Write line breaks in the prompt as `\n`.
    *   **Seed**: selects the entry (`index = seed mod count`) with the standard `control_after_generate` modes: fixed, increment, decrement, randomize. The ◀ ▶ arrows set the seed.
    *   **Outputs**: `image` (image or first video frame; black 64×64 for audio/prompt-only entries), `video` (`VIDEO`), `audio` (audio file, else the video's soundtrack, else silence of length `time`), `prompt`, `time`, `frames` (`time × fps`), `seed`, `filename`, `index`, `count`, `start_time`, `end_time`. A connected `video` output raises an error for entries without video — use `media_filter = wideo`.
    *   **Whole folder**: **⏭ Wszystkie (N)** asks for confirmation, sets the seed to 0 and the mode to `increment`, then queues N runs — one per entry.
    *   **Preview and settings**: responsive preview of the image / first video frame (with video and audio playback), file badges, resolution, time, and prompt. Settings and node size persist in the workflow; the latest settings and directory history are also remembered in the browser for new nodes.
    *   **Drag and drop**: drop an image, video, audio, `.json`, or `.txt` file (or several) onto the node. If an identical file already exists in the directory, the node just selects its entry (sets the seed), so the JSON / image with the same name loads too — dropping an image shows its prompt and vice versa. New files are copied into the directory and selected; an image and JSON dropped together form one entry. If the name is taken by a different file, the whole set gets a `_2`, `_3`… suffix — existing files are never overwritten. With no directory set, files go to `ComfyUI/input/szandor_folder_media`, which becomes the node's directory. An entry hidden by `media_filter` switches the filter to `wszystko`.
*   **Save As Source Name (Szandor)** (`SzandorSaveAsSource`): Optional saver that names results after the loader entry. Connect `filename` from the loader and any of `image`, `video`, `audio`, `prompt` (plus `time`, `start_time`, `end_time` to write JSON with the connected values instead of TXT). `enabled` turns saving off without disconnecting. Empty `output_directory` = `ComfyUI/output/szandor_folder_media` (relative paths are under `output`). `on_exists`: number the whole set (`_2`, `_3`…), overwrite, or skip. Image batches become `name_0001.png`…; audio is 16-bit WAV.
*   **Szandor Auto Crop** (`SzandorAutoCrop`): Crops an image or batch to selected proportions, with center/edge alignment and dimension divisibility by 64, 32, 16, or 8. Connect `image`, select the options, and use the cropped `image` output. Does not rescale; images too small for the requested proportions and divisibility fall back to dimensions that fit the source, so the resulting aspect ratio may differ.
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
    git clone https://github.com/szandor25/ComfyUI-Szandor.git
    ```
3.  Install required requirements:
    ```bash
    cd ComfyUI-Szandor
    python -m pip install -r requirements.txt python-dotenv
    ```

Use the Python environment that runs ComfyUI. Existing LLM integrations also require `python-dotenv`. Restart ComfyUI and refresh the browser with **Ctrl+F5** to load the nodes and their interfaces.

## 🔄 Updating and starting the H3 editor

Run `git pull --ff-only` inside the installed repository, restart ComfyUI, and refresh the browser with **Ctrl+F5**. Search for **MiniMax H3 — Edytor promptów (Szandor)** under `Szandor/Prompt`. Connect `prompt` to your H3 text encoder's `text` input, enter your prompt, and save the workflow to retain the text and editor dimensions. The editor itself does not load a model or generate video.

## 📝 Recent changes

*   **2026-10-06 — Drag and drop**: Folder Media Loader accepts dropped images, video, audio, and JSON / TXT (selects the existing entry with its companions or copies new files into the directory); the MiniMax H3 editor inserts the prompt from a dropped `.json` file.
*   **2026-09-29 — Folder Media Loader: `time_output`**: time outputs as a number or text (seconds, mm:ss.mmm, hh:mm:ss.mmm).
*   **2026-09-28 — Folder Media Loader: start_time / end_time**: optional JSON fields and new `start_time` / `end_time` outputs; documented JSON format with an example.
*   **2026-09-27 — Folder Media + Prompt Loader**: loads images, video, and audio from a directory with `.txt` / `.json` prompts (with time), seed-driven selection, a responsive preview, and whole-folder queueing; optional saving under the source name (**Save As Source Name**).
*   **2026-09-09 — MiniMax H3 editor**: syntax highlighting, dialogue pairing and diagnostics, tag/template insertion, resizing, and workflow size persistence. Includes syntax tests and a Chromium UI test.
*   **LoRA Stack columns** (`9a16ac1`): configurable entries per column, saved in the workflow.
*   **LoRA Stack triggers** (`44c90e0`): local trigger loading, editing, prompt integration, and suggestions from training metadata.
*   **Documentation**: added missing image-node descriptions, corrected the Qwen descriptions, and completed installation/update instructions. See the [repository commits](https://github.com/szandor25/ComfyUI-Szandor/commits/main/) for the full history.

## 🧪 Tests

From the repository directory, run `python -m unittest discover -s tests -p 'test_*.py'` and `node --test tests/test_h3_prompt_syntax.mjs` (Node.js with ES module detection for `.js`, such as 22.7+). Run the browser test with `CHROME_PATH=/path/to/chrome node tests/test_h3_prompt_browser.mjs`. It requires no npm packages, uses a minimal ComfyUI widget host, and does not run H3 generation.

## 🔑 Configuration

To use the LLM nodes, you need to configure API keys.

1.  Edit `config.json` (optional, to add custom models).
2.  Set environment variables in your system or startup script:
    *   `DASHSCOPE_API_KEY` (for Qwen)
    *   `OPENAI_API_KEY` (for OpenAI)
    *   `DEEPSEEK_API_KEY` (for DeepSeek)
    *   `XAI_API_KEY` (for Grok)
