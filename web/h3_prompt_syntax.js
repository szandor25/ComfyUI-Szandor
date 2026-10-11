// Syntax from MiniMax-AI/MiniMax-H3, skills/h3-prompt-writing/references/
// base-en.txt and ref-en.txt (consulted 2026-09-09). This is a writing aid,
// not a model validator: arbitrary prose and experimental tags remain intact.
const SECTIONS = "integrated_multimodal_description|overall_soundscape|non_diegetic_music|subject_definitions|summary|retention_analysis|detailed_description";
const RELATIONS = "fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference";

export function analyzePrompt(text) {
    const pattern = new RegExp(`^[ \\t]*(?:${SECTIONS}):|\\b(?:${RELATIONS})\\b(?=[ \\t]*-)|<[^<>\\n]*>|\\[[^\\]\\n]*\\]|\\(S\\d+(?:,\\s*S\\d+)*\\)|(?<=\\[Shot \\d+\\][ \\t]+)At \\d+:\\d\\d(?:\\.\\d+)?`, "gm");
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
                if (stack.length) issue(token, "<d> inside another dialogue — close the previous one with </d> first.");
                stack.push(token);
                if (!/^\s*\[[\p{L}][^\]\n]*\]/u.test(text.slice(token.end))) {
                    issue(token, "Add a language after <d>, e.g. [English] or [Polish].");
                }
            } else if (value === "</d>") {
                token.kind = "dialogue";
                const opening = stack.pop();
                if (!opening) issue(token, "This </d> has no opening <d>.");
                else { opening.pair = token.start; token.pair = opening.start; }
            } else if (/^<(?:Subject|Picture|Video|Audio) [1-9]\d*>$/.test(value)) {
                token.kind = "reference";
            } else if (/^<(?:scenetrans|cutoff)>$/.test(value)) {
                token.kind = "boundary";
            } else if (/^<\\\/d>$/.test(value)) {
                issue(token, "Close dialogue with </d>, without a backslash.");
            }
        } else if (value.startsWith("[")) {
            token.kind = /^\[Shot \d+(?:, [^\]]+)?\]$/.test(value) ? "shot" : "bracket";
        } else if (value.startsWith("(")) token.kind = "speaker";
        else if (value.startsWith("At ")) token.kind = "time";
        else if (!value.endsWith(":")) token.kind = "relation";
        tokens.push(token);
    }
    for (const token of stack) issue(token, "Unclosed <d> dialogue — add </d>.");
    return { tokens, issues };
}

