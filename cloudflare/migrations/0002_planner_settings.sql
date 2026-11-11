-- Ajustes del planificador que cambian solos (token renovado de Instagram y
-- caché del feed publicado). La función /api/planner/instagram la crea si no
-- existe, así que aplicar esta migración es opcional.
CREATE TABLE IF NOT EXISTS planner_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
