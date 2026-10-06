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

// Vocabulary shared by the insertion menu and autocomplete.
export const SECTION_NAMES = SECTIONS.split("|");
export const VISUAL_RELATIONS = ["fully_preserved", "partially_preserved", "attribute_transfer", "weak_reference"];
export const AUDIO_RELATIONS = ["fully_copy", "partially_copy", "reference", "weak_reference"];
export const TASK_TYPES = ["keyframe completion", "reference generation", "video editing", "video continuation", "audio reuse", "audio reference"];
export const LANGUAGES = ["Polish", "English", "Chinese", "Japanese", "Korean", "Spanish", "French", "German", "Italian", "Portuguese", "Russian", "Ukrainian"];
// [English verb phrase written after "The camera ", Polish label].
export const CAMERA_MOVES = [
    ["pushes in", "Push In — najazd kamery"],
    ["pulls out", "Pull Out — odjazd kamery"],
    ["zooms in", "Zoom In — zbliżenie obiektywem"],
    ["zooms out", "Zoom Out — oddalenie obiektywem"],
    ["pans left", "Pan Left — obrót w lewo"],
    ["pans right", "Pan Right — obrót w prawo"],
    ["trucks left", "Truck Left — przesunięcie w lewo"],
    ["trucks right", "Truck Right — przesunięcie w prawo"],
    ["tilts up", "Tilt Up — odchylenie w górę"],
    ["tilts down", "Tilt Down — pochylenie w dół"],
    ["pedestals up", "Pedestal Up — cała kamera w górę"],
    ["pedestals down", "Pedestal Down — cała kamera w dół"],
    ["arcs around", "Arc Shot — łuk wokół obiektu"],
    ["tracks", "Tracking Shot — podąża za obiektem"],
    ["holds a static shot", "Static Shot — kamera nieruchoma"],
    ["shakes slightly", "Shake Slightly — lekkie drganie"],
    ["shakes strongly", "Shake Strongly — silne drganie"],
    ["rolls clockwise", "Roll Clockwise — obrót zgodnie z zegarem"],
    ["rolls counterclockwise", "Roll Counterclockwise — obrót przeciwnie do zegara"],
];
export const CAMERA_MODIFIERS = [
    ["with small amplitude", "mała amplituda"],
    ["with large amplitude", "duża amplituda"],
    ["at slow speed", "wolno"],
    ["at fast speed", "szybko"],
];
export const CUT_VERBS = [
    ["cuts to", "zwykłe cięcie"],
    ["transitions to", "przejście"],
    ["changes to", "zmiana ujęcia"],
    ["switches to", "przełączenie"],
    ["cross-dissolves to", "przenikanie — tylko na życzenie"],
    ["fades to", "ściemnienie — tylko na życzenie"],
    ["wipes to", "przetarcie — tylko na życzenie"],
];
export const CONTINUITY_PHRASES = ["continues seamlessly across the cut", "continues uninterrupted into the next shot", "carries over from the previous shot", "remains audible across the transition"];
export const STYLES = ["Live-action, cinematic", "2D-animated", "3D CG", "claymation", "watercolor", "vintage film"];
export const LIPS_CLOSED = " while the character's lips remain completely closed.";

const I2VA_LINE = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
const FL2VA_LINE = "How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 5.00-second mark of the target video.";
const L2VA_LINE = "How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 5.00-second mark of the target video.";
const BASE_BODY = ["integrated_multimodal_description: [Shot 1] ", "\n\noverall_soundscape: \n\nnon_diegetic_music: N/A"];
const slug = text => text.replace(/[^a-z0-9]+/gi, "-");

