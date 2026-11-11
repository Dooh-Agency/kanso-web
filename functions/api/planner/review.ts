import { accessEmail, error, json, syncSecret, type PlannerContext } from "../../_shared/planner";

const actions = new Set(["approve", "request_changes"]);

/**
 * Aprobación o pedido de cambios desde el planificador. La decisión se escribe
 * en la grilla mediante Apps Script, que vuelve a sincronizar esa fila: la
 * grilla sigue siendo la fuente de verdad.
 */
export async function onRequestPost({ request, env }: PlannerContext) {
  const email = await accessEmail(request, env);
  if (!email) return error("Ingresá al planificador con un email habilitado del equipo.", 401);
  const secret = syncSecret(env);
  if (!env.PLANNER_ACTIONS_URL || !secret) return error("Las acciones de revisión no están configuradas.", 503);

  let body: { item_id?: string; action?: string; comment?: string };
  try {
    body = await request.json();
  } catch {
    return error("Pedido inválido.", 400);
  }
  const action = String(body.action ?? "");
  const comment = String(body.comment ?? "").trim().slice(0, 2000);
  if (!actions.has(action)) return error("Acción desconocida.", 400);
  if (action === "request_changes" && !comment) return error("Escribí qué hay que cambiar.", 400);

  const item = await env.PLANNER_DB.prepare("SELECT id, source_key, title, status FROM content_items WHERE id = ?")
    .bind(String(body.item_id ?? ""))
    .first<{ id: string; source_key: string; title: string; status: string }>();
  if (!item) return error("La pieza ya no está en el planificador. Actualizá la página.", 404);
  if (item.status === "scheduled" || item.status === "published") return error("La pieza ya está programada o publicada.", 409);

  // Apps Script responde con una redirección a googleusercontent.com; fetch la sigue.
  const response = await fetch(env.PLANNER_ACTIONS_URL.trim(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, source_key: item.source_key, title: item.title, action, comment, email }),
  });
  const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!result?.ok) return error(result?.error ?? "No fue posible guardar la decisión en la grilla.", 502);

  const approved = action === "approve";
  await env.PLANNER_DB.batch([
    env.PLANNER_DB.prepare("UPDATE content_items SET approved_at = ?, approved_by = ? WHERE id = ?")
      .bind(approved ? new Date().toISOString() : null, approved ? email : null, item.id),
    env.PLANNER_DB.prepare("INSERT INTO content_item_events (id, content_item_id, event_type, email, comment) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), item.id, action, email, comment),
  ]);
  return json({ ok: true });
}