export function escapeHTML(text) {
    return text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

// Spoken words between a matched <d> and </d> get their own color; the spans
// only change color, so the editor mirror keeps the textarea geometry.
export function highlightPrompt(text, analysis, caret = -1) {
    const active = analysis.tokens.find(t => t.pair !== undefined && caret >= t.start && caret <= t.end);
    let offset = 0;
    let html = "";
    let closing = -1;
    const plain = segment => segment && (closing >= 0 ? `<span class="h3-spoken">${escapeHTML(segment)}</span>` : escapeHTML(segment));
    for (const token of analysis.tokens) {
        html += plain(text.slice(offset, token.start));
        if (token.start === closing) closing = -1;
        const paired = active && (token === active || token.start === active.pair);
        html += `<span class="h3-${token.kind}${token.error ? " h3-error" : ""}${paired ? " h3-paired" : ""}">${escapeHTML(text.slice(token.start, token.end))}</span>`;
        if (token.kind === "dialogue" && token.pair > token.start) closing = token.pair;
        offset = token.end;
    }
    // A trailing newline needs a glyph in the mirror to match textarea layout.
    return html + plain(text.slice(offset)) + "\n";
}

/**
 * Display-only layout for read-only previews: each section header and each
 * [Shot N] starts its own line. Nothing else in the text changes.
 */
export function formatPromptForDisplay(text) {
    return text
        .replace(new RegExp(`^([ \\t]*(?:${SECTIONS}):)[ \\t]+(?=\\S)`, "gm"), "$1\n")
        // Only after a sentence end, so "(from [Shot 1])" or "[Shot 1], [Shot 3]" stay inline.
        .replace(/([.!?…"'”>])[ \t]+(?=\[Shot \d+\])/g, "$1\n");
}

// Vocabulary shared by the insertion menu and autocomplete.
export const SECTION_NAMES = SECTIONS.split("|");
export const VISUAL_RELATIONS = ["fully_preserved", "partially_preserved", "attribute_transfer", "weak_reference"];
export const AUDIO_RELATIONS = ["fully_copy", "partially_copy", "reference", "weak_reference"];
export const TASK_TYPES = ["keyframe completion", "reference generation", "video editing", "video continuation", "audio reuse", "audio reference"];
export const LANGUAGES = ["Polish", "English", "Chinese", "Japanese", "Korean", "Spanish", "French", "German", "Italian", "Portuguese", "Russian", "Ukrainian"];
// [English verb phrase written after "The camera ", label].
export const CAMERA_MOVES = [
    ["pushes in", "Push In — camera moves forward"],
    ["pulls out", "Pull Out — camera moves back"],
    ["zooms in", "Zoom In — focal length in"],
    ["zooms out", "Zoom Out — focal length out"],
    ["pans left", "Pan Left — pivots left"],
    ["pans right", "Pan Right — pivots right"],
    ["trucks left", "Truck Left — slides left"],
    ["trucks right", "Truck Right — slides right"],
    ["tilts up", "Tilt Up — pivots up"],
    ["tilts down", "Tilt Down — pivots down"],
    ["pedestals up", "Pedestal Up — whole camera rises"],
    ["pedestals down", "Pedestal Down — whole camera lowers"],
    ["arcs around", "Arc Shot — circles the subject"],
    ["tracks", "Tracking Shot — follows the subject"],
    ["holds a static shot", "Static Shot — camera still"],
    ["shakes slightly", "Shake Slightly"],
    ["shakes strongly", "Shake Strongly"],
    ["rolls clockwise", "Roll Clockwise"],
    ["rolls counterclockwise", "Roll Counterclockwise"],
];
export const CAMERA_MODIFIERS = [
    ["with small amplitude", "small amplitude"],
    ["with large amplitude", "large amplitude"],
    ["at slow speed", "slow"],
    ["at fast speed", "fast"],
];
export const CUT_VERBS = [
    ["cuts to", "ordinary cut"],
    ["transitions to", "transition"],
    ["changes to", "shot change"],
    ["switches to", "switch"],
    ["cross-dissolves to", "cross-dissolve — only on request"],
    ["fades to", "fade — only on request"],
    ["wipes to", "wipe — only on request"],
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
    ["Dialogue and voice", [
        ["dialogue", "Dialogue <d>…</d>", "<d>[Polish] ", "</d>"],
        ["speaker", "Speaker (S1)", "(S1)", ""],
        ["says", "Line: (S1) says: <d>…</d>", "(S1) says: <d>[Polish] ", "</d>"],
        ["group", "Joint line (S1,S2)", "(S1,S2) shout together, <d>[Polish] ", "</d>"],
        ["voiceover", "Voiceover / off-screen voice (lips closed)", "(S1) says in an off-screen voiceover: <d>[Polish] ", "</d>" + LIPS_CLOSED],
        ["transition", "Line across a cut <scenetrans>", "<scenetrans>", ""],
        ["continuity", "Continuity phrase for a line across a cut", "the line continues seamlessly across the cut", ""],
        ["cutoff", "Speech cut off by the video end <cutoff>", "<cutoff>", ""],
        ["unclear", "Unintelligible span [unclear]", "[unclear]", ""],
        ["language", "Language tag [English]", "[English] ", ""],
    ]],
    ["Shots and cuts", [
        ["shot", "First shot [Shot 1]", "[Shot 1] ", ""],
        ["style", "Style and framing at the start of [Shot 1]", "Live-action, cinematic, a medium-wide shot frames ", ""],
        ["ref-style", "Style before [Shot 1] (reference mode)", "The target video is in a cinematic style with soft lighting.\n", ""],
        ["cut", "Next shot — the camera cuts to", "[Shot 2] At 00:03.000, the camera cuts to ", ""],
        ["cut-shot", "Next shot — the shot transitions to", "[Shot 2] At 00:03.000, the shot transitions to ", ""],
        ["dissolve", "Cross-dissolve (only on request)", "[Shot 2] At 00:03.000, the shot cross-dissolves to ", ""],
        ["fade", "Fade (only on request)", "[Shot 2] At 00:03.000, the shot fades to ", ""],
        ["wipe", "Wipe (only on request)", "[Shot 2] At 00:03.000, the shot wipes to ", ""],
        ["on-screen", "On-screen text \"…\"", "a sign reading \"", "\""],
    ]],
    ["Camera motion", [
        ...CAMERA_MOVES.map(([phrase, label]) => [`camera-${slug(phrase)}`, label, `The camera ${phrase} `, ""]),
        ...CAMERA_MODIFIERS.map(([phrase, label]) => [`mod-${slug(phrase)}`, `+ ${phrase} (${label})`, `${phrase} `, ""]),
    ]],
    ["References", [
        ["subject", "Character / object <Subject 1>", "<Subject 1>", ""],
        ["picture", "Picture <Picture 1>", "<Picture 1>", ""],
        ["video", "Video <Video 1>", "<Video 1>", ""],
        ["audio", "Audio <Audio 1>", "<Audio 1>", ""],
        ["subject-def", "Definition: <Subject 1> is the … in <Picture 1>", "<Subject 1> is the ", " in <Picture 1>."],
        ["picture-first", "Shot begins from a picture", "the shot begins from <Picture 1>", ""],
        ["picture-key", "Shot keyframe", "the shot's keyframe corresponds to <Picture 1>", ""],
        ["picture-last", "Shot ends on a picture", "the shot ends on <Picture 1>", ""],
        ["edit-opening", "Editing summary: edited version of <Video 1>", "The target video is an edited version of <Video 1>. ", ""],
        ["audio-voice", "Audio as a speaker's voice timbre", "<Audio 1> is the voice-timbre reference for <Subject 1> (S1).", ""],
    ]],
    ["Task type (summary)", TASK_TYPES.map(type => [`task-${slug(type)}`, `[${type}]`, `[${type}] `, ""])],
    ["Relations (retention_analysis)", [
        ["retain-subject", "Entry: <Subject 1> (appears in [Shot 1]): …", "<Subject 1> (appears in [Shot 1]): fully_preserved - ", ""],
        ["retain-picture", "Entry: <Picture 1> ([Shot 1] first frame): …", "<Picture 1> ([Shot 1] first frame): fully_preserved - ", ""],
        ["retain-audio", "Entry: <Audio 1>: reference - …", "<Audio 1>: reference - ", ""],
        ...VISUAL_RELATIONS.map(rel => [`rel-${rel}`, `${rel} (visual)`, `${rel} - `, ""]),
        ...AUDIO_RELATIONS.filter(rel => !VISUAL_RELATIONS.includes(rel)).map(rel => [`rel-${rel}`, `${rel} (audio)`, `${rel} - `, ""]),
    ]],
    ["Sections", SECTION_NAMES.map(name => [`section-${name}`, `${name}:`, `${name}: `, ""])],
    ["Keyframe instruction (first line)", [
        ["i2va-line", "I2VA — first frame", I2VA_LINE + "\n\n", ""],
        ["fl2va-line", "FL2VA — first and last frame", FL2VA_LINE + "\n\n", ""],
        ["l2va-line", "L2VA — last frame", L2VA_LINE + "\n\n", ""],
    ]],
    ["Prompt templates", [
        ["base", "T2VA template", ...BASE_BODY],
        ["i2va", "I2VA template (first frame)", `${I2VA_LINE}\n\n${BASE_BODY[0]}`, BASE_BODY[1]],
        ["fl2va", "FL2VA template (first and last frame)", `${FL2VA_LINE}\n\n${BASE_BODY[0]}`, BASE_BODY[1]],
        ["l2va", "L2VA template (last frame)", `${L2VA_LINE}\n\n${BASE_BODY[0]}`, BASE_BODY[1]],
        ["reference", "Ref2VA template", "subject_definitions: \n\nsummary: [reference generation] \n\nretention_analysis: \n\ndetailed_description: ", "\n[Shot 1] \n\noverall_soundscape: \n\nnon_diegetic_music: N/A"],
    ]],
];

export const SNIPPETS = SNIPPET_GROUPS.flatMap(([, items]) => items);

// Short Polish descriptions shown in parentheses in the Insert list, by snippet id.
export const SNIPPET_HINTS_PL = {
    "dialogue": "kwestia mówiona; zaznaczony tekst trafia do środka",
    "speaker": "oznaczenie mówiącej postaci",
    "says": "postać S1 wypowiada kwestię",
    "group": "dwie postacie mówią razem",
    "voiceover": "głos zza kadru, usta zamknięte",
    "transition": "kwestia ciągnie się przez cięcie",
    "continuity": "opis ciągłości kwestii po cięciu",
    "cutoff": "wypowiedź urwana końcem filmu",
    "unclear": "fragment niezrozumiały",
    "language": "język wypowiedzi",
    "shot": "początek pierwszego ujęcia",
    "style": "styl i kadr na początku ujęcia",
    "ref-style": "styl całego filmu w trybie referencji",
    "cut": "nowe ujęcie po zwykłym cięciu",
    "cut-shot": "nowe ujęcie z przejściem",
    "dissolve": "przenikanie — tylko na wyraźne życzenie",
    "fade": "ściemnienie — tylko na wyraźne życzenie",
    "wipe": "przejście kurtynowe — tylko na wyraźne życzenie",
    "on-screen": "napis widoczny w kadrze",
    "camera-pushes-in": "najazd — kamera jedzie do przodu",
    "camera-pulls-out": "odjazd — kamera cofa się",
    "camera-zooms-in": "przybliżenie obiektywem",
    "camera-zooms-out": "oddalenie obiektywem",
    "camera-pans-left": "panorama w lewo, obrót w miejscu",
    "camera-pans-right": "panorama w prawo, obrót w miejscu",
    "camera-trucks-left": "jazda boczna w lewo",
    "camera-trucks-right": "jazda boczna w prawo",
    "camera-tilts-up": "odchylenie kamery w górę",
    "camera-tilts-down": "pochylenie kamery w dół",
    "camera-pedestals-up": "cała kamera unosi się pionowo",
    "camera-pedestals-down": "cała kamera opuszcza się pionowo",
    "camera-arcs-around": "kamera krąży wokół obiektu",
    "camera-tracks": "kamera podąża za obiektem",
    "camera-holds-a-static-shot": "kamera nieruchoma",
    "camera-shakes-slightly": "lekkie drgania kamery",
    "camera-shakes-strongly": "silne drgania kamery",
    "camera-rolls-clockwise": "obrót wokół osi zgodnie z zegarem",
    "camera-rolls-counterclockwise": "obrót wokół osi przeciwnie do zegara",
    "mod-with-small-amplitude": "dopisek: mały zakres ruchu",
    "mod-with-large-amplitude": "dopisek: duży zakres ruchu",
    "mod-at-slow-speed": "dopisek: powoli",
    "mod-at-fast-speed": "dopisek: szybko",
    "subject": "postać lub obiekt z referencji",
    "picture": "obraz referencyjny",
    "video": "wideo referencyjne",
    "audio": "dźwięk referencyjny",
    "subject-def": "kim jest postać na obrazie",
    "picture-first": "ujęcie zaczyna się od obrazu",
    "picture-key": "obraz jako klatka kluczowa ujęcia",
    "picture-last": "ujęcie kończy się na obrazie",
    "edit-opening": "film to przeróbka wideo referencyjnego",
    "audio-voice": "nagranie jako barwa głosu postaci",
    "task-keyframe-completion": "uzupełnienie klatek kluczowych",
    "task-reference-generation": "generowanie z referencji",
    "task-video-editing": "edycja wideo",
    "task-video-continuation": "kontynuacja wideo",
    "task-audio-reuse": "użycie dźwięku bez zmian",
    "task-audio-reference": "dźwięk jako wzorzec",
    "retain-subject": "wpis: jak zachować postać",
    "retain-picture": "wpis: obraz jako pierwsza klatka",
    "retain-audio": "wpis: jak użyć dźwięku",
    "rel-fully_preserved": "zachować w pełni",
    "rel-partially_preserved": "zachować częściowo",
    "rel-attribute_transfer": "przenieść wybrane cechy",
    "rel-weak_reference": "luźna inspiracja",
    "rel-fully_copy": "skopiować dźwięk w całości",
    "rel-partially_copy": "skopiować część dźwięku",
    "rel-reference": "dźwięk jako wzorzec stylu",
    "section-integrated_multimodal_description": "główny opis ujęć, obrazu i dźwięku",
    "section-overall_soundscape": "ogólne tło dźwiękowe",
    "section-non_diegetic_music": "muzyka spoza sceny",
    "section-subject_definitions": "definicje postaci i obiektów",
    "section-summary": "typ zadania i krótkie streszczenie",
    "section-retention_analysis": "co zachować z referencji",
    "section-detailed_description": "szczegółowy opis ujęć",
    "i2va-line": "obraz jako pierwsza klatka",
    "fl2va-line": "obrazy jako pierwsza i ostatnia klatka",
    "l2va-line": "obraz jako ostatnia klatka",
    "base": "tekst → wideo z dźwiękiem",
    "i2va": "obraz startowy → wideo",
    "fl2va": "pierwsza i ostatnia klatka → wideo",
    "l2va": "ostatnia klatka → wideo",
    "reference": "wideo z referencji: postacie, obrazy, dźwięk",
};
