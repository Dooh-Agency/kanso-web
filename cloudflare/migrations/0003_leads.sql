-- Origen de las consultas del sitio (formulario y clics en WhatsApp), sin datos personales.
-- Opcional: functions/_shared/leads.ts crea la tabla si no existe.
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  kind TEXT NOT NULL,
  channel TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  medium TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  referrer_host TEXT NOT NULL DEFAULT '',
  landing_path TEXT NOT NULL DEFAULT '',
  contact_path TEXT NOT NULL DEFAULT ''
);
