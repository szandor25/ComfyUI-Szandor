import { app } from "../../scripts/app.js";
import { analyzePrompt, highlightPrompt, SNIPPETS } from "./h3_prompt_syntax.js";
import { openTemplates } from "./h3_templates.js";

const NODE_TYPE = "SzandorMiniMaxH3Prompt";
const MIN_SIZE = [360, 300];
const DEFAULT_SIZE = [640, 480];
const SIZE_PROPERTY = "szandorH3EditorSize";

function installStyles() {
    if (document.getElementById("szandor-h3-prompt-style")) return;
    const link = document.createElement("link");
    link.id = "szandor-h3-prompt-style";
    link.rel = "stylesheet";
    link.href = new URL("./minimax_h3_prompt.css", import.meta.url).href;
    document.head.append(link);
}

function element(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text) el.textContent = text;
    return el;
}

function validSize(size) {
    return size?.length === 2 && Array.from(size).every(v => Number.isFinite(v) && v > 0);
}

export function createEditor(node, name, inputData) {
    installStyles();
    const root = element("div", "szandor-h3-editor");
    const toolbar = element("div", "h3-toolbar");
    const snippets = element("select", "h3-snippets");
    snippets.setAttribute("aria-label", "Znacznik lub szablon do wstawienia");
    for (const [id, label] of SNIPPETS) {
        const option = element("option", "", label);
        option.value = id;
        snippets.append(option);
    }
    const insert = element("button", "h3-button", "Wstaw");
    insert.type = "button";
    insert.title = "Wstaw w miejscu kursora; dialog obejmie zaznaczony tekst. Ctrl+Z cofa zmianę.";
    const help = element("button", "h3-button", "Składnia");
    help.type = "button";
    help.setAttribute("aria-expanded", "false");
    const templates = element("button", "h3-button", "Szablony");
    templates.type = "button";
    templates.title = "Zapisuj i wczytuj workflow z pełnym promptem i kopiami zdjęć";
    const paste = element("button", "h3-button h3-paste", "📋");
    paste.type = "button";
    paste.title = "Wklej prompt ze schowka — zastępuje całą treść. Ctrl+Z cofa zmianę.";
    paste.setAttribute("aria-label", "Wklej prompt ze schowka");
    toolbar.append(snippets, insert, paste, help, templates);
    const clipboardStatus = element("p", "h3-clipboard-status");
    clipboardStatus.hidden = true;
    clipboardStatus.setAttribute("role", "status");

    const guide = element("div", "h3-guide");
    guide.hidden = true;
    for (const [kind, label] of [
        ["dialogue", "<d>[Polish] Słowa dialogu</d> — opis głosu i (S1) umieść przed <d>. Język możesz zmienić ręcznie."],
        ["shot", "[Shot 1] · [Shot 2] At 00:03.000, … — czas kolejnego cięcia; dopasuj numer i czas."],
        ["reference", "<Subject 1> · <Picture 1> · <Video 1> · <Audio 1> — dopasuj numery do referencji w workflow."],
        ["boundary", "<scenetrans> — dialog przez cięcie (po obu stronach); <cutoff> — urwany przez koniec filmu. Nie wymagają zamknięcia."],
        ["section", "Opis sceny pisz po angielsku; dialog, śpiew i tekst na ekranie zachowują swój język. Szablony wymagają uzupełnienia."],
        ["tag", "Szare znaczniki są nierozpoznane przez edytor. Pozostają w tekście. Podpowiedzi nie blokują generowania."],
    ]) guide.append(element("p", `h3-${kind}`, label));
    const source = element("a", "", "Oficjalny poradnik MiniMax H3 ↗");
    source.href = "https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing/references";
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    guide.append(source);

    const surface = element("div", "h3-surface");
    const mirror = element("pre", "h3-text h3-highlight");
    mirror.setAttribute("aria-hidden", "true");
    const input = element("textarea", "h3-text h3-input");
    input.setAttribute("aria-label", "Prompt MiniMax H3");
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("autocapitalize", "off");
    input.wrap = "soft";
    input.placeholder = "Wpisz, wklej prompt lub przeciągnij plik .txt…\n\n(S1) says: <d>[Polish] Cześć!</d>";
    input.title = "Przeciągnij jeden plik .txt, aby zastąpić cały prompt.";
    input.value = inputData?.[1]?.default ?? "";
    templates.addEventListener("click", () => openTemplates(node, () => input.value));
    surface.append(mirror, input);

    const footer = element("div", "h3-footer");
    const status = element("button", "h3-status");
    status.type = "button";
    const grip = element("div", "h3-grip", "◢");
    grip.title = "Przeciągnij, aby zmienić rozmiar. Rozmiar zapisuje się w workflow.";
    grip.setAttribute("aria-hidden", "true");
    footer.append(status, grip);
    root.append(toolbar, clipboardStatus, guide, surface, footer);

    let analysis;
    let issueIndex = 0;
    let frame = 0;
    let disposed = false;
    function syncScroll() {
        // Match the text viewport exactly, including a non-overlay scrollbar.
        mirror.style.width = `${input.clientWidth}px`;
        mirror.style.height = `${input.clientHeight}px`;
        mirror.scrollTop = input.scrollTop;
        mirror.scrollLeft = input.scrollLeft;
    }
    function render() {
        analysis = analyzePrompt(input.value);
        mirror.innerHTML = highlightPrompt(input.value, analysis, input.selectionStart);
        const count = analysis.issues.length;
        status.textContent = count ? `⚠ ${count} uwag — ${analysis.issues[issueIndex % count].message}` : "<d> dialog · [ ] ujęcie / język · < > referencje";
        status.classList.toggle("h3-has-issues", count > 0);
        status.disabled = !count;
        status.title = count ? "Kliknij, aby zaznaczyć kolejną uwagę. " + analysis.issues.map(i => i.message).join("\n") : "Kolory oznaczają składnię; tekst trafia bez zmian na wyjście prompt.";
        syncScroll();
    }
    function scheduleRender() {
        if (frame || disposed) return;
        frame = requestAnimationFrame(() => { frame = 0; render(); });
    }

    const widget = node.addDOMWidget(name, "SZANDOR_H3_PROMPT", root, {
        getValue: () => input.value,
        setValue: value => {
            input.value = typeof value === "string" ? value : "";
            issueIndex = 0;
            render();
        },
        getMinHeight: () => 230,
        hideOnZoom: false,
    });
    // ComfyUI extensions use inputEl for text selection and widget conversion.
    widget.inputEl = input;
    widget.options.dynamicPrompts = false;
    widget.serializeValue = () => input.value;

    const changed = () => {
        issueIndex = 0;
        scheduleRender();
        widget.callback?.(input.value);
        node.graph?.change?.();
        node.setDirtyCanvas?.(true, true);
    };
    input.addEventListener("input", changed);
    input.addEventListener("input", () => { clipboardStatus.hidden = true; });
    input.addEventListener("scroll", syncScroll);
    input.addEventListener("click", scheduleRender);
    input.addEventListener("keyup", scheduleRender);
    input.addEventListener("select", scheduleRender);
    // Leave editing, paste, IME, and undo to the native textarea; keep graph
    // shortcuts (Delete, Ctrl+A, etc.) from handling those same keystrokes.
    root.addEventListener("keydown", event => event.stopPropagation());
    root.addEventListener("pointerdown", event => event.stopPropagation());
    root.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
    root.addEventListener("dblclick", event => event.stopPropagation());

    function replacePrompt(text) {
        input.focus({ preventScroll: true });
        input.select();
        // Native insertion keeps replacement in the textarea's undo history.
        const inserted = document.execCommand?.("insertText", false, text);
        if (!inserted) {
            input.setRangeText(text, 0, input.value.length, "end");
            changed();
        }
        scheduleRender();
    }

    let fileRead = 0;
    root.addEventListener("dragover", event => {
        if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
    });
    root.addEventListener("drop", async event => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        const request = ++fileRead;
        const report = text => {
            clipboardStatus.textContent = text;
            clipboardStatus.hidden = false;
        };
        if (files.length !== 1 || !/\.txt$/i.test(files[0].name)) {
            report("Przeciągnij jeden plik .txt z promptem.");
            return;
        }
        const previous = input.value;
        clipboardStatus.hidden = true;
        try {
            const text = await files[0].text();
            if (disposed || request !== fileRead) return;
            if (input.value !== previous) {
                report("Prompt zmienił się podczas odczytu. Przeciągnij plik ponownie, aby go zastąpić.");
                return;
            }
            if (!text) {
                report("Plik jest pusty. Prompt pozostał bez zmian.");
                return;
            }
            replacePrompt(text);
            report(`Wczytano: ${files[0].name}`);
        } catch {
            if (!disposed && request === fileRead) report("Nie udało się odczytać pliku. Przeciągnij go ponownie.");
        }
    });

    paste.addEventListener("mousedown", event => event.preventDefault());
    paste.addEventListener("click", async () => {
        if (paste.disabled) return;
        paste.disabled = true;
        clipboardStatus.hidden = true;
        const previous = input.value;
        try {
            const text = await navigator.clipboard.readText();
            if (disposed) return;
            if (input.value !== previous) {
                clipboardStatus.textContent = "Prompt zmienił się podczas odczytu schowka. Kliknij 📋 ponownie, aby go zastąpić.";
                clipboardStatus.hidden = false;
                return;
            }
            if (!text) {
                clipboardStatus.textContent = "Schowek nie zawiera tekstu.";
                clipboardStatus.hidden = false;
                return;
            }
            replacePrompt(text);
        } catch {
            if (disposed) return;
            input.focus({ preventScroll: true });
            input.select();
            clipboardStatus.textContent = "Przeglądarka nie udostępniła schowka. Naciśnij Ctrl+V (Mac: ⌘V), aby zastąpić zaznaczony prompt.";
            clipboardStatus.hidden = false;
        } finally { paste.disabled = false; }
    });

    insert.addEventListener("mousedown", event => event.preventDefault());
    insert.addEventListener("click", () => {
        const [, , prefix, suffix] = SNIPPETS.find(s => s[0] === snippets.value);
        const start = input.selectionStart;
        const selected = input.value.slice(start, input.selectionEnd);
        input.focus({ preventScroll: true });
        // insertText preserves the browser's undo history, unlike assigning
        // textarea.value. setRangeText is a fallback for browsers without it.
        const replacement = prefix + selected + suffix;
        const inserted = document.execCommand?.("insertText", false, replacement);
        if (!inserted) {
            input.setRangeText(replacement, start, input.selectionEnd, "end");
            changed();
        }
        input.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
        scheduleRender();
    });
    help.addEventListener("click", () => {
        guide.hidden = !guide.hidden;
        help.setAttribute("aria-expanded", String(!guide.hidden));
        scheduleRender();
    });
    status.addEventListener("click", () => {
        const issue = analysis.issues[issueIndex % analysis.issues.length];
        if (!issue) return;
        input.focus({ preventScroll: true });
        // Collapse first so the browser scrolls the relevant line into view.
        input.setSelectionRange(issue.start, issue.end);
        issueIndex++;
        scheduleRender();
    });

    let drag = null;
    grip.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        event.preventDefault();
        const scale = root.getBoundingClientRect().width / root.offsetWidth || 1;
        drag = { x: event.clientX, y: event.clientY, size: Array.from(node.size), scale };
        node.graph?.beforeChange?.();
        grip.setPointerCapture(event.pointerId);
    });
    grip.addEventListener("pointermove", event => {
        if (!drag) return;
        node.setSize([
            Math.max(MIN_SIZE[0], drag.size[0] + (event.clientX - drag.x) / drag.scale),
            Math.max(MIN_SIZE[1], drag.size[1] + (event.clientY - drag.y) / drag.scale),
        ]);
        node.setDirtyCanvas?.(true, true);
    });
    const endDrag = () => {
        if (!drag) return;
        drag = null;
        node.graph?.afterChange?.();
    };
    grip.addEventListener("pointerup", endDrag);
    grip.addEventListener("pointercancel", endDrag);
    grip.addEventListener("lostpointercapture", endDrag);

    const observer = new ResizeObserver(scheduleRender);
    observer.observe(surface);
    const originalRemove = widget.onRemove;
    widget.onRemove = function (...args) {
        disposed = true;
        cancelAnimationFrame(frame);
        observer.disconnect();
        endDrag();
        return originalRemove?.apply(this, args);
    };
    render();
    return { widget, minWidth: MIN_SIZE[0], minHeight: MIN_SIZE[1] };
}

app.registerExtension({
    name: "Szandor.MiniMaxH3Prompt",
    getCustomWidgets() {
        return { SZANDOR_H3_PROMPT: createEditor };
    },
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function (...args) {
            const result = originalCreated?.apply(this, args);
            this.setSize([...DEFAULT_SIZE]);
            return result;
        };
        const originalResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size, ...args) {
            const result = originalResize?.call(this, size, ...args);
            if (validSize(size)) {
                this.properties ??= {};
                this.properties[SIZE_PROPERTY] = Array.from(size);
            }
            return result;
        };
        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (config, ...args) {
            const result = originalConfigure?.call(this, config, ...args);
            const saved = validSize(config?.size) ? config.size : config?.properties?.[SIZE_PROPERTY];
            if (validSize(saved)) this.setSize(Array.from(saved));
            return result;
        };
        const originalSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (data, ...args) {
            const result = originalSerialize?.call(this, data, ...args);
            data.properties ??= {};
            data.properties[SIZE_PROPERTY] = Array.from(this.size);
            return result;
        };
    },
});
