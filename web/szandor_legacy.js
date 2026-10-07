import { app } from "../../scripts/app.js";

// Combo values saved by older (Polish) versions of these nodes, mapped to the
// current English options so existing workflows keep loading and validating.
export const LEGACY_VALUES = {
    SzandorFolderMediaLoader: {
        media_filter: { wszystko: "all", obrazy: "images", wideo: "videos", "tylko z promptem": "prompt only" },
        time_output: {
            liczba: "number", "tekst: sekundy": "text: seconds",
            "tekst: mm:ss.mmm": "text: mm:ss.mmm", "tekst: hh:mm:ss.mmm": "text: hh:mm:ss.mmm",
        },
    },
    SzandorSaveAsSource: {
        on_exists: { numeruj: "increment", nadpisz: "overwrite", "pomiń": "skip" },
    },
    SzandorMusicVideoDirector: {
        backend: { "MiniMax H3 (płatne API)": "MiniMax H3 (paid API)", "Lokalny workflow (bez API)": "Local workflow (no API)" },
    },
};

export function legacyValue(nodeType, widgetName, value) {
    return LEGACY_VALUES[nodeType]?.[widgetName]?.[value] ?? value;
}

export function migrateLegacyWidgets(node, nodeType = node.type ?? node.comfyClass) {
    const map = LEGACY_VALUES[nodeType];
    if (!map) return;
    for (const widget of node.widgets ?? []) {
        const replacement = map[widget.name]?.[widget.value];
        if (replacement === undefined) continue;
        widget.value = replacement;
        widget.callback?.(replacement);
    }
}

app.registerExtension({
    name: "Szandor.LegacyValues",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (!LEGACY_VALUES[nodeData.name]) return;
        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (...args) {
            const result = originalConfigure?.apply(this, args);
            migrateLegacyWidgets(this, nodeData.name);
            return result;
        };
    },
});
