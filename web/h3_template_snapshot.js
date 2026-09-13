// Snapshot only saved inputs; previews are not the source images and may be stale.
const IMAGE_FILE = /\.(png|jpe?g|webp|bmp|gif|tiff?|avif)(?:\s*\[(?:input|output|temp)\])?$/i;
const IMAGE_LOADERS = new Set(["LoadImage", "LoadImageMask", "LoadImageOutput", "MultiImageLoader", "SzandorDirectoryImageLoader"]);

export function captureTemplate(app, editor, prompt) {
    const graph = app.graph;
    const workflow = JSON.parse(JSON.stringify(graph.serialize()));
    const savedEditor = workflow.nodes.find(n => String(n.id) === String(editor.id) && n.type === "SzandorMiniMaxH3Prompt");
    if (!savedEditor || editor.graph !== graph) {
        throw new Error("Przed zapisem szablonu przenieś edytor z podgrafu do głównego workflow.");
    }
    // Some hosts serialize DOM widgets after graph.serialize(). Keep the exact current text.
    const promptIndex = editor.widgets.findIndex(w => w.name === "prompt");
    if (promptIndex < 0) throw new Error("Nie znaleziono pola promptu.");
    savedEditor.widgets_values[promptIndex] = prompt;
    const images = [];
    const warnings = [];
    for (const definition of workflow.definitions?.subgraphs ?? []) {
        if (definition.nodes?.some(n => IMAGE_LOADERS.has(n.type) || n.outputs?.some(o => ["IMAGE", "AUDIO", "VIDEO"].includes(o.type)))) {
            throw new Error("Workflow zawiera media w podgrafie. Rozwiń podgraf przed zapisem, aby zachować pliki referencyjne.");
        }
    }
    for (const saved of workflow.nodes) {
        const node = graph.getNodeById(saved.id);
        if (!node) continue;
        const widgets = node.widgets ?? [];
        const values = saved.widgets_values ?? [];
        const directoryIndex = widgets.findIndex(w => w.name === "directory");
        const count = Number(widgets.find(w => w.name === "image_count")?.value ?? 16);
        const hasImageOutput = node.outputs?.some(o => o.type === "IMAGE" || o.type === "MASK");
        const isLoader = IMAGE_LOADERS.has(saved.type);
        let captured = 0;
        widgets.forEach((widget, index) => {
            if (saved.type === "SzandorDirectoryImageLoader" && widget.name !== "filename") return;
            if (saved.type === "MultiImageLoader" && (!/^image_\d+$/.test(widget.name) || Number(widget.name.slice(-2)) > count)) return;
            const value = values[index];
            const fileField = /^(image|image_\d+|filename|file|path|image_path)$/i.test(widget.name);
            if (!fileField || (!isLoader && !hasImageOutput)) return;
            if (node.inputs?.some(input => input.widget?.name === widget.name && input.link != null)) {
                throw new Error(`Pole obrazu w nodzie „${node.title || saved.type}” jest podłączone jako wejście. Wybierz plik bezpośrednio w tym nodzie przed zapisem szablonu.`);
            }
            if (typeof value !== "string" || !value.trim()) return;
            if (!IMAGE_FILE.test(value)) {
                if (isLoader && widget.name !== "path") throw new Error(`Nieobsługiwany obraz w nodzie „${node.title || saved.type}”: ${value}`);
                return;
            }
            if (!Array.isArray(values)) throw new Error(`Nietypowy zapis pól w nodzie „${node.title || saved.type}”. Użyj Load Image lub loadera Szandor.`);
            images.push({
                node_id: saved.id, widget_index: index,
                ...(saved.type === "SzandorDirectoryImageLoader" ? { directory_index: directoryIndex } : {}),
                label: `${node.title || saved.type} #${saved.id} · ${widget.name}`,
            });
            captured++;
        });
        if (!captured && !isLoader && /load/i.test(saved.type) && hasImageOutput && !node.outputs?.some(o => ["AUDIO", "VIDEO"].includes(o.type))) {
            throw new Error(`Nie można skopiować zdjęć z noda „${node.title || saved.type}”. Przed zapisem użyj Load Image, Multi Image Loader lub Load Image From Directory (Szandor).`);
        }
        if (!captured && !isLoader && /load/i.test(saved.type) && node.outputs?.some(o => ["AUDIO", "VIDEO"].includes(o.type))) {
            warnings.push(`„${node.title || saved.type}” #${saved.id}: źródło mediów nie jest kopiowane; pozostaje odwołanie zapisane w workflow.`);
        }
    }

    // Follow the editor's downstream branch, avoiding unrelated H3 generators.
    const downstream = new Set([String(editor.id)]);
    for (let changed = true; changed;) {
        changed = false;
        for (const link of workflow.links ?? []) {
            const origin = String(Array.isArray(link) ? link[1] : link.origin_id);
            const target = String(Array.isArray(link) ? link[3] : link.target_id);
            if (downstream.has(origin) && !downstream.has(target)) { downstream.add(target); changed = true; }
        }
    }
    const durations = new Set();
    for (const saved of workflow.nodes) {
        if (!downstream.has(String(saved.id)) || !/minimaxh3/i.test(saved.type)) continue;
        const node = graph.getNodeById(saved.id);
        const duration = node.widgets?.find(w => /^(duration|duration_seconds)$/.test(w.name));
        const length = node.widgets?.find(w => w.name === "length");
        const field = duration || length;
        if (!field || node.inputs?.some(input => (input.name === field.name || input.widget?.name === field.name) && input.link != null)) continue;
        const seconds = Number(field.value) / (duration ? 1 : 24);
        if (Number.isFinite(seconds) && seconds > 0) durations.add(Math.round(seconds * 1000) / 1000);
    }
    return { workflow, editor_id: editor.id, prompt, images, warnings,
        duration: durations.size === 1 ? [...durations][0] : null };
}
