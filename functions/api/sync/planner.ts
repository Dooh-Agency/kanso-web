import { error, json, sameSecret, type PlannerContext, type PlannerEnv } from "../../_shared/planner";
import { loadInstagramPosts } from "../../_shared/instagram";
import { matchPublishedPosts, type LinkCandidate } from "../../_shared/published-links";

// Sincronización desde Apps Script. Fuera de Cloudflare Access: se autentica
// con la clave compartida PLANNER_SYNC_SECRET en el encabezado X-Planner-Secret.

const statuses = new Set(["draft", "review", "changes_requested", "approved", "rejected", "scheduled", "published"]);
const channels = new Set(["instagram", "linkedin", "both"]);

type ItemInput = {
  source_key: string;
  piece?: string;
  project: string;
  title: string;
  channel: string;
  format?: string;
  objective?: string;
  caption_es?: string;
  caption_en?: string;
  call_to_action?: string;
  creative_direction?: string;
  canva_url?: string | null;
  asset_url?: string | null;
  scheduled_at?: string | null;
  status: string;
  publish_requested?: boolean;
  published_url?: string | null;
  publication_state?: string;
  review_notes?: string;
  sort_order?: number;
};

type AssetInput = { r2_key: string; asset_type: "image" | "video"; drive_file_id?: string; alt_text?: string };

async function storedKeys(env: PlannerEnv, itemIds: string[]) {
  if (!itemIds.length) return [];
  const placeholders = itemIds.map(() => "?").join(", ");
  const [assets, previews] = await Promise.all([
    env.PLANNER_DB.prepare(`SELECT r2_key FROM content_item_assets WHERE content_item_id IN (${placeholders})`).bind(...itemIds).all<{ r2_key: string }>(),
    env.PLANNER_DB.prepare(`SELECT preview_key FROM content_items WHERE id IN (${placeholders}) AND preview_key IS NOT NULL`).bind(...itemIds).all<{ preview_key: string }>(),
  ]);
  return assets.results.map((row) => row.r2_key).concat(previews.results.map((row) => row.preview_key));
}

// En la grilla, “Estado” solo admite estados de revisión. Que la pieza ya está en
// la red lo indican “URL publicada” (publicada) o “Estado publicación” = Publicado
// (cargada en Meta o LinkedIn: programada hasta su fecha, publicada después).
function effectiveStatus(item: ItemInput, now = Date.now()) {
  if (item.status === "rejected") return item.status;
  if (item.published_url?.trim()) return "published";
  if (item.publication_state?.trim().toLowerCase() === "publicado") {
    const when = item.scheduled_at ? Date.parse(item.scheduled_at) : NaN;
    return !Number.isNaN(when) && when > now ? "scheduled" : "published";
  }
  return item.status;
}

// Crea o actualiza una pieza por su fila de la grilla. Devuelve los archivos ya
// guardados para que Apps Script suba solo lo nuevo.
async function upsertItem(env: PlannerEnv, item: ItemInput) {
  if (!item?.source_key || !item.title || !item.project) throw new Error("Faltan source_key, project o title.");
  if (!statuses.has(item.status)) throw new Error(`Estado inválido: ${item.status}`);
  if (!channels.has(item.channel)) throw new Error(`Canal inválido: ${item.channel}`);

  const status = effectiveStatus(item);

  const existing = await env.PLANNER_DB.prepare("SELECT id FROM content_items WHERE source_key = ?").bind(item.source_key).first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  await env.PLANNER_DB.prepare(`
    INSERT INTO content_items (id, source_key, piece, project, title, channel, format, objective, caption_es, caption_en,
      call_to_action, creative_direction, canva_url, asset_url, scheduled_at, status, publish_requested, published_url,
      review_notes, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT (source_key) DO UPDATE SET
      piece = excluded.piece, project = excluded.project, title = excluded.title, channel = excluded.channel,
      format = excluded.format, objective = excluded.objective, caption_es = excluded.caption_es,
      caption_en = excluded.caption_en, call_to_action = excluded.call_to_action,
      creative_direction = excluded.creative_direction, canva_url = excluded.canva_url, asset_url = excluded.asset_url,
      scheduled_at = excluded.scheduled_at, status = excluded.status, publish_requested = excluded.publish_requested,
      published_url = excluded.published_url, review_notes = excluded.review_notes, sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `).bind(
    id, item.source_key, item.piece ?? "", item.project, item.title, item.channel, item.format ?? "", item.objective ?? "",
    item.caption_es ?? "", item.caption_en ?? "", item.call_to_action ?? "", item.creative_direction ?? "",
    item.canva_url ?? null, item.asset_url ?? null, item.scheduled_at ?? null, status,
    item.publish_requested ? 1 : 0, item.published_url ?? null, item.review_notes ?? "", item.sort_order ?? 0,
  ).run();

  return { id, keys: await storedKeys(env, [id]) };
}

