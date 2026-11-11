import { error, json, sameSecret, type PlannerContext } from "../../_shared/planner";

// Sube a R2 un archivo de Drive enviado por Apps Script (cuerpo binario).
// La clave incluye el ID del archivo y su fecha de modificación, así que un
// archivo que no cambió no se vuelve a subir.
export async function onRequestPut({ request, env }: PlannerContext) {
  if (!sameSecret(request.headers.get("X-Planner-Secret"), env.PLANNER_SYNC_SECRET)) return error("Clave de sincronización inválida.", 401);

  const key = new URL(request.url).searchParams.get("key") ?? "";
  const match = key.match(/^items\/([0-9a-f-]{36})\/[A-Za-z0-9._-]+$/);
  if (!match) return error("Clave de archivo inválida.", 400);
  const item = await env.PLANNER_DB.prepare("SELECT id FROM content_items WHERE id = ?").bind(match[1]).first<{ id: string }>();
  if (!item) return error("La pieza no existe.", 404);

  const contentType = request.headers.get("Content-Type") ?? "application/octet-stream";
  if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) return error("Solo se aceptan imágenes y videos.", 415);

  await env.PLANNER_BUCKET.put(key, await request.arrayBuffer(), { httpMetadata: { contentType } });
  return json({ ok: true, key });
}