// [id, label, prefix, suffix]; a selection is wrapped between prefix and suffix.
export const SNIPPET_GROUPS = [
    ["Dialog i głos", [
        ["dialogue", "Dialog <d>…</d>", "<d>[Polish] ", "</d>"],
        ["speaker", "Mówca (S1)", "(S1)", ""],
        ["says", "Wypowiedź: (S1) says: <d>…</d>", "(S1) says: <d>[Polish] ", "</d>"],
        ["group", "Wspólna wypowiedź (S1,S2)", "(S1,S2) shout together, <d>[Polish] ", "</d>"],
        ["voiceover", "Lektor / głos zza kadru (usta zamknięte)", "(S1) says in an off-screen voiceover: <d>[Polish] ", "</d>" + LIPS_CLOSED],
        ["transition", "Dialog przez cięcie <scenetrans>", "<scenetrans>", ""],
        ["continuity", "Opis ciągłości dialogu przez cięcie", "the line continues seamlessly across the cut", ""],
        ["cutoff", "Wypowiedź urwana końcem filmu <cutoff>", "<cutoff>", ""],
        ["unclear", "Niezrozumiały fragment [unclear]", "[unclear]", ""],
        ["language", "Znacznik języka [English]", "[English] ", ""],
    ]],
    ["Ujęcia i cięcia", [
        ["shot", "Pierwsze ujęcie [Shot 1]", "[Shot 1] ", ""],
        ["style", "Styl i kadr na początku [Shot 1]", "Live-action, cinematic, a medium-wide shot frames ", ""],
        ["ref-style", "Styl przed [Shot 1] (tryb Ref)", "The target video is in a cinematic style with soft lighting.\n", ""],
        ["cut", "Kolejne ujęcie — the camera cuts to", "[Shot 2] At 00:03.000, the camera cuts to ", ""],
        ["cut-shot", "Kolejne ujęcie — the shot transitions to", "[Shot 2] At 00:03.000, the shot transitions to ", ""],
        ["dissolve", "Przenikanie (tylko na życzenie)", "[Shot 2] At 00:03.000, the shot cross-dissolves to ", ""],
        ["fade", "Ściemnienie (tylko na życzenie)", "[Shot 2] At 00:03.000, the shot fades to ", ""],
        ["wipe", "Przetarcie (tylko na życzenie)", "[Shot 2] At 00:03.000, the shot wipes to ", ""],
        ["on-screen", "Tekst na ekranie \"…\"", "a sign reading \"", "\""],
    ]],
    ["Ruch kamery", [
        ...CAMERA_MOVES.map(([phrase, label]) => [`camera-${slug(phrase)}`, label, `The camera ${phrase} `, ""]),
        ...CAMERA_MODIFIERS.map(([phrase, label]) => [`mod-${slug(phrase)}`, `+ ${phrase} (${label})`, `${phrase} `, ""]),
    ]],
    ["Referencje", [
        ["subject", "Postać / obiekt <Subject 1>", "<Subject 1>", ""],
        ["picture", "Obraz <Picture 1>", "<Picture 1>", ""],
        ["video", "Wideo <Video 1>", "<Video 1>", ""],
        ["audio", "Audio <Audio 1>", "<Audio 1>", ""],
        ["subject-def", "Definicja: <Subject 1> is the … in <Picture 1>", "<Subject 1> is the ", " in <Picture 1>."],
        ["picture-first", "Ujęcie zaczyna się od obrazu", "the shot begins from <Picture 1>", ""],
        ["picture-key", "Klatka kluczowa ujęcia", "the shot's keyframe corresponds to <Picture 1>", ""],
        ["picture-last", "Ujęcie kończy się na obrazie", "the shot ends on <Picture 1>", ""],
        ["edit-opening", "Summary edycji: edited version of <Video 1>", "The target video is an edited version of <Video 1>. ", ""],
        ["audio-voice", "Audio jako barwa głosu mówcy", "<Audio 1> is the voice-timbre reference for <Subject 1> (S1).", ""],
    ]],
    ["Typ zadania (summary)", TASK_TYPES.map(type => [`task-${slug(type)}`, `[${type}]`, `[${type}] `, ""])],
    ["Relacje (retention_analysis)", [
        ["retain-subject", "Wpis: <Subject 1> (appears in [Shot 1]): …", "<Subject 1> (appears in [Shot 1]): fully_preserved - ", ""],
        ["retain-picture", "Wpis: <Picture 1> ([Shot 1] first frame): …", "<Picture 1> ([Shot 1] first frame): fully_preserved - ", ""],
        ["retain-audio", "Wpis: <Audio 1>: reference - …", "<Audio 1>: reference - ", ""],
        ...VISUAL_RELATIONS.map(rel => [`rel-${rel}`, `${rel} (obraz)`, `${rel} - `, ""]),
        ...AUDIO_RELATIONS.filter(rel => !VISUAL_RELATIONS.includes(rel)).map(rel => [`rel-${rel}`, `${rel} (audio)`, `${rel} - `, ""]),
    ]],
    ["Sekcje", SECTION_NAMES.map(name => [`section-${name}`, `${name}:`, `${name}: `, ""])],
    ["Instrukcja klatek (pierwsza linia)", [
        ["i2va-line", "I2VA — pierwsza klatka", I2VA_LINE + "\n\n", ""],
        ["fl2va-line", "FL2VA — pierwsza i ostatnia klatka", FL2VA_LINE + "\n\n", ""],
        ["l2va-line", "L2VA — ostatnia klatka", L2VA_LINE + "\n\n", ""],
    ]],
    ["Szablony promptu", [
        ["base", "Szablon T2VA", ...BASE_BODY],
        ["i2va", "Szablon I2VA (pierwsza klatka)", `${I2VA_LINE}\n\n${BASE_BODY[0]}`, BASE_BODY[1]],
        ["fl2va", "Szablon FL2VA (pierwsza i ostatnia klatka)", `${FL2VA_LINE}\n\n${BASE_BODY[0]}`, BASE_BODY[1]],
        ["l2va", "Szablon L2VA (ostatnia klatka)", `${L2VA_LINE}\n\n${BASE_BODY[0]}`, BASE_BODY[1]],
        ["reference", "Szablon Ref2VA", "subject_definitions: \n\nsummary: [reference generation] \n\nretention_analysis: \n\ndetailed_description: ", "\n[Shot 1] \n\noverall_soundscape: \n\nnon_diegetic_music: N/A"],
    ]],
];

export const SNIPPETS = SNIPPET_GROUPS.flatMap(([, items]) => items);
