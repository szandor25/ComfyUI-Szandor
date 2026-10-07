import { app } from "../../scripts/app.js";
import { analyzePrompt, highlightPrompt, SNIPPET_GROUPS, SNIPPETS } from "./h3_prompt_syntax.js";
import { createAutocomplete } from "./h3_autocomplete.js";
import { openTemplates } from "./h3_templates.js";

const NODE_TYPE = "SzandorMiniMaxH3Prompt";
const MIN_SIZE = [360, 300];
const DEFAULT_SIZE = [640, 480];
const SIZE_PROPERTY = "szandorH3EditorSize";
const AUTOCOMPLETE_PROPERTY = "szandorH3Autocomplete";

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

// Te same pola co w Folder Media + Prompt Loader: prompt, text, positive (pierwsze niepuste).
const JSON_PROMPT_KEYS = ["prompt", "text", "positive"];

export function promptFromJson(content) {
    let data;
    try {
        data = JSON.parse(content.replace(/^﻿/, ""));
    } catch {
        return null;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const key = JSON_PROMPT_KEYS.find(k => typeof data[k] === "string" && data[k].trim());
    return key ? data[key] : null;
}

function validSize(size) {
    return size?.length === 2 && Array.from(size).every(v => Number.isFinite(v) && v > 0);
}

export function createEditor(node, name, inputData) {
    installStyles();
    const root = element("div", "szandor-h3-editor");
    const toolbar = element("div", "h3-toolbar");
    const snippets = element("select", "h3-snippets");
    snippets.setAttribute("aria-label", "Tag or template to insert");
    for (const [groupLabel, items] of SNIPPET_GROUPS) {
        const group = element("optgroup");
        group.label = groupLabel;
        for (const [id, label] of items) {
            const option = element("option", "", label);
            option.value = id;
            group.append(option);
        }
        snippets.append(group);
    }
    const insert = element("button", "h3-button", "Insert");
    insert.type = "button";
    insert.title = "Insert at the cursor; dialogue wraps the selected text. Ctrl+Z undoes.";
    const suggest = element("button", "h3-button h3-suggest", "Suggestions");
    suggest.type = "button";
    suggest.title = "Suggest tags while typing (<, [, (, section names, camera moves). Ctrl+Space always works.";
    const autocompleteEnabled = () => node.properties?.[AUTOCOMPLETE_PROPERTY] !== false;
    const help = element("button", "h3-button", "Syntax");
    help.type = "button";
    help.setAttribute("aria-expanded", "false");
    const templates = element("button", "h3-button", "Templates");
    templates.type = "button";
    templates.title = "Save and load workflows with the full prompt and copies of the images";
    const paste = element("button", "h3-button h3-paste", "📋");
    paste.type = "button";
    paste.title = "Paste the prompt from the clipboard — replaces all text. Ctrl+Z undoes.";
    paste.setAttribute("aria-label", "Paste prompt from the clipboard");
    toolbar.append(snippets, insert, suggest, paste, help, templates);
    const clipboardStatus = element("p", "h3-clipboard-status");
    clipboardStatus.hidden = true;
    clipboardStatus.setAttribute("role", "status");

    const guide = element("div", "h3-guide");
    guide.hidden = true;
    for (const [kind, label] of [
        ["dialogue", "<d>[Polish] Spoken words</d> — put the voice description and (S1) before <d>. Change the language as needed."],
        ["shot", "[Shot 1] · [Shot 2] At 00:03.000, … — the next cut time; adjust the number and time."],
        ["reference", "<Subject 1> · <Picture 1> · <Video 1> · <Audio 1> — match the numbers to the references in the workflow."],
        ["boundary", "<scenetrans> — a line across a cut (on both sides); <cutoff> — cut off by the video end. No closing tag needed."],
        ["section", "Write the scene description in English; dialogue, singing and on-screen text keep their language. Templates need filling in."],
        ["tag", "Grey tags are not recognized by the editor. They stay in the text. Hints never block generation."],
        ["speaker", "Suggestions: type <, [ or (, the start of a section name on a new line, a word after \"camera\" / \"shot\" / (S1), or a relation after \"<Subject 1> …:\". Ctrl+Space also offers camera, cut and continuity phrases for the current word. ↑↓ select, Enter / Tab insert, Esc closes."],
    ]) guide.append(element("p", `h3-${kind}`, label));
    const source = element("a", "", "Official MiniMax H3 prompt guide ↗");
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
    input.placeholder = "Type or paste a prompt, or drop a .txt / .json file…\n\n(S1) says: <d>[English] Hello!</d>";
    input.title = "Drop a .txt or .json file (prompt field) to replace the whole prompt.";
    input.value = inputData?.[1]?.default ?? "";
    templates.addEventListener("click", () => openTemplates(node, () => input.value));
    surface.append(mirror, input);

    const footer = element("div", "h3-footer");
    const status = element("button", "h3-status");
    status.type = "button";
    const grip = element("div", "h3-grip", "◢");
    grip.title = "Drag to resize. The size is saved in the workflow.";
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
        status.textContent = count ? `⚠ ${count} ${count === 1 ? "hint" : "hints"} — ${analysis.issues[issueIndex % count].message}` : "<d> dialogue · [ ] shot / language · < > references · Ctrl+Space suggestions";
        suggest.setAttribute("aria-pressed", String(autocompleteEnabled()));
        status.classList.toggle("h3-has-issues", count > 0);
        status.disabled = !count;
        status.title = count ? "Click to select the next hint. " + analysis.issues.map(i => i.message).join("\n") : "Colors mark the syntax; the text goes to the prompt output unchanged.";
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
    const autocomplete = createAutocomplete({ input, container: surface, enabled: autocompleteEnabled, onFallbackEdit: changed });
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
        // Obraz przeciągnięty razem ze swoim JSON-em jest pomijany — liczy się jeden plik z promptem.
        const promptFiles = files.filter(file => /\.(txt|json)$/i.test(file.name));
        if (promptFiles.length !== 1) {
            report("Drop a single .txt or .json file with the prompt.");
            return;
        }
        const [file] = promptFiles;
        const previous = input.value;
        clipboardStatus.hidden = true;
        try {
            const content = await file.text();
            if (disposed || request !== fileRead) return;
            const text = /\.json$/i.test(file.name) ? promptFromJson(content) : content;
            if (text === null) {
                report("The JSON file has no prompt field (nor text / positive). The prompt was not changed.");
                return;
            }
            if (input.value !== previous) {
                report("The prompt changed while reading. Drop the file again to replace it.");
                return;
            }
            if (!text) {
                report("The file is empty. The prompt was not changed.");
                return;
            }
            replacePrompt(text);
            report(`Loaded: ${file.name}`);
        } catch {
            if (!disposed && request === fileRead) report("Could not read the file. Drop it again.");
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
                clipboardStatus.textContent = "The prompt changed while reading the clipboard. Click 📋 again to replace it.";
                clipboardStatus.hidden = false;
                return;
            }
            if (!text) {
                clipboardStatus.textContent = "The clipboard contains no text.";
                clipboardStatus.hidden = false;
                return;
            }
            replacePrompt(text);
        } catch {
            if (disposed) return;
            input.focus({ preventScroll: true });
            input.select();
            clipboardStatus.textContent = "The browser blocked the clipboard. Press Ctrl+V (Mac: ⌘V) to replace the selected prompt.";
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
    suggest.addEventListener("mousedown", event => event.preventDefault());
    suggest.addEventListener("click", () => {
        node.properties ??= {};
        node.properties[AUTOCOMPLETE_PROPERTY] = !autocompleteEnabled();
        suggest.setAttribute("aria-pressed", String(autocompleteEnabled()));
        if (!autocompleteEnabled()) autocomplete.close();
        node.graph?.change?.();
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
        autocomplete.dispose();
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
