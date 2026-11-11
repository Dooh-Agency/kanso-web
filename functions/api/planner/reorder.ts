import { accessEmail, error, json, syncSecret, type PlannerContext } from "../../_shared/planner";

type Move = { item_id: string; from_item_id: string };
type ItemRow = { id: string; source_key: string; title: string; status: string; scheduled_at: string | null };

const lockedStatuses = new Set(["scheduled", "published", "rejected"]);

/**
 * Nuevo orden de publicación armado en el planificador. Cada pieza movida toma
 * la fecha (`Día` y `Fecha/hora salida`) de la que ocupaba su lugar. Apps Script
 * escribe las fechas en la grilla, corre la story y la adaptación asociadas
 * (`Pieza relacionada`) y vuelve a sincronizar esas filas.
 */
export async function onRequestPost({ request, env }: PlannerContext) {
  const email = await accessEmail(request, env);
  if (!email) return error("Ingresá al planificador con un email habilitado del equipo.", 401);
  const secret = syncSecret(env);
  if (!env.PLANNER_ACTIONS_URL || !secret) return error("Las acciones del planificador no están configuradas.", 503);

  let body: { moves?: Move[] };
  try {
    body = await request.json();
  } catch {
    return error("Pedido inválido.", 400);
  }
  const moves = Array.isArray(body.moves) ? body.moves.map((move) => ({ item_id: String(move?.item_id ?? ""), from_item_id: String(move?.from_item_id ?? "") })) : [];
  if (!moves.length) return error("No hay cambios de orden para guardar.", 400);
  if (moves.length > 60) return error("Demasiadas piezas en un solo cambio.", 400);

  // Las fechas solo se intercambian: cada fecha que se toma la deja libre otra pieza movida.
  const targets = new Set(moves.map((move) => move.item_id));
  const sources = new Set(moves.map((move) => move.from_item_id));
  if (targets.size !== moves.length || sources.size !== moves.length || Array.from(targets).some((id) => !sources.has(id))) {
    return error("El orden enviado no es válido. Actualizá la página y volvé a intentar.", 400);
  }

  const ids = Array.from(targets);
  const rows = await env.PLANNER_DB.prepare(`SELECT id, source_key, title, status, scheduled_at FROM content_items WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .bind(...ids)
    .all<ItemRow>();
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  if (byId.size !== ids.length) return error("Alguna pieza ya no está en el planificador. Actualizá la página.", 404);
  const locked = rows.results.find((row) => lockedStatuses.has(row.status) || !row.scheduled_at);
  if (locked) return error(`“${locked.title}” ya no se puede mover (está programada, publicada, descartada o sin fecha). Actualizá la página.`, 409);

  // Apps Script responde con una redirección a googleusercontent.com; fetch la sigue.
  // Si la grilla no responde, se avisa sin perder el orden armado en la página.
  const response = await fetch(env.PLANNER_ACTIONS_URL.trim(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      action: "reorder",
      email,
      moves: moves.map((move) => {
        const target = byId.get(move.item_id)!;
        const source = byId.get(move.from_item_id)!;
        return { source_key: target.source_key, title: target.title, from_source_key: source.source_key, from_title: source.title };
      }),
    }),
  }).catch(() => null);
  const result = await response?.json().catch(() => null) as { ok?: boolean; error?: string; item?: { moved?: number; followed?: number } } | null;
  if (!result?.ok) return error(result?.error ?? "No fue posible guardar el orden en la grilla.", 502);

  await env.PLANNER_DB.batch(moves.map((move) => {
    const source = byId.get(move.from_item_id)!;
    return env.PLANNER_DB.prepare("INSERT INTO content_item_events (id, content_item_id, event_type, email, comment) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), move.item_id, "reorder", email, `Toma la fecha de “${source.title}”`);
  }));
  return json({ ok: true, moved: result.item?.moved ?? moves.length, followed: result.item?.followed ?? 0 });
}
