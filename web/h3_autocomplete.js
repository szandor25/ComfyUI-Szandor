// Autocomplete for the MiniMax H3 prompt editor. completionsAt() is pure and
// testable in Node; createAutocomplete() wires it to the textarea.
import {
    AUDIO_RELATIONS, CAMERA_MODIFIERS, CAMERA_MOVES, CONTINUITY_PHRASES, CUT_VERBS, LANGUAGES,
    LIPS_CLOSED, SECTION_NAMES, STYLES, TASK_TYPES, VISUAL_RELATIONS, escapeHTML,
} from "./h3_prompt_syntax.js";

const REFERENCE_KINDS = ["Subject", "Picture", "Video", "Audio"];
const MAX_ITEMS = 60;
const MOVE_PATTERN = CAMERA_MOVES.map(([phrase]) => phrase).filter(p => !p.includes("static")).join("|");

const item = (text, detail = "", extra = {}) => ({ label: text.trimEnd(), text, detail, ...extra });
const unique = values => [...new Set(values)];

function numbers(text, pattern) {
    return unique([...text.matchAll(pattern)].map(m => Number(m[1]))).sort((a, b) => a - b);
}

function formatTime(ms) {
    const total = Math.max(0, Math.round(ms));
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor(total / 1000) % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(total % 1000).padStart(3, "0")}`;
}

function context(text, before) {
    const speakers = unique([...text.matchAll(/\((S\d+(?:,\s*S\d+)*)\)/g)]
        .flatMap(m => m[1].split(",").map(s => Number(s.trim().slice(1))))).sort((a, b) => a - b);
    const languages = [...before.matchAll(/<d>\s*\[([\p{L}][^\]\n]*)\]/gu)].map(m => m[1]);
    const cuts = [...before.matchAll(/\[Shot \d+\] At (\d+):(\d\d)\.(\d{3})/g)].map(m => (+m[1] * 60 + +m[2]) * 1000 + +m[3]);
    const opens = (before.match(/<d>/g) ?? []).length;
    const closes = (before.match(/<\/d>/g) ?? []).length;
    return {
        speakers,
        shots: numbers(text, /\[Shot (\d+)\]/g),
        refs: Object.fromEntries(REFERENCE_KINDS.map(kind => [kind, numbers(text, new RegExp(`<${kind} (\\d+)>`, "g"))])),
        language: languages.at(-1) ?? "Polish",
        nextCut: cuts.length ? Math.max(...cuts) + 3000 : 3000,
        inDialogue: opens > closes,
    };
}

function dialogueItem(prefix, language, suffix = "", detail = "") {
    const text = `${prefix}<d>[${language}] </d>${suffix}`;
    return item(text, detail, { label: `${prefix}<d>[${language}] …</d>${suffix ? " …" : ""}`, caret: prefix.length + language.length + 6 });
}

function angleItems(ctx) {
    const items = [];
    if (ctx.inDialogue) items.push(item("</d>", "close dialogue"));
    for (const language of unique([ctx.language, "Polish", "English"])) items.push(dialogueItem("", language, "", "dialogue"));
    for (const kind of REFERENCE_KINDS) {
        const used = ctx.refs[kind];
        for (const n of used) items.push(item(`<${kind} ${n}>`, "used"));
        items.push(item(`<${kind} ${(used.at(-1) ?? 0) + 1}>`, used.length ? "new reference" : "reference"));
    }
    items.push(item("<scenetrans>", "line across a cut"), item("<cutoff>", "cut off by the video end"));
    if (!ctx.inDialogue) items.push(item("</d>", "close dialogue"));
    return items;
}

function bracketItems(ctx, afterDialogue, line) {
    const languages = LANGUAGES.includes(ctx.language) ? unique([ctx.language, ...LANGUAGES]) : [ctx.language, ...LANGUAGES];
    const langs = languages.map(lang => item(`[${lang}] `, "dialogue language"));
    if (afterDialogue) return [...langs, item("[unclear]", "unintelligible span")];
    const next = (ctx.shots.at(-1) ?? 0) + 1;
    const shots = [];
    if (next === 1) shots.push(item("[Shot 1] ", "first shot"));
    else {
        const time = formatTime(ctx.nextCut);
        const prefix = `[Shot ${next}] At `;
        shots.push(item(`${prefix}${time}, the camera cuts to `, "new shot — adjust the time", { select: [prefix.length, prefix.length + time.length] }));
    }
    for (const n of ctx.shots) shots.push(item(`[Shot ${n}]`, "shot reference"));
    const tasks = TASK_TYPES.map(type => item(`[${type}] `, "task type (summary)"));
    const summary = /^\s*summary:/.test(line);
    return summary ? [...tasks, ...shots, ...langs] : [...shots, ...langs, item("[unclear]", "unintelligible span"), ...tasks];
}

function speakerItems(ctx, line) {
    const items = [];
    if (/^\s*<(?:Subject|Picture|Video) \d+>\s*\([a-z[ ]*$/i.test(line)) {
        items.push(item("(appears in [Shot 1]): ", "retention_analysis", { select: [12, 20] }));
        if (/^\s*<Picture/.test(line)) items.push(item("([Shot 1] first frame): ", "retention_analysis", { select: [1, 9] }));
    }
    for (const n of ctx.speakers) items.push(item(`(S${n})`, "used speaker"));
    items.push(item(`(S${(ctx.speakers.at(-1) ?? 0) + 1})`, ctx.speakers.length ? "new speaker" : "speaker"));
    if (ctx.speakers.length >= 2) items.push(item(`(S${ctx.speakers[0]},S${ctx.speakers[1]})`, "joint line"));
    return items;
}

function speechItems(ctx, group) {
    const lang = ctx.language;
    if (group) return [dialogueItem("shout together, ", lang), dialogueItem("sing together, ", lang), dialogueItem("say together, ", lang)];
    return [
        dialogueItem("says: ", lang),
        dialogueItem("says in an off-screen voiceover: ", lang, LIPS_CLOSED, "voiceover — lips closed"),
        dialogueItem("sings: ", lang),
        dialogueItem("shouts: ", lang),
        dialogueItem("whispers: ", lang),
        dialogueItem("replies, ", lang),
        dialogueItem("asks, ", lang),
    ];
}

function phraseItems() {
    return [
        ...CAMERA_MOVES.map(([phrase, label]) => item(`${phrase} `, label)),
        ...CAMERA_MODIFIERS.map(([phrase, label]) => item(`${phrase} `, label)),
        ...CUT_VERBS.map(([phrase, label]) => item(`${phrase} `, label)),
        ...CONTINUITY_PHRASES.map(phrase => item(phrase, "audio continuity")),
        item("says in an off-screen voiceover: ", "voiceover"),
        item(LIPS_CLOSED.trim(), "after a voiceover"),
        item("the shot begins from <Picture 1>", "frame anchor"),
        item("the shot's keyframe corresponds to <Picture 1>", "frame anchor"),
        item("the shot ends on <Picture 1>", "frame anchor"),
        item("The target video is an edited version of <Video 1>. ", "editing summary"),
        ...STYLES.map(style => item(`${style}, `, "style")),
    ];
}

// Word-start match: "le" finds "pans left" but "a" does not find "transitions".
function matches(text, query) {
    const q = query.toLowerCase();
    if (!q) return 2;
    const t = text.toLowerCase();
    if (t.startsWith(q)) return t.length === q.length ? 0 : 3;
    return t.split(/[\s<>[\](),:_-]+/).some(word => word.startsWith(q)) ? 1 : 0;
}

function rank(items, query) {
    const scored = items.map((entry, index) => ({ entry, index, score: matches(entry.text, query) })).filter(s => s.score > 0);
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    const seen = new Set();
    return scored.map(s => s.entry).filter(entry => !seen.has(entry.text) && seen.add(entry.text)).slice(0, MAX_ITEMS);
}

function result(caret, query, items) {
    const ranked = rank(items, query);
    return ranked.length ? { start: caret - query.length, end: caret, query, items: ranked } : null;
}

/**
 * Suggestions for the text before `caret`, or null. Automatic suggestions open
 * on H3 syntax characters (<, [, (), section names at line start, relation
 * markers and phrases after "camera"/"shot"/speakers; `manual` (Ctrl+Space)
 * also offers camera, cut and continuity phrases for the current word.
 */
export function completionsAt(text, caret, { manual = false } = {}) {
    const before = text.slice(0, caret);
    const line = before.slice(before.lastIndexOf("\n") + 1);
    let cached;
    const ctx = () => cached ??= context(text, before);
    const wordy = query => manual || query.length >= 1;
    let m;
    if ((m = /<\/?[A-Za-z]*(?: \d*)?$/.exec(line))) return result(caret, m[0], angleItems(ctx()));
    if ((m = /\[([^[\]\n]{0,40})$/.exec(line))) {
        const task = /^(.*\+\s*)([a-z ]*)$/i.exec(m[1]);
        if (task) {
            const present = task[1].toLowerCase();
            return result(caret, task[2], TASK_TYPES.filter(type => !present.includes(type)).map(type => item(type, "another task type")));
        }
        const afterDialogue = /<d>\s*$/.test(line.slice(0, line.length - m[0].length));
        return result(caret, m[0], bracketItems(ctx(), afterDialogue, line));
    }
    if ((m = /\((?:S\d*(?:,\s*S?\d*)*|[a-z[ ]*)$/.exec(line))) {
        const res = result(caret, m[0], speakerItems(ctx(), line));
        if (res || m[0] !== "(") return res;
    }
    if ((m = /^\s*<(Subject|Picture|Video|Audio) \d+>[^:\n]*:\s*([a-z_]*)$/.exec(line))) {
        const relations = m[1] === "Audio" ? AUDIO_RELATIONS : VISUAL_RELATIONS;
        return result(caret, m[2], relations.map(rel => item(`${rel} - `, "relation")));
    }
    if ((m = /^[a-z_]+$/.exec(line)) && (manual || m[0].length >= 2)) {
        const res = result(caret, m[0], SECTION_NAMES.map(name => item(`${name}: `, "section")));
        if (res || !manual) return res;
    }
    if ((m = /\((S\d+(?:,\s*S\d+)*)\)\s+([a-z]*)$/.exec(line)) && wordy(m[2])) {
        return result(caret, m[2], speechItems(ctx(), m[1].includes(",")));
    }
    if ((m = /\b(camera|shot)\s+([a-z-]*)$/i.exec(line)) && wordy(m[2])) {
        const items = m[1].toLowerCase() === "camera"
            ? [...CAMERA_MOVES, ["cuts to", "cut"]].map(([phrase, label]) => item(`${phrase} `, label))
            : CUT_VERBS.map(([phrase, label]) => item(`${phrase} `, label));
        return result(caret, m[2], items);
    }
    if ((m = new RegExp(`\\b(?:${MOVE_PATTERN})(?: with (?:small|large) amplitude)?\\s+([a-z]*)$`, "i").exec(line)) && wordy(m[1])) {
        const modifiers = m[0].includes("amplitude") ? CAMERA_MODIFIERS.filter(([phrase]) => !phrase.includes("amplitude")) : CAMERA_MODIFIERS;
        return result(caret, m[1], modifiers.map(([phrase, label]) => item(`${phrase} `, label)));
    }
    if (manual) {
        const word = /[A-Za-z'-]*$/.exec(line)[0];
        return result(caret, word, phraseItems());
    }
    return null;
}

/** Attaches the suggestion list to `input`; returns { refresh, close, dispose }. */
export function createAutocomplete({ input, container, enabled, onFallbackEdit }) {
    const list = document.createElement("ul");
    list.className = "h3-completions";
    list.id = `h3-completions-${Math.random().toString(36).slice(2)}`;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "H3 syntax suggestions");
    list.hidden = true;
    const measure = document.createElement("div");
    measure.className = "h3-text h3-measure";
    measure.setAttribute("aria-hidden", "true");
    container.append(measure, list);
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "false");

    let state = null;
    let manual = false;
    let accepting = false;

    function close() {
        state = null;
        manual = false;
        list.hidden = true;
        list.replaceChildren();
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
    }
    function highlight(index) {
        if (!state) return;
        state.active = (index + state.items.length) % state.items.length;
        for (const [i, li] of [...list.children].entries()) li.setAttribute("aria-selected", String(i === state.active));
        const active = list.children[state.active];
        input.setAttribute("aria-activedescendant", active.id);
        active.scrollIntoView?.({ block: "nearest" });
    }
    function position() {
        measure.style.width = `${input.clientWidth}px`;
        measure.innerHTML = escapeHTML(input.value.slice(0, state.start)) + '<span class="h3-caret">​</span>';
        const marker = measure.lastElementChild;
        const lineHeight = marker.offsetHeight || 22;
        const top = marker.offsetTop - input.scrollTop;
        const left = marker.offsetLeft - input.scrollLeft;
        const room = container.clientHeight;
        const height = list.offsetHeight;
        const below = top + lineHeight + 2;
        list.style.top = `${below + height <= room || top - height - 2 < 0 ? Math.max(0, Math.min(below, room - height)) : top - height - 2}px`;
        list.style.left = `${Math.max(0, Math.min(left, container.clientWidth - list.offsetWidth - 4))}px`;
    }
    function render() {
        list.replaceChildren(...state.items.map((entry, i) => {
            const li = document.createElement("li");
            li.id = `${list.id}-${i}`;
            li.setAttribute("role", "option");
            const label = document.createElement("span");
            label.className = "h3-completion-label";
            label.textContent = entry.label;
            li.append(label);
            if (entry.detail) {
                const detail = document.createElement("span");
                detail.className = "h3-completion-detail";
                detail.textContent = entry.detail;
                li.append(detail);
            }
            li.addEventListener("mousedown", event => event.preventDefault());
            li.addEventListener("mousemove", () => { if (state?.active !== i) highlight(i); });
            li.addEventListener("click", () => accept(i));
            return li;
        }));
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        highlight(0);
        position();
    }
    function refresh({ open = false, force = false } = {}) {
        if (force) manual = true;
        if (!open && !state) return;
        if (!force && !manual && !enabled()) return close();
        if (input.selectionStart !== input.selectionEnd) return close();
        const next = completionsAt(input.value, input.selectionStart, { manual });
        if (!next) return close();
        state = { ...next, active: 0 };
        render();
    }
    function accept(index = state?.active ?? 0) {
        if (!state) return;
        const entry = state.items[index];
        const { start, end } = state;
        close();
        input.focus({ preventScroll: true });
        input.setSelectionRange(start, end);
        accepting = true;
        // insertText keeps the browser's undo history; setRangeText is a fallback.
        const inserted = document.execCommand?.("insertText", false, entry.text);
        accepting = false;
        if (!inserted) {
            input.setRangeText(entry.text, start, end, "end");
            onFallbackEdit?.();
        }
        const [a, b] = entry.select ?? [entry.caret ?? entry.text.length, entry.caret ?? entry.text.length];
        input.setSelectionRange(start + a, start + b);
    }

    const onKeyDown = event => {
        if (event.isComposing) return;
        if (event.ctrlKey && (event.code === "Space" || event.key === " ")) {
            event.preventDefault();
            refresh({ open: true, force: true });
            return;
        }
        if (!state) return;
        const keys = { ArrowDown: () => highlight(state.active + 1), ArrowUp: () => highlight(state.active - 1),
            PageDown: () => highlight(Math.min(state.items.length - 1, state.active + 8)), PageUp: () => highlight(Math.max(0, state.active - 8)),
            Enter: () => accept(), Tab: () => accept(), Escape: close };
        if (!keys[event.key] || event.altKey || event.ctrlKey || event.metaKey || (event.shiftKey && event.key !== "Tab")) return;
        event.preventDefault();
        keys[event.key]();
    };
    const onInput = event => {
        if (accepting || event.isComposing) return;
        if (event.inputType === "insertText" && event.data) refresh({ open: true });
        else if (event.inputType === "deleteContentBackward" && state) refresh();
        else close();
    };
    const onCaretMove = event => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) refresh();
    };
    const onScroll = () => { if (state) position(); };
    input.addEventListener("keydown", onKeyDown);
    input.addEventListener("input", onInput);
    input.addEventListener("keyup", onCaretMove);
    input.addEventListener("scroll", onScroll);
    input.addEventListener("blur", close);
    input.addEventListener("mousedown", close);
    return {
        refresh, close,
        get open() { return !!state; },
        dispose() {
            close();
            input.removeEventListener("keydown", onKeyDown);
            input.removeEventListener("input", onInput);
            input.removeEventListener("keyup", onCaretMove);
            input.removeEventListener("scroll", onScroll);
            input.removeEventListener("blur", close);
            input.removeEventListener("mousedown", close);
            list.remove();
            measure.remove();
        },
    };
}
