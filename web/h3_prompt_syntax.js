// Syntax from MiniMax-AI/MiniMax-H3, skills/h3-prompt-writing/references/
// base-en.txt and ref-en.txt (consulted 2026-09-09). This is a writing aid,
// not a model validator: arbitrary prose and experimental tags remain intact.
const SECTIONS = "integrated_multimodal_description|overall_soundscape|non_diegetic_music|subject_definitions|summary|retention_analysis|detailed_description";
const RELATIONS = "fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference";

export function analyzePrompt(text) {
    const pattern = new RegExp(`^[ \\t]*(?:${SECTIONS}):|\\b(?:${RELATIONS})\\b(?=[ \\t]*-)|<[^<>\\n]*>|\\[[^\\]\\n]*\\]|\\(S\\d+(?:,\\s*S\\d+)*\\)`, "gm");
    const tokens = [];
    const issues = [];
    const stack = [];
    const issue = (token, message) => {
        token.error = true;
        issues.push({ start: token.start, end: token.end, message });
    };
    for (const match of text.matchAll(pattern)) {
        const value = match[0];
        const token = { start: match.index, end: match.index + value.length, kind: "section" };
        if (value.startsWith("<")) {
            token.kind = "tag";
            if (value === "<d>") {
                token.kind = "dialogue";
                if (stack.length) issue(token, "Dialog <d> wewnątrz dialogu — najpierw zamknij poprzedni przez </d>.");
                stack.push(token);
                if (!/^\s*\[[\p{L}][^\]\n]*\]/u.test(text.slice(token.end))) {
                    issue(token, "Po <d> podaj język, np. [Polish] lub [English].");
                }
            } else if (value === "</d>") {
                token.kind = "dialogue";
                const opening = stack.pop();
                if (!opening) issue(token, "Brakuje otwierającego <d> dla tego </d>.");
                else { opening.pair = token.start; token.pair = opening.start; }
            } else if (/^<(?:Subject|Picture|Video|Audio) [1-9]\d*>$/.test(value)) {
                token.kind = "reference";
            } else if (/^<(?:scenetrans|cutoff)>$/.test(value)) {
                token.kind = "boundary";
            } else if (/^<\\\/d>$/.test(value)) {
                issue(token, "Zamknięcie dialogu to </d>, bez ukośnika wstecznego \\\\.");
            }
        } else if (value.startsWith("[")) {
            token.kind = /^\[Shot \d+(?:, [^\]]+)?\]$/.test(value) ? "shot" : "bracket";
        } else if (value.startsWith("(")) token.kind = "speaker";
        else if (!value.endsWith(":")) token.kind = "relation";
        tokens.push(token);
    }
    for (const token of stack) issue(token, "Niedomknięty dialog <d> — dodaj </d>.");
    return { tokens, issues };
}

export function escapeHTML(text) {
    return text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function highlightPrompt(text, analysis, caret = -1) {
    const active = analysis.tokens.find(t => t.pair !== undefined && caret >= t.start && caret <= t.end);
    let offset = 0;
    let html = "";
    for (const token of analysis.tokens) {
        html += escapeHTML(text.slice(offset, token.start));
        const paired = active && (token === active || token.start === active.pair);
        html += `<span class="h3-${token.kind}${token.error ? " h3-error" : ""}${paired ? " h3-paired" : ""}">${escapeHTML(text.slice(token.start, token.end))}</span>`;
        offset = token.end;
    }
    // A trailing newline needs a glyph in the mirror to match textarea layout.
    return html + escapeHTML(text.slice(offset)) + "\n";
}

export const SNIPPETS = [
    ["dialogue", "Dialog <d>…</d>", "<d>[Polish] ", "</d>"],
    ["speaker", "Mówca (S1)", "(S1)", ""],
    ["shot", "Pierwsze ujęcie", "[Shot 1] ", ""],
    ["cut", "Kolejne ujęcie", "[Shot 2] At 00:03.000, the camera cuts to ", ""],
    ["subject", "Postać / obiekt", "<Subject 1>", ""],
    ["picture", "Obraz", "<Picture 1>", ""],
    ["video", "Wideo", "<Video 1>", ""],
    ["audio", "Audio", "<Audio 1>", ""],
    ["transition", "Dialog przez cięcie", "<scenetrans>", ""],
    ["cutoff", "Urwana wypowiedź", "<cutoff>", ""],
    ["base", "Szablon T2VA", "integrated_multimodal_description: [Shot 1] ", "\n\noverall_soundscape: \n\nnon_diegetic_music: N/A"],
    ["reference", "Szablon Ref2VA", "subject_definitions: \n\nsummary: [reference generation] \n\nretention_analysis: \n\ndetailed_description: ", "\n[Shot 1] \n\noverall_soundscape: \n\nnon_diegetic_music: N/A"],
];
