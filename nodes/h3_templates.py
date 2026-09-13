"""ComfyUI routes for the H3 editor's per-user template library."""

import asyncio

import folder_paths
from aiohttp import web
from server import PromptServer

from .h3_template_store import TemplateStore


def store(request):
    root = PromptServer.instance.user_manager.get_request_user_filepath(request, "szandor_h3_templates")
    if root is None:
        raise web.HTTPForbidden()
    return TemplateStore(root, folder_paths.get_input_directory(),
                         folder_paths.get_output_directory(), folder_paths.get_temp_directory())


async def run(action, *args):
    try:
        return web.json_response(await asyncio.to_thread(action, *args))
    except FileNotFoundError as error:
        return web.json_response({"error": f"Nie znaleziono pliku: {error.filename or error}"}, status=404)
    except (ValueError, KeyError, TypeError, OSError) as error:
        return web.json_response({"error": str(error)}, status=400)


@PromptServer.instance.routes.get("/szandor/h3-templates")
async def list_templates(request):
    return await run(store(request).list)


@PromptServer.instance.routes.post("/szandor/h3-templates")
async def save_template(request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError("Nieprawidłowy szablon.")
    except ValueError:
        return web.json_response({"error": "Nieprawidłowy szablon."}, status=400)
    return await run(store(request).save, payload)


@PromptServer.instance.routes.get("/szandor/h3-templates/{template_id}")
async def get_template(request):
    return await run(store(request).read, request.match_info["template_id"])


@PromptServer.instance.routes.post("/szandor/h3-templates/{template_id}/restore")
async def restore_template(request):
    return await run(store(request).restore, request.match_info["template_id"])


@PromptServer.instance.routes.delete("/szandor/h3-templates/{template_id}")
async def delete_template(request):
    return await run(store(request).delete, request.match_info["template_id"])


@PromptServer.instance.routes.get("/szandor/h3-templates/{template_id}/images/{filename}")
async def template_image(request):
    try:
        path = await asyncio.to_thread(store(request).image_path,
                                       request.match_info["template_id"], request.match_info["filename"])
        return web.FileResponse(path)
    except (OSError, ValueError, KeyError):
        raise web.HTTPNotFound()
