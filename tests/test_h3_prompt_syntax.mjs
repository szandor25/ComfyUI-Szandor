import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzePrompt, highlightPrompt, SNIPPETS } from "../web/h3_prompt_syntax.js";

test("official base and reference syntax, standalone boundary tags and paired dialogue", () => {
    const text = "subject_definitions: <Subject 1> in <Picture 1>, <Video 2>, <Audio 3>\n" +
        "retention_analysis: <Subject 1>: fully_preserved - appearance.\n" +
        "detailed_description: [Shot 1] (S1,S2) say <d>[Polish] Żółć <scenetrans></d>\n" +
        "[Shot 2] At 00:03.000, (S1) says <d>[Polish] <scenetrans>Tak!<cutoff></d>";
    const result = analyzePrompt(text);
    assert.deepEqual(result.issues, []);
    for (const kind of ["section", "reference", "relation", "shot", "speaker", "dialogue", "bracket", "boundary"]) {
        assert.ok(result.tokens.some(t => t.kind === kind), kind);
    }
    const opening = result.tokens.find(t => t.kind === "dialogue");
    assert.equal(text.slice(opening.pair, opening.pair + 4), "</d>");
    assert.equal((highlightPrompt(text, result, opening.start + 1).match(/h3-paired/g) ?? []).length, 2);
});

test("missing, stray and nested dialogue tags point to the offending text", () => {
    for (const text of ["<d>[Polish] Cześć", "Cześć</d>", "<d>[Polish] <d>[Polish] Tak</d></d>", "<d>Cześć</d>", "<d>[Polish] Cześć<\\/d>"]) {
        const result = analyzePrompt(text);
        assert.ok(result.issues.length > 0, text);
        assert.ok(result.issues.every(i => text.slice(i.start, i.end).startsWith("<")));
    }
    assert.deepEqual(analyzePrompt("<d>[Portuguese (Brazil)] Olá</d>").issues, []);
});

test("highlighting escapes HTML, keeps arbitrary tags and does not interpret prose", () => {
    const text = '<img src=x onerror="alert(1)"> & <i>tekst</i> 2 < 3 {a|b}\n';
    const result = analyzePrompt(text);
    assert.deepEqual(result.issues, []);
    const html = highlightPrompt(text, result);
    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes("<i>"));
    assert.ok(html.includes("&amp;"));
    assert.ok(html.includes("2 &lt; 3 {a|b}"));
});

test("insertion templates produce balanced dialogue and expose the six Ref2VA fields", () => {
    const [, , prefix, suffix] = SNIPPETS.find(s => s[0] === "dialogue");
    assert.deepEqual(analyzePrompt(prefix + "Zażółć gęślą jaźń!" + suffix).issues, []);
    const reference = SNIPPETS.find(s => s[0] === "reference").slice(2).join("");
    assert.equal(analyzePrompt(reference).tokens.filter(t => t.kind === "section").length, 6);
});
