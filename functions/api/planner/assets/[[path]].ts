import { accessEmail, error, type PlannerContext } from "../../../_shared/planner";

// Sirve las imágenes y videos privados del bucket R2 solo al equipo.
export async function onRequestGet({ request, env, params }: PlannerContext) {
  const email = await accessEmail(request, env);
  if (!email) return error("Sin acceso.", 401);

  const parts = Array.isArray(params.path) ? params.path : [params.path];
  const key = parts.map((part) => decodeURIComponent(part)).join("/");
  if (!key.startsWith("items/")) return error("Archivo no encontrado.", 404);

  const object = await env.PLANNER_BUCKET.get(key);
  if (!object) return error("Archivo no encontrado.", 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      ETag: object.httpEtag,
      // La clave cambia cuando cambia el archivo en Drive: se puede cachear en el navegador.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
