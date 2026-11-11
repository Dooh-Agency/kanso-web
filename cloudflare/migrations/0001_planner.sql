-- Planificador de redes en Cloudflare D1 (reemplaza a Supabase).
-- La grilla de Google Sheets es la fuente de verdad: Apps Script sincroniza
-- estas tablas y las imágenes en R2. El panel solo lee.

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  -- Referencia estable a la fila de la grilla: spreadsheetId:sheetId:fila.
  source_key TEXT NOT NULL UNIQUE,
  piece TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('instagram', 'linkedin', 'both')),
  format TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  caption_es TEXT NOT NULL DEFAULT '',
  caption_en TEXT NOT NULL DEFAULT '',
  call_to_action TEXT NOT NULL DEFAULT '',
  creative_direction TEXT NOT NULL DEFAULT '',
  canva_url TEXT,
  asset_url TEXT,
  preview_key TEXT,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'changes_requested', 'approved', 'rejected', 'scheduled', 'published')),
  publish_requested INTEGER NOT NULL DEFAULT 0,
  published_url TEXT,
  review_notes TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
  approved_by TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS content_items_sort_idx ON content_items (sort_order DESC, scheduled_at DESC);

CREATE TABLE IF NOT EXISTS content_item_assets (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('image', 'video')),
  -- Clave del archivo en el bucket R2 del planificador.
  r2_key TEXT NOT NULL,
  drive_file_id TEXT,
  alt_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS content_item_assets_item_idx ON content_item_assets (content_item_id, sort_order);

CREATE TABLE IF NOT EXISTS content_item_events (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  email TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS content_item_events_item_idx ON content_item_events (content_item_id, created_at DESC);
