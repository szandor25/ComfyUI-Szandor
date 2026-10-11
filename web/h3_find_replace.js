import { escapeHTML } from "./h3_prompt_syntax.js";

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Literal (not regex) matches of query in text as {start, end}, case-insensitive unless asked. */
export function findMatches(text, query, caseSensitive = false) {
    if (!query) return [];
    const pattern = new RegExp(escapeRegExp(query), caseSensitive ? "gu" : "giu");
    return [...text.matchAll(pattern)].map(m => ({ start: m.index, end: m.index + m[0].length }));
}

export function replaceMatches(text, matches, replacement) {
    let result = "";
    let offset = 0;
    for (const { start, end } of matches) {
        result += text.slice(offset, start) + replacement;
        offset = end;
    }
    return result + text.slice(offset);
}

/** Background layer: the same text as the textarea, transparent, with matches marked. */
export function highlightMatches(text, matches, current = -1) {
    let html = "";
    let offset = 0;
    matches.forEach(({ start, end }, index) => {
        html += escapeHTML(text.slice(offset, start));
        html += `<mark class="h3-match${index === current ? " h3-match-current" : ""}">${escapeHTML(text.slice(start, end))}</mark>`;
        offset = end;
    });
    return html + escapeHTML(text.slice(offset)) + "\n";
}

function button(className, text, title) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    el.textContent = text;
    el.title = title;
    return el;
}

function field(className, placeholder) {
    const el = document.createElement("input");
    el.type = "text";
    el.className = className;
    el.placeholder = placeholder;
    el.setAttribute("aria-label", placeholder);
    el.spellcheck = false;
    el.autocomplete = "off";
    return el;
}

/**
 * One-row find and replace bar for the prompt textarea. Matches are painted
 * in `layer`, which sits under the syntax mirror; edits go through
 * insertText so Ctrl+Z undoes them. `onChange` re-renders the editor.
 */
