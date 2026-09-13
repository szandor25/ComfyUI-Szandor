import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../web/h3_template_snapshot.js", import.meta.url), "utf8");
const { captureTemplate } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

function host() {
    const widget = (name, value) => ({ name, value });
    const nodes = [
        { id: 1, type: "SzandorMiniMaxH3Prompt", widgets: [widget("prompt", "old")] },
        { id: 2, type: "LoadImage", widgets: [widget("image", "first.png"), widget("upload", "image")], outputs: [{ type: "IMAGE" }] },
        { id: 3, type: "SzandorDirectoryImageLoader", widgets: [widget("directory", "/photos"), widget("filename", "last.png")], outputs: [{ type: "IMAGE" }] },
        { id: 4, type: "MultiImageLoader", widgets: [widget("image_count", 2), widget("image_01", "a.png"), widget("image_02", "b.png"), widget("image_03", "unused.png")] },
        { id: 5, type: "MiniMaxH3ImageToVideo", widgets: [widget("length", 124), widget("seed", 42)] },
        { id: 6, type: "MiniMaxH3ImageToVideo", widgets: [widget("length", 362)] },
    ];
    const graph = {
        getNodeById: id => nodes.find(n => n.id === id),
        serialize: () => ({ nodes: nodes.map(n => ({ id: n.id, type: n.type, widgets_values: n.widgets.map(w => w.value) })),
            links: [[1, 1, 0, 5, 0, "STRING"]] }),
    };
    for (const node of nodes) node.graph = graph;
    return { app: { graph }, nodes, editor: nodes[0] };
}

test("snapshot preserves exact prompt, all image slots, directory mapping and connected duration", () => {
    const { app, nodes, editor } = host();
    const prompt = "  <d>[Polish] Cześć!</d>\n{a|b} ";
    const result = captureTemplate(app, editor, prompt);
    assert.equal(result.prompt, prompt);
    assert.equal(result.workflow.nodes[0].widgets_values[0], prompt);
    assert.equal(editor.widgets[0].value, "old");
    assert.deepEqual(result.images.map(r => [r.node_id, r.widget_index]), [[2, 0], [3, 1], [4, 1], [4, 2]]);
    assert.equal(result.images[1].directory_index, 0);
    assert.equal(result.duration, 5.167);
    assert.deepEqual(result.workflow.nodes[4].widgets_values, [124, 42]);
    assert.deepEqual(result.warnings, []);
    nodes[4].inputs = [{ name: "length", link: 10 }];
    assert.equal(captureTemplate(app, editor, prompt).duration, null);
});

test("linked image selectors and media inside subgraphs are reported before saving", () => {
    const { app, nodes, editor } = host();
    nodes[1].inputs = [{ widget: { name: "image" }, link: 10 }];
    assert.throws(() => captureTemplate(app, editor, "test"), /podłączone/);
    nodes[1].inputs = [];
    const serialize = app.graph.serialize;
    app.graph.serialize = () => ({ ...serialize(), definitions: { subgraphs: [{ nodes: [{ type: "LoadImage" }] }] } });
    assert.throws(() => captureTemplate(app, editor, "test"), /podgraf/);
});

test("uncopied audio and video dependencies are visible in template notes", () => {
    const { app, nodes, editor } = host();
    nodes.push({ id: 7, type: "LoadAudio", widgets: [{ name: "audio", value: "voice.wav" }], outputs: [{ type: "AUDIO" }] });
    assert.match(captureTemplate(app, editor, "test").warnings[0], /LoadAudio/);
});
