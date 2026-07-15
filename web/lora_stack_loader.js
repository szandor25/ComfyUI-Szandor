import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_TYPE = "SzandorLoraStackLoader";
const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 30;
const BUTTON_HEIGHT = 38;
const MIN_WIDTH = 520;
const thumbCache = new Map();
let loraListPromise = null;
let previewElement = null;

function loadLoraList() {
    if (!loraListPromise) {
        loraListPromise = api.fetchApi("/szandor/loras")
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then(data => data.loras ?? [])
            .catch(error => {
                loraListPromise = null;
                console.error("[Szandor LoRA Stack] Nie udało się pobrać listy LoRA:", error);
                return [];
            });
    }
    return loraListPromise;
}

function loadThumbnail(name) {
    if (!name) return Promise.resolve(null);
    if (thumbCache.has(name)) return Promise.resolve(thumbCache.get(name));

    return new Promise(resolve => {
        const image = new Image();
        image.onload = () => {
            thumbCache.set(name, image);
            resolve(image);
        };
        image.onerror = () => {
            thumbCache.set(name, null);
            resolve(null);
        };
        image.src = api.apiURL(`/szandor/lora-thumbnail?name=${encodeURIComponent(name)}`);
    });
}

function ensurePreview() {
    if (previewElement) return previewElement;
    previewElement = document.createElement("img");
    Object.assign(previewElement.style, {
        position: "fixed",
        zIndex: "100000",
        display: "none",
        pointerEvents: "none",
        maxWidth: "420px",
        maxHeight: "420px",
        border: "2px solid #8b78c6",
        borderRadius: "8px",
        boxShadow: "0 12px 36px rgba(0,0,0,.7)",
        background: "#181818",
        objectFit: "contain",
    });
    document.body.appendChild(previewElement);
    return previewElement;
}

function hidePreview() {
    if (previewElement) previewElement.style.display = "none";
}

function clientToGraph(clientX, clientY) {
    const rect = app.canvasEl.getBoundingClientRect();
    const scale = app.canvas.ds.scale ?? 1;
    const offset = app.canvas.ds.offset ?? [0, 0];
    return [
        (clientX - rect.left) / scale - offset[0],
        (clientY - rect.top) / scale - offset[1],
    ];
}

function placePreview(event, image) {
    const preview = ensurePreview();
    preview.src = image.src;
    preview.style.display = "block";
    const margin = 18;
    const width = Math.min(420, image.naturalWidth || 420);
    const height = Math.min(420, image.naturalHeight || 420);
    preview.style.left = `${Math.min(event.clientX + margin, window.innerWidth - width - margin)}px`;
    preview.style.top = `${Math.min(event.clientY + margin, window.innerHeight - height - margin)}px`;
}