export function createFindReplace({ input, onChange, onFallbackEdit }) {
    const toggle = button("h3-button h3-find-toggle", "🔍", "Find and replace (Ctrl+F)");
    toggle.setAttribute("aria-label", "Find and replace");
    toggle.setAttribute("aria-expanded", "false");

    const bar = document.createElement("div");
    bar.className = "h3-findbar";
    bar.setAttribute("role", "search");
    bar.hidden = true;
    const query = field("h3-find-input", "Find");
    const replacement = field("h3-find-input", "Replace with");
    const matchCase = button("h3-button h3-find-small", "Aa", "Match case");
    matchCase.setAttribute("aria-pressed", "false");
    const count = document.createElement("span");
    count.className = "h3-find-count";
    count.setAttribute("aria-live", "polite");
    const previous = button("h3-button h3-find-small", "↑", "Previous match (Shift+Enter)");
    const next = button("h3-button h3-find-small", "↓", "Next match (Enter)");
    const replaceOne = button("h3-button h3-find-small", "Replace", "Replace the current match (Enter in the replace field)");
    const replaceAll = button("h3-button h3-find-small", "All", "Replace all matches. Ctrl+Z undoes.");
    const close = button("h3-button h3-find-small", "✕", "Close (Esc)");
    bar.append(query, replacement, matchCase, count, previous, next, replaceOne, replaceAll, close);

    const layer = document.createElement("pre");
    layer.className = "h3-text h3-matches";
    layer.setAttribute("aria-hidden", "true");

    let matches = [];
    let current = -1;
    // Where the current match starts; kept across edits so the position survives re-matching.
    let anchor = 0;
    let notice = "";

    const caseSensitive = () => matchCase.getAttribute("aria-pressed") === "true";
    const isOpen = () => !bar.hidden;

    function update() {
        matches = isOpen() ? findMatches(input.value, query.value, caseSensitive()) : [];
        // The first match at or after the anchor, wrapping to the top.
        current = matches.length ? Math.max(0, matches.findIndex(m => m.start >= anchor)) : -1;
        layer.innerHTML = matches.length ? highlightMatches(input.value, matches, current) : "";
        count.textContent = notice || (!isOpen() || !query.value ? "" : matches.length ? `${current + 1}/${matches.length}` : "0/0");
        count.classList.toggle("h3-find-none", Boolean(query.value) && !matches.length && !notice);
        for (const el of [previous, next, replaceOne, replaceAll]) el.disabled = !matches.length;
    }

    function reveal() {
        const mark = layer.querySelector(".h3-match-current");
        if (!mark) return;
        const top = mark.offsetTop;
        if (top < input.scrollTop || top + mark.offsetHeight > input.scrollTop + input.clientHeight) {
            input.scrollTop = Math.max(0, top - input.clientHeight / 3);
        }
        const { start, end } = matches[current];
        // Leaves the match selected for when the bar is closed.
        input.setSelectionRange(start, end);
        onChange();
    }

    function go(step) {
        if (!matches.length) return;
        notice = "";
        current = (current + step + matches.length) % matches.length;
        anchor = matches[current].start;
        update();
        reveal();
    }

    // Replaces [start, end) through the native textarea so the change joins its undo history.
    function edit(start, end, text) {
        const scroll = input.scrollTop;
        input.focus({ preventScroll: true });
        input.setSelectionRange(start, end);
        const done = text
            ? document.execCommand?.("insertText", false, text)
            : document.execCommand?.("delete");
        if (!done) {
            input.setRangeText(text, start, end, "end");
            onFallbackEdit();
        }
        input.scrollTop = scroll;
    }

    function replaceCurrent() {
        const match = matches[current];
        if (!match) return;
        notice = "";
        edit(match.start, match.end, replacement.value);
        anchor = match.start + replacement.value.length;
        replacement.focus({ preventScroll: true });
        update();
        if (matches.length) reveal(); else onChange();
    }

    function replaceEverything() {
        if (!matches.length) return;
        const total = matches.length;
        edit(0, input.value.length, replaceMatches(input.value, matches, replacement.value));
        anchor = 0;
        notice = `${total} replaced`;
        replacement.focus({ preventScroll: true });
        update();
        onChange();
    }

    function open() {
        const selected = input.value.slice(input.selectionStart, input.selectionEnd);
        if (selected && !selected.includes("\n")) query.value = selected;
        anchor = input.selectionStart;
        notice = "";
        bar.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        query.focus({ preventScroll: true });
        query.select();
        update();
        if (matches.length) reveal(); else onChange();
    }

    function hide() {
        bar.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        notice = "";
        update();
        input.focus({ preventScroll: true });
        onChange();
    }

    for (const el of [toggle, matchCase, previous, next, replaceOne, replaceAll, close]) {
        // Keep the textarea selection and the field focus while clicking.
        el.addEventListener("mousedown", event => event.preventDefault());
    }
    toggle.addEventListener("click", () => (isOpen() ? hide() : open()));
    close.addEventListener("click", hide);
    previous.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));
    replaceOne.addEventListener("click", replaceCurrent);
    replaceAll.addEventListener("click", replaceEverything);
    matchCase.addEventListener("click", () => {
        matchCase.setAttribute("aria-pressed", String(!caseSensitive()));
        notice = "";
        update();
        if (matches.length) reveal(); else onChange();
    });
    query.addEventListener("input", () => {
        notice = "";
        update();
        if (matches.length) reveal(); else onChange();
    });
    query.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); go(event.shiftKey ? -1 : 1); }
        else if (event.key === "Escape") { event.preventDefault(); hide(); }
    });
    replacement.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); replaceCurrent(); }
        else if (event.key === "Escape") { event.preventDefault(); hide(); }
    });
    input.addEventListener("keydown", event => {
        const key = event.key.toLowerCase();
        if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === "f" || key === "h")) {
            event.preventDefault();
            open();
        }
    });
    // Clicking in the prompt moves the anchor to the caret, so Enter continues from there.
    input.addEventListener("click", () => { anchor = input.selectionStart; });
    // Fires synchronously inside edit(), before replaceEverything sets its notice.
    input.addEventListener("input", () => { notice = ""; });

    return {
        toggle, bar, layer, update,
        // Re-match after the prompt changed; keeps a "N replaced" notice until the next action.
        refresh: () => { if (isOpen()) update(); },
    };
}
