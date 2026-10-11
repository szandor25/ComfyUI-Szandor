import assert from "node:assert/strict";
import { test } from "node:test";
import { findMatches, highlightMatches, replaceMatches } from "../web/h3_find_replace.js";

test("matching is literal and ignores case unless asked", () => {
    const text = "The camera pans. the CAMERA (S1) says: a.b";
    assert.deepEqual(findMatches(text, "camera").map(m => text.slice(m.start, m.end)), ["camera", "CAMERA"]);
    assert.deepEqual(findMatches(text, "camera", true).length, 1);
    assert.deepEqual(findMatches(text, "(S1)").map(m => m.start), [text.indexOf("(S1)")]);
    assert.deepEqual(findMatches(text, "a.b").length, 1);
    assert.deepEqual(findMatches(text, ""), []);
});

test("Polish letters match regardless of case", () => {
    const text = "Żółw i żÓŁW";
    assert.equal(findMatches(text, "żółw").length, 2);
    assert.equal(findMatches(text, "żółw", true).length, 0);
});

test("replacing keeps the rest of the text and allows an empty replacement", () => {
    const text = "red car, Red door, red";
    assert.equal(replaceMatches(text, findMatches(text, "red"), "blue"), "blue car, blue door, blue");
    assert.equal(replaceMatches(text, findMatches(text, "red", true), ""), " car, Red door, ");
});

test("the match layer escapes HTML and marks the current match", () => {
    const text = "<d>[Polish] tak</d> tak";
    const html = highlightMatches(text, findMatches(text, "tak"), 1);
    assert.ok(!html.includes("<d>"));
    assert.equal((html.match(/class="h3-match"/g) ?? []).length, 1);
    assert.equal((html.match(/h3-match-current/g) ?? []).length, 1);
    assert.ok(html.endsWith("tak</mark>\n"));
});