function chooseLora(currentName = "", excludedNames = []) {
    return loadLoraList().then(loras => new Promise(resolve => {
        const excluded = new Set(excludedNames.filter(name => name !== currentName));
        const backdrop = document.createElement("div");
        Object.assign(backdrop.style, {
            position: "fixed",
            inset: "0",
            zIndex: "99999",
            background: "rgba(0,0,0,.55)",
            display: "grid",
            placeItems: "center",
        });

        const panel = document.createElement("div");
        Object.assign(panel.style, {
            width: "min(620px, 88vw)",
            maxHeight: "72vh",
            display: "flex",
            flexDirection: "column",
            padding: "14px",
            gap: "10px",
            border: "1px solid #666",
            borderRadius: "10px",
            background: "#242424",
            boxShadow: "0 18px 55px rgba(0,0,0,.75)",
        });

        const input = document.createElement("input");
        input.placeholder = "Szukaj LoRA...";
        input.value = currentName;
        Object.assign(input.style, {
            padding: "10px 12px",
            color: "#eee",
            background: "#171717",
            border: "1px solid #666",
            borderRadius: "6px",
            fontSize: "14px",
        });

        const list = document.createElement("div");
        Object.assign(list.style, {
            overflow: "auto",
            minHeight: "180px",
            maxHeight: "55vh",
        });

        const finish = value => {
            backdrop.remove();
            resolve(value);
        };

        let matches = [];
        let optionElements = [];
        let activeIndex = -1;

        const setActive = index => {
            if (!matches.length) {
                activeIndex = -1;
                return;
            }
            activeIndex = (index + matches.length) % matches.length;
            optionElements.forEach((option, optionIndex) => {
                const active = optionIndex === activeIndex;
                option.style.background = active ? "#39334b" : "transparent";
                option.style.color = active ? "#e4dcff" : "#ddd";
            });
            optionElements[activeIndex]?.scrollIntoView({ block: "nearest" });
        };

        const render = () => {
            const query = input.value.trim().toLowerCase();
            matches = loras
                .filter(name => !excluded.has(name) && name.toLowerCase().includes(query))
                .slice(0, 300);
            optionElements = [];
            list.replaceChildren();
            matches.forEach((name, index) => {
                const option = document.createElement("button");
                option.type = "button";
                option.textContent = name;
                Object.assign(option.style, {
                    display: "block",
                    width: "100%",
                    padding: "8px 10px",
                    color: name === currentName ? "#c7b7ff" : "#ddd",
                    textAlign: "left",
                    background: "transparent",
                    border: "0",
                    borderBottom: "1px solid #333",
                    cursor: "pointer",
                });
                option.onmouseenter = () => setActive(index);
                option.onclick = () => finish(name);
                optionElements.push(option);
                list.appendChild(option);
            });
            if (!matches.length) {
                const empty = document.createElement("div");
                empty.textContent = "Brak pasujacych LoRA";
                empty.style.cssText = "padding:20px;color:#888;text-align:center";
                list.appendChild(empty);
                activeIndex = -1;
            } else {
                const currentIndex = matches.indexOf(currentName);
                setActive(currentIndex >= 0 ? currentIndex : 0);
            }
        };

        input.oninput = render;
        input.onkeydown = event => {
            if (event.key === "Escape") {
                event.preventDefault();
                finish(null);
            }
            if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive(activeIndex + 1);
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive(activeIndex - 1);
            }
            if (event.key === "Enter") {
                event.preventDefault();
                if (activeIndex >= 0) finish(matches[activeIndex]);
            }
        };
        backdrop.onpointerdown = event => {
            if (event.target === backdrop) finish(null);
        };
        panel.append(input, list);
        backdrop.appendChild(panel);
        document.body.appendChild(backdrop);
        render();
        input.select();
        input.focus();
    }));
}

function safeRows(value) {
    try {
        const rows = JSON.parse(value || "[]");
        if (!Array.isArray(rows)) return [];
        const seenNames = new Set();
        return rows
            .filter(row => {
                if (!row || typeof row.name !== "string" || !row.name || seenNames.has(row.name)) {
                    return false;
                }
                seenNames.add(row.name);
                return true;
            })
            .map(row => ({
                name: row.name,
                enabled: row.enabled !== false,
                strength: Math.max(-4, Math.min(4, Number(row.strength) || 0)),
            }));
    } catch {
        return [];
    }
}

function shorten(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let result = text;
    while (result.length > 4 && ctx.measureText(`...${result}`).width > maxWidth) {
        result = result.slice(1);
    }
    return `...${result}`;
}

