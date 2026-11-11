import { accessEmail, assetUrl, error, json, type PlannerContext } from "../../_shared/planner";

type ItemRow = {
  id: string;
  source_key: string;
  piece: string;
  project: string;
  title: string;
  channel: string;
  format: string;
  objective: string;
  caption_es: string;
  caption_en: string;
  call_to_action: string;
  creative_direction: string;
  canva_url: string | null;
  asset_url: string | null;
  preview_key: string | null;
  scheduled_at: string | null;
  status: string;
  publish_requested: number;
  published_url: string | null;
  review_notes: string;
  sort_order: number;
};

type AssetRow = { id: string; content_item_id: string; asset_type: string; r2_key: string; alt_text: string; sort_order: number };

// Piezas sincronizadas desde la grilla, con sus imágenes servidas por /api/planner/assets.
export async function onRequestGet({ request, env }: PlannerContext) {
  const email = await accessEmail(request, env);
  if (!email) return error("Ingresá al planificador con un email habilitado del equipo.", 401);

  const [items, assets] = await Promise.all([
    env.PLANNER_DB.prepare("SELECT * FROM content_items ORDER BY sort_order DESC, scheduled_at DESC").all<ItemRow>(),
    env.PLANNER_DB.prepare("SELECT * FROM content_item_assets ORDER BY content_item_id, sort_order").all<AssetRow>(),
  ]);

  const byItem = new Map<string, AssetRow[]>();
  for (const asset of assets.results) {
    const list = byItem.get(asset.content_item_id) ?? [];
    list.push(asset);
    byItem.set(asset.content_item_id, list);
  }

  return json({
    viewer: email,
    items: items.results.map(({ preview_key, publish_requested, ...item }) => ({
      ...item,
      // Cargada en la red con fecha ya pasada: ya salió.
      status: item.status === "scheduled" && item.scheduled_at && Date.parse(item.scheduled_at) <= Date.now() ? "published" : item.status,
      publish_requested: Boolean(publish_requested),
      previewUrl: preview_key ? assetUrl(preview_key) : "",
      assets: (byItem.get(item.id) ?? []).map((asset) => ({
        id: asset.id,
        asset_type: asset.asset_type,
        alt_text: asset.alt_text,
        sort_order: asset.sort_order,
        previewUrl: assetUrl(asset.r2_key),
      })),
    })),
  });
}
