import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { captureTemplate } from "./h3_template_snapshot.js";

const ENDPOINT = "/szandor/h3-templates";

async function request(path = "", payload, method = payload === undefined ? "GET" : "POST") {
    const response = await api.fetchApi(ENDPOINT + path, {
        method,
        ...(payload === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Template library error (HTTP ${response.status}). Restart ComfyUI after updating.`);
    return data;
}

function el(tag, text, className = "") {
    const item = document.createElement(tag);
    item.className = className;
    if (text) item.textContent = text;
    return item;
}

export function openTemplates(node, getPrompt) {
    const dialog = el("dialog", "", "h3-template-dialog");
    const heading = el("div", "", "h3-template-heading");
    const close = el("button", "Close");
    close.type = "button";
    heading.append(el("h2", "MiniMax H3 templates"), close);
    dialog.append(heading, el("p", "A template keeps the whole workflow, the full prompt and copies of the images. Loading one replaces the current workflow; save unsaved changes first."));
    const form = el("form", "", "h3-template-form");
    const name = el("input");
    name.placeholder = "New template name";
    name.required = true;
    name.maxLength = 160;
    name.setAttribute("aria-label", "Template name");
    const duration = el("input");
    duration.type = "number";
    duration.min = "0.001";
    duration.step = "any";
    duration.placeholder = "Duration (s), optional";
    duration.setAttribute("aria-label", "Informational duration in seconds");
    const notes = el("textarea");
    notes.rows = 2;
    notes.placeholder = "Notes: what the references are for, restore remarks…";
    notes.maxLength = 10000;
    notes.setAttribute("aria-label", "Template notes");
    const save = el("button", "Save new template");
    save.type = "submit";
    const hint = el("p", "The duration is descriptive only. A value read from the H3 frame count is approximate (24 fps); correct it or leave it empty.", "h3-template-muted");
    const sourceInfo = el("div", "", "h3-template-muted");
    let snapshot;
    try {
        snapshot = captureTemplate(app, node, getPrompt());
        duration.value = snapshot.duration ?? "";
        sourceInfo.textContent = `To copy: ${snapshot.images.length} image(s). ` + snapshot.warnings.join(" ");
    } catch (error) {
        sourceInfo.textContent = error.message;
        save.disabled = true;
    }
    form.append(name, duration, notes, hint, sourceInfo, save);
    const message = el("p", "", "h3-template-message");
    message.setAttribute("role", "status");
    const refresh = el("button", "Refresh list");
    refresh.type = "button";
    const list = el("div", "", "h3-template-list");
    const preview = el("section", "", "h3-template-preview");
    dialog.append(form, message, refresh, list, preview,
        el("p", "The library is stored on the ComfyUI server disk, in the user directory szandor_h3_templates. Models, LoRAs and other extensions are not copied; their names and settings stay in the workflow.", "h3-template-muted"));
    let busy = false;
    let selectionVersion = 0;
    let listVersion = 0;
    let selected = null;
    const dismiss = () => { if (!busy) dialog.close(); };
    close.onclick = dismiss;
    dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => { selectionVersion++; listVersion++; dialog.remove(); });
    dialog.addEventListener("keydown", event => event.stopPropagation());
    dialog.addEventListener("pointerdown", event => event.stopPropagation());
    dialog.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
    function setBusy(value) {
        busy = value;
        close.disabled = value;
        save.disabled = value || !snapshot;
        refresh.disabled = value;
        for (const button of list.querySelectorAll("button")) button.disabled = value;
        for (const button of preview.querySelectorAll("button")) button.disabled = value;
    }
    async function show(templateId) {
        const version = ++selectionVersion;
        preview.replaceChildren();
        selected = null;
        try {
            const data = await request(`/${templateId}`);
            if (version !== selectionVersion || !dialog.isConnected) return;
            selected = data.id;
            preview.append(el("h3", data.name), el("p", `Duration: ${data.duration == null ? "not set" : `${data.duration} s`} · Images: ${data.images.length}`));
            if (data.notes) preview.append(el("p", data.notes));
            const prompt = el("pre", data.prompt, "h3-template-prompt");
            preview.append(prompt);
            const gallery = el("div", "", "h3-template-gallery");
            for (const ref of data.images) {
                const figure = el("figure");
                const image = el("img");
                image.src = api.apiURL(`${ENDPOINT}/${data.id}/images/${encodeURIComponent(ref.file)}`);
                image.alt = ref.original_name;
                image.loading = "lazy";
                figure.append(image, el("figcaption", `${ref.label}\n${ref.original_name}`));
                gallery.append(figure);
            }
            const load = el("button", "Load the whole workflow with images");
            load.type = "button";
            load.disabled = busy;
            load.onclick = async () => {
                if (busy || selected !== data.id) return;
                setBusy(true);
                message.textContent = "Restoring image copies and the workflow…";
                try {
                    const restored = await request(`/${data.id}/restore`, {});
                    await app.loadGraphData(restored.workflow);
                    dialog.close();
                } catch (error) {
                    message.textContent = error.message;
                } finally { setBusy(false); }
            };
            const remove = el("button", "Delete template", "h3-template-delete");
            remove.type = "button";
            remove.disabled = busy;
            const confirmation = el("div", "", "h3-template-delete-confirm");
            confirmation.hidden = true;
            const confirm = el("button", "Delete permanently", "h3-template-delete");
            const cancel = el("button", "Cancel");
            confirm.type = cancel.type = "button";
            confirmation.append(el("p", `Delete the template "${data.name}" and the images stored in its library? Original images and copies already loaded into workflows stay on disk.`), confirm, cancel);
            remove.onclick = () => {
                if (busy) return;
                confirmation.hidden = false;
                cancel.focus();
            };
            cancel.onclick = () => { confirmation.hidden = true; remove.focus(); };
            confirm.onclick = async () => {
                if (busy || selected !== data.id) return;
                setBusy(true);
                message.textContent = "Deleting the template…";
                try {
                    await request(`/${data.id}`, undefined, "DELETE");
                    selectionVersion++;
                    selected = null;
                    preview.replaceChildren();
                    message.textContent = `Deleted the template "${data.name}".`;
                    await reload();
                } catch (error) { message.textContent = error.message; }
                finally { setBusy(false); }
            };
            const actions = el("div", "", "h3-template-actions");
            actions.append(load, remove);
            preview.append(gallery, actions, confirmation);
        } catch (error) { if (version === selectionVersion) message.textContent = error.message; }
    }
    async function reload(selectId) {
        const version = ++listVersion;
        const templates = await request();
        if (version !== listVersion || !dialog.isConnected) return;
        list.replaceChildren();
        if (!templates.length) list.append(el("p", "No saved templates yet."));
        for (const item of templates) {
            const button = el("button", `${item.name} · ${item.images.length} image(s)${item.duration == null ? "" : ` · ${item.duration} s`} · ${new Date(item.created_at).toLocaleString()}`);
            button.type = "button";
            button.onclick = () => { if (!busy) show(item.id); };
            list.append(button);
        }
        if (selectId) await show(selectId);
    }
    refresh.onclick = async () => {
        try { await reload(); } catch (error) { message.textContent = error.message; }
    };
    form.onsubmit = async event => {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        try {
            // Capture again at save time, including changes made before opening this dialog.
            snapshot = captureTemplate(app, node, getPrompt());
            setBusy(true);
            message.textContent = "Saving the workflow and copying images…";
            const data = await request("", {
                ...snapshot, name: name.value, duration: duration.value === "" ? null : Number(duration.value),
                notes: [notes.value, ...snapshot.warnings].filter(Boolean).join("\n"),
            });
            message.textContent = `Saved "${data.name}" with ${data.images.length} image(s).`;
            await reload(data.id);
        } catch (error) { message.textContent = error.message; }
        finally { setBusy(false); }
    };
    document.body.append(dialog);
    dialog.showModal();
    name.focus();
    reload().catch(error => { message.textContent = error.message; });
}