function makeStackWidget(node, initialValue) {
    const widget = {
        type: "SZANDOR_LORA_STACK",
        name: "lora_stack",
        value: initialValue || "[]",
        rows: safeRows(initialValue),
        _dragging: -1,
        _thumbRects: [],

        computeSize(width) {
            return [Math.max(width, MIN_WIDTH), HEADER_HEIGHT + this.rows.length * ROW_HEIGHT + BUTTON_HEIGHT];
        },

        sync() {
            this.value = this.serializeValue();
            const requiredSize = node.computeSize();
            node.setSize([
                Math.max(node.size[0], requiredSize[0]),
                Math.max(node.size[1], requiredSize[1]),
            ]);
            node.setDirtyCanvas(true, true);
        },

        setRowsFromValue() {
            this.rows = safeRows(this.value);
            for (const row of this.rows) this.prepareThumbnail(row);
            this.sync();
        },

        prepareThumbnail(row) {
            row.thumbnail = null;
            loadThumbnail(row.name).then(image => {
                row.thumbnail = image;
                node.setDirtyCanvas(true, true);
            });
        },

        draw(ctx, _node, width, y) {
            this._thumbRects = [];
            ctx.font = "12px sans-serif";
            ctx.textBaseline = "middle";

            const allEnabled = this.rows.length > 0 && this.rows.every(row => row.enabled);
            ctx.fillStyle = allEnabled ? "#9483c2" : "#777";
            ctx.beginPath();
            ctx.roundRect(12, y + 7, 34, 18, 10);
            ctx.fill();
            ctx.fillStyle = "#ddd";
            ctx.beginPath();
            ctx.arc(allEnabled ? 36 : 22, y + 16, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#aaa";
            ctx.textAlign = "left";
            ctx.fillText("Włącz wszystkie", 56, y + 16);

            const sortX = width - 274;
            ctx.fillStyle = "#292536";
            ctx.strokeStyle = "#75689b";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(sortX, y + 5, 58, 22, 5);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#cbbcff";
            ctx.font = "bold 11px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("A → Z", sortX + 29, y + 16);

            ctx.textAlign = "center";
            ctx.fillStyle = "#aaa";
            ctx.font = "12px sans-serif";
            ctx.fillText("Siła", width - 101, y + 16);

            this.rows.forEach((row, index) => {
                const top = y + HEADER_HEIGHT + index * ROW_HEIGHT;
                const middle = top + ROW_HEIGHT / 2;
                const thumbX = width - 214;
                const sliderX = width - 164;
                const sliderWidth = 126;

                ctx.fillStyle = row.enabled ? "#303030" : "#252525";
                ctx.strokeStyle = row.enabled ? "#777" : "#444";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(8, top + 3, width - 16, ROW_HEIGHT - 6, 10);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = row.enabled ? "#8fa5d2" : "#666";
                ctx.beginPath();
                ctx.roundRect(14, middle - 9, 32, 18, 10);
                ctx.fill();
                ctx.fillStyle = "#ddd";
                ctx.beginPath();
                ctx.arc(row.enabled ? 36 : 23, middle, 7, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = row.enabled ? "#eee" : "#777";
                ctx.font = "13px sans-serif";
                ctx.textAlign = "left";
                ctx.fillText(shorten(ctx, row.name, width - 292), 56, middle);

                ctx.fillStyle = "#171717";
                ctx.fillRect(thumbX, top + 8, 38, 36);
                if (row.thumbnail) {
                    const scale = Math.min(38 / row.thumbnail.width, 36 / row.thumbnail.height);
                    const imageWidth = row.thumbnail.width * scale;
                    const imageHeight = row.thumbnail.height * scale;
                    ctx.drawImage(row.thumbnail, thumbX + (38 - imageWidth) / 2, top + 8 + (36 - imageHeight) / 2, imageWidth, imageHeight);
                    this._thumbRects.push({ index, x: thumbX, y: top - y + 8, width: 38, height: 36 });
                } else {
                    ctx.fillStyle = "#555";
                    ctx.font = "10px sans-serif";
                    ctx.textAlign = "center";
                    ctx.fillText("brak", thumbX + 19, middle);
                }

                ctx.strokeStyle = "#777";
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(sliderX, middle + 7);
                ctx.lineTo(sliderX + sliderWidth, middle + 7);
                ctx.stroke();
                const normalized = (row.strength + 4) / 8;
                const knobX = sliderX + normalized * sliderWidth;
                ctx.fillStyle = "#ad9bdf";
                ctx.beginPath();
                ctx.arc(knobX, middle + 7, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = row.enabled ? "#ddd" : "#777";
                ctx.font = "11px monospace";
                ctx.textAlign = "center";
                ctx.fillText(row.strength.toFixed(2), sliderX + sliderWidth / 2, middle - 8);

                ctx.fillStyle = "#a55";
                ctx.font = "bold 16px sans-serif";
                ctx.fillText("x", width - 21, middle);
            });

            const buttonY = y + HEADER_HEIGHT + this.rows.length * ROW_HEIGHT + 5;
            ctx.fillStyle = "#202020";
            ctx.strokeStyle = "#777";
            ctx.beginPath();
            ctx.roundRect(8, buttonY, width - 16, 29, 6);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#b39bea";
            ctx.font = "bold 20px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("+", width / 2 - 48, buttonY + 15);
            ctx.fillStyle = "#ddd";
            ctx.font = "14px sans-serif";
            ctx.fillText("Dodaj LoRA", width / 2 + 10, buttonY + 15);
        },

        async mouse(event, pos) {
            const x = pos[0];
            const y = pos[1] - (this.last_y ?? 0);

            if (event.type === "pointermove") {
                const hovered = this._thumbRects.find(rect =>
                    x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
                );
                if (hovered && this.rows[hovered.index]?.thumbnail) {
                    placePreview(event, this.rows[hovered.index].thumbnail);
                } else {
                    hidePreview();
                }

                if (this._dragging >= 0) {
                    const sliderX = node.size[0] - 164;
                    const strength = Math.max(-4, Math.min(4, ((x - sliderX) / 126) * 8 - 4));
                    this.rows[this._dragging].strength = Math.round(strength * 20) / 20;
                    this.sync();
                    return true;
                }
                return Boolean(hovered);
            }

            if (event.type === "pointerup") {
                this._dragging = -1;
                return false;
            }
            if (event.type !== "pointerdown") return false;

            if (
                y < HEADER_HEIGHT &&
                x >= node.size[0] - 274 &&
                x <= node.size[0] - 216
            ) {
                this.rows.sort((left, right) => left.name.localeCompare(
                    right.name,
                    "pl",
                    { sensitivity: "base", numeric: true },
                ));
                this.sync();
                return true;
            }

            if (y < HEADER_HEIGHT && x >= 8 && x <= 170) {
                const enabled = !this.rows.every(row => row.enabled);
                this.rows.forEach(row => { row.enabled = enabled; });
                this.sync();
                return true;
            }

            const rowIndex = Math.floor((y - HEADER_HEIGHT) / ROW_HEIGHT);
            if (rowIndex >= 0 && rowIndex < this.rows.length) {
                const row = this.rows[rowIndex];
                if (x >= 8 && x <= 50) {
                    row.enabled = !row.enabled;
                    this.sync();
                    return true;
                }
                if (x >= node.size[0] - 34) {
                    this.rows.splice(rowIndex, 1);
                    hidePreview();
                    this.sync();
                    return true;
                }
                if (x >= node.size[0] - 170 && x <= node.size[0] - 32) {
                    this._dragging = rowIndex;
                    const strength = Math.max(-4, Math.min(4, ((x - (node.size[0] - 164)) / 126) * 8 - 4));
                    row.strength = Math.round(strength * 20) / 20;
                    this.sync();
                    return true;
                }
                if (x >= 50 && x < node.size[0] - 220) {
                    const selected = await chooseLora(
                        row.name,
                        this.rows.map(item => item.name),
                    );
                    if (selected && !this.rows.some((item, index) =>
                        index !== rowIndex && item.name === selected
                    )) {
                        row.name = selected;
                        this.prepareThumbnail(row);
                        this.sync();
                    }
                    return true;
                }
                return true;
            }

            const buttonTop = HEADER_HEIGHT + this.rows.length * ROW_HEIGHT;
            if (y >= buttonTop) {
                const selected = await chooseLora(
                    "",
                    this.rows.map(item => item.name),
                );
                if (selected && !this.rows.some(item => item.name === selected)) {
                    const row = { name: selected, enabled: true, strength: 1.0, thumbnail: null };
                    this.rows.push(row);
                    this.prepareThumbnail(row);
                    this.sync();
                }
                return true;
            }
            return false;
        },

        serializeValue() {
            return JSON.stringify(this.rows.map(({ name, enabled, strength }) => ({ name, enabled, strength })));
        },
    };

    for (const row of widget.rows) widget.prepareThumbnail(row);
    return widget;
}

app.registerExtension({
    name: "Szandor.LoraStackLoader",

    setup() {
        app.canvasEl?.addEventListener("pointerleave", hidePreview);
        app.canvasEl?.addEventListener("pointermove", event => {
            const [graphX, graphY] = clientToGraph(event.clientX, event.clientY);
            const node = app.graph.getNodeOnPos(graphX, graphY, app.graph._nodes);
            const widget = node?._szandorLoraStackWidget;
            if (!widget || node.flags?.collapsed) {
                hidePreview();
                return;
            }

            const localX = graphX - node.pos[0];
            const localY = graphY - node.pos[1] - (widget.last_y ?? 0);
            const hovered = widget._thumbRects.find(rect =>
                localX >= rect.x && localX <= rect.x + rect.width &&
                localY >= rect.y && localY <= rect.y + rect.height
            );
            const image = hovered && widget.rows[hovered.index]?.thumbnail;
            if (image) placePreview(event, image);
            else hidePreview();
        });
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated?.apply(this, arguments);
            const oldIndex = this.widgets?.findIndex(widget => widget.name === "lora_stack") ?? -1;
            const oldValue = oldIndex >= 0 ? this.widgets[oldIndex].value : "[]";
            if (oldIndex >= 0) this.widgets.splice(oldIndex, 1);

            const stackWidget = makeStackWidget(this, oldValue);
            this.widgets.push(stackWidget);
            this._szandorLoraStackWidget = stackWidget;
            const requiredSize = this.computeSize();
            this.setSize([
                Math.max(this.size[0], requiredSize[0], MIN_WIDTH),
                Math.max(this.size[1], requiredSize[1]),
            ]);
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            originalConfigure?.apply(this, arguments);
            this._szandorLoraStackWidget?.setRowsFromValue();
        };

        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            hidePreview();
            originalRemoved?.apply(this, arguments);
        };
    },
});