// Reemplaza la lista de archivos de una pieza y borra de R2 los que ya no se usan.
async function setAssets(env: PlannerEnv, itemId: string, assets: AssetInput[], previewKey: string | null) {
  const prefix = `items/${itemId}/`;
  const keys = assets.map((asset) => asset.r2_key).concat(previewKey ? [previewKey] : []);
  if (keys.some((key) => !key.startsWith(prefix))) throw new Error("Clave de archivo fuera de la carpeta de la pieza.");
  if (assets.some((asset) => asset.asset_type !== "image" && asset.asset_type !== "video")) throw new Error("Tipo de archivo inválido.");

  const previous = await storedKeys(env, [itemId]);
  await env.PLANNER_DB.batch([
    env.PLANNER_DB.prepare("DELETE FROM content_item_assets WHERE content_item_id = ?").bind(itemId),
    ...assets.map((asset, index) => env.PLANNER_DB
      .prepare("INSERT INTO content_item_assets (id, content_item_id, asset_type, r2_key, drive_file_id, alt_text, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), itemId, asset.asset_type, asset.r2_key, asset.drive_file_id ?? null, asset.alt_text ?? "", index + 1)),
    env.PLANNER_DB.prepare("UPDATE content_items SET preview_key = ? WHERE id = ?").bind(previewKey, itemId),
  ]);
  const obsolete = previous.filter((key) => !keys.includes(key));
  if (obsolete.length) await env.PLANNER_BUCKET.delete(obsolete);
}

// Borra las piezas que ya no están en la grilla, con sus archivos.
async function prune(env: PlannerEnv, sourceKeys: string[]) {
  const rows = await env.PLANNER_DB.prepare("SELECT id, source_key FROM content_items").all<{ id: string; source_key: string }>();
  const keep = new Set(sourceKeys);
  const removed = rows.results.filter((row) => !keep.has(row.source_key)).map((row) => row.id);
  if (!removed.length) return 0;
  const keys = await storedKeys(env, removed);
  const placeholders = removed.map(() => "?").join(", ");
  await env.PLANNER_DB.batch([
    env.PLANNER_DB.prepare(`DELETE FROM content_item_assets WHERE content_item_id IN (${placeholders})`).bind(...removed),
    env.PLANNER_DB.prepare(`DELETE FROM content_item_events WHERE content_item_id IN (${placeholders})`).bind(...removed),
    env.PLANNER_DB.prepare(`DELETE FROM content_items WHERE id IN (${placeholders})`).bind(...removed),
  ]);
  if (keys.length) await env.PLANNER_BUCKET.delete(keys);
  return removed.length;
}

// Busca en Instagram los posts ya publicados que todavía no tienen su link en
// la grilla, los marca como publicados y devuelve los links para que Apps
// Script los escriba en “URL publicada”.
const LINKS_MAX_AGE_MS = 10 * 60 * 1000;

async function instagramLinks(env: PlannerEnv) {
  const feed = await loadInstagramPosts(env, LINKS_MAX_AGE_MS);
  if (!feed.connected || !feed.posts.length) return { links: [], error: feed.error ?? "" };
  const rows = await env.PLANNER_DB.prepare(
    "SELECT source_key, channel, format, status, scheduled_at, caption_es, published_url FROM content_items",
  ).all<LinkCandidate>();
  const links = matchPublishedPosts(feed.posts, rows.results);
  if (links.length) {
    await env.PLANNER_DB.batch(links.map((link) => env.PLANNER_DB
      .prepare("UPDATE content_items SET published_url = ?, status = 'published', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE source_key = ?")
      .bind(link.permalink, link.source_key)));
  }
  return { links, error: feed.error ?? "" };
}

export async function onRequestPost({ request, env }: PlannerContext) {
  if (!sameSecret(request.headers.get("X-Planner-Secret"), env.PLANNER_SYNC_SECRET)) return error("Clave de sincronización inválida.", 401);

  let body: { op?: string; item?: ItemInput; item_id?: string; assets?: AssetInput[]; preview_key?: string | null; source_keys?: string[] };
  try {
    body = await request.json();
  } catch {
    return error("Pedido inválido.", 400);
  }

  try {
    if (body.op === "upsert_item") return json({ ok: true, ...(await upsertItem(env, body.item as ItemInput)) });
    if (body.op === "set_assets") {
      await setAssets(env, String(body.item_id ?? ""), body.assets ?? [], body.preview_key ?? null);
      return json({ ok: true });
    }
    if (body.op === "prune") {
      if (!Array.isArray(body.source_keys) || !body.source_keys.length) throw new Error("Falta la lista de filas de la grilla.");
      return json({ ok: true, removed: await prune(env, body.source_keys) });
    }
    if (body.op === "instagram_links") return json({ ok: true, ...(await instagramLinks(env)) });
    return error("Operación desconocida.", 400);
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Error de sincronización.", 400);
  }
}
