import type { D1Database } from "./planner";

// Origen de cada consulta del sitio (formulario o botón de WhatsApp), para saber
// qué canal trae clientes. No guarda datos personales: solo canal, campaña y
// páginas, que el navegador manda desde sessionStorage (components/LeadSource.tsx).

export type LeadKind = "form" | "whatsapp";

export type LeadOrigin = {
  source: string;
  medium: string;
  campaign: string;
  referrer: string;
  landing: string;
  page: string;
};

const clean = (value: unknown, max = 120) =>
  String(value ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, max);

// Solo el dominio del sitio de origen y rutas relativas: nunca URLs completas con parámetros.
const hostOnly = (value: unknown) => clean(value, 200).toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "");
const pathOnly = (value: unknown) => {
  const path = clean(value, 200).split(/[?#]/)[0];
  return path.startsWith("/") ? path : "";
};

export function readOrigin(get: (name: string) => unknown): LeadOrigin {
  return {
    source: clean(get("origen_source"), 60).toLowerCase(),
    medium: clean(get("origen_medium"), 60).toLowerCase(),
    campaign: clean(get("origen_campaign"), 80),
    referrer: hostOnly(get("origen_referrer")),
    landing: pathOnly(get("origen_landing")),
    page: pathOnly(get("origen_page")),
  };
}

const bySource: [RegExp, string][] = [
  [/^(instagram|ig)$/, "Instagram"],
  [/^(linkedin|li)$/, "LinkedIn"],
  [/^(facebook|fb|meta)$/, "Facebook"],
  [/^(whatsapp|wa)$/, "WhatsApp"],
  [/^(newsletter|email|mail|resend)$/, "Email"],
  [/^google$/, "Google"],
];

const byReferrer: [RegExp, string][] = [
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "LinkedIn"],
  [/(^|\.)(facebook\.com|fb\.me|fb\.com)$/, "Facebook"],
  [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "X"],
  [/(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/, "Asistentes de IA"],
  [/(^|\.)google\.[a-z.]+$/, "Google"],
  [/(^|\.)(bing\.com|duckduckgo\.com|yahoo\.com|ecosia\.org)$/, "Otros buscadores"],
  [/(^|\.)(wa\.me|whatsapp\.com)$/, "WhatsApp"],
  [/(^|\.)kanso\.ar$/, "Directo"],
];

export function channelOf(origin: LeadOrigin) {
  if (origin.source) {
    const match = bySource.find(([pattern]) => pattern.test(origin.source));
    if (match) return match[1] === "Google" && /cpc|ads|paid/.test(origin.medium) ? "Google Ads" : match[1];
    return origin.source.charAt(0).toUpperCase() + origin.source.slice(1);
  }
  if (origin.referrer) {
    const match = byReferrer.find(([pattern]) => pattern.test(origin.referrer));
    return match ? match[1] : origin.referrer;
  }
  return "Directo";
}

export function describeOrigin(origin: LeadOrigin) {
  const parts = [channelOf(origin)];
  if (origin.campaign) parts.push(`campaña “${origin.campaign}”`);
  if (origin.medium) parts.push(`medio ${origin.medium}`);
  if (origin.landing) parts.push(`entró por ${origin.landing}`);
  return parts.join(" · ");
}

async function ensureTable(db: D1Database) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS leads (
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
    )`,
  ).run();
}

export async function recordLead(db: D1Database | undefined, kind: LeadKind, origin: LeadOrigin) {
  if (!db) return;
  await ensureTable(db);
  await db.prepare(
    "INSERT INTO leads (id, kind, channel, source, medium, campaign, referrer_host, landing_path, contact_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), kind, channelOf(origin), origin.source, origin.medium, origin.campaign, origin.referrer, origin.landing, origin.page).run();
}

export type LeadRow = {
  created_at: string;
  kind: LeadKind;
  channel: string;
  campaign: string;
  landing_path: string;
  contact_path: string;
};

export async function leadSummary(db: D1Database) {
  await ensureTable(db);
  const [byMonth, recent] = await Promise.all([
    db.prepare(
      "SELECT substr(created_at, 1, 7) AS month, channel, kind, COUNT(*) AS total FROM leads WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 months') GROUP BY month, channel, kind ORDER BY month DESC, total DESC",
    ).all<{ month: string; channel: string; kind: LeadKind; total: number }>(),
    db.prepare(
      "SELECT created_at, kind, channel, campaign, landing_path, contact_path FROM leads ORDER BY created_at DESC LIMIT 30",
    ).all<LeadRow>(),
  ]);
  return { byMonth: byMonth.results, recent: recent.results };
}
