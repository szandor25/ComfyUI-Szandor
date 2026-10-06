import assert from "node:assert/strict";
import { test } from "node:test";
import { completionsAt } from "../web/h3_autocomplete.js";
import { analyzePrompt, SNIPPETS } from "../web/h3_prompt_syntax.js";

const at = (text, options) => completionsAt(text, text.length, options);
const texts = result => result?.items.map(i => i.text) ?? [];
const apply = (text, entry) => {
    const result = at(text);
    return text.slice(0, result.start) + entry.text;
};

test("angle brackets suggest dialogue, references with existing and next numbers, and boundaries", () => {
    const all = texts(at("A woman <"));
    for (const expected of ["<d>[Polish] </d>", "<Subject 1>", "<Picture 1>", "<Video 1>", "<Audio 1>", "<scenetrans>", "<cutoff>"]) {
        assert.ok(all.includes(expected), expected);
    }
    const subjects = texts(at("<Subject 1> and <Subject 2> meet <Sub"));
    assert.deepEqual(subjects.slice(0, 3), ["<Subject 1>", "<Subject 2>", "<Subject 3>"]);
    assert.equal(texts(at("(S1) says: <d>[English] Hi <"))[0], "</d>");
    // The most recent dialogue language becomes the default.
    assert.equal(texts(at("<d>[English] Hi</d> then <d"))[0], "<d>[English] </d>");
    const dialogue = at("<d").items[0];
    assert.equal(dialogue.text.slice(0, dialogue.caret), "<d>[Polish] ");
    assert.equal(at("2 < 3"), null);
    assert.equal(at("<Subject 1>"), null);
});

test("square brackets suggest the next shot with an editable cut time, languages and task types", () => {
    assert.equal(texts(at("integrated_multimodal_description: ["))[0], "[Shot 1] ");
    const next = at("[Shot 1] Rain.\n[Shot 2] At 00:04.500, the shot cuts to a door. [").items[0];
    assert.equal(next.text, "[Shot 3] At 00:07.500, the camera cuts to ");
    assert.equal(next.text.slice(...next.select), "00:07.500");
    assert.equal(texts(at("(S1) says: <d>["))[0], "[Polish] ");
    assert.ok(texts(at("(S1) says: <d>[Eng")).includes("[English] "));
    assert.equal(texts(at("summary: ["))[0], "[keyframe completion] ");
    assert.deepEqual(texts(at("summary: [video editing + audio re")), ["audio reuse", "audio reference"]);
    assert.ok(!texts(at("summary: [video editing + ")).includes("video editing"));
    assert.ok(texts(at("x [un")).includes("[unclear]"));
});

test("speakers, speech verbs and voiceover", () => {
    assert.deepEqual(texts(at("A man (")), ["(S1)"]);
    assert.deepEqual(texts(at("(S1) hi (S2) hey (")), ["(S1)", "(S2)", "(S3)", "(S1,S2)"]);
    assert.equal(at("Lunch (from"), null);
    const speech = texts(at("The woman (S1) s"));
    assert.equal(speech[0], "says: <d>[Polish] </d>");
    assert.ok(speech.some(t => t.startsWith("says in an off-screen voiceover: <d>") && t.endsWith("lips remain completely closed.")));
    assert.ok(texts(at("The kids (S1,S2) sh"))[0].startsWith("shout together, <d>"));
    assert.equal(at("The woman (S1) "), null, "no popup for an empty word unless requested");
    assert.ok(at("The woman (S1) ", { manual: true }).items.length > 3);
});

test("sections at line start, relation markers in retention_analysis", () => {
    assert.deepEqual(texts(at("Intro\nsu")), ["subject_definitions: ", "summary: "]);
    assert.deepEqual(texts(at("Intro\nsum")), ["summary: "]);
    assert.ok(texts(at("ov")).includes("overall_soundscape: "));
    assert.ok(texts(at("music")).includes("non_diegetic_music: "));
    assert.equal(at("The su"), null);
    assert.deepEqual(texts(at("<Subject 1> (appears in [Shot 1]): ")), ["fully_preserved - ", "partially_preserved - ", "attribute_transfer - ", "weak_reference - "]);
    assert.deepEqual(texts(at("<Audio 1>: fully")), ["fully_copy - "]);
    const appears = at("<Subject 2> (").items[0];
    assert.equal(appears.text, "(appears in [Shot 1]): ");
    assert.equal(appears.text.slice(...appears.select), "[Shot 1]");
    assert.ok(texts(at("<Picture 1> (")).includes("([Shot 1] first frame): "));
});

test("camera motion, modifiers and cuts follow the official vocabulary", () => {
    assert.deepEqual(texts(at("The camera pu")), ["pushes in ", "pulls out "]);
    assert.ok(texts(at("The camera pans right w")).includes("with large amplitude "));
    assert.deepEqual(texts(at("The camera pushes in with small amplitude a")), ["at slow speed ", "at fast speed "]);
    assert.ok(texts(at("At 00:03.000, the shot c")).includes("cuts to "));
    assert.ok(texts(at("the shot cr")).includes("cross-dissolves to "));
    assert.equal(at("the shot a"), null, "word-start matching avoids noisy substring hits");
    assert.ok(texts(at("Then it c", { manual: true })).includes("continues seamlessly across the cut"));
    assert.equal(at("Then it c"), null);
});

test("accepted dialogue and snippets keep the analyzer free of issues", () => {
    const text = apply("The woman (S1) s", at("The woman (S1) s").items[0]);
    assert.deepEqual(analyzePrompt(text).issues, []);
    for (const [id, , prefix, suffix] of SNIPPETS) {
        assert.deepEqual(analyzePrompt(prefix + "x" + suffix).issues, [], id);
    }
    assert.equal(new Set(SNIPPETS.map(s => s[0])).size, SNIPPETS.length, "unique snippet ids");
    for (const id of ["i2va", "fl2va", "l2va", "voiceover", "task-video-editing", "rel-fully_copy", "section-summary", "camera-pushes-in"]) {
        assert.ok(SNIPPETS.some(s => s[0] === id), id);
    }
});
