import type { PublishedPost } from "./instagram";

// Empareja los posts ya publicados en Instagram con las piezas de la grilla que
// todavía no tienen “URL publicada”, para cargar el link sin hacerlo a mano.
// 1. Primero por el comienzo del copy (sin marcas como [ES] o [REVISAR]),
//    dentro de las dos semanas de la fecha de salida.
// 2. Si el copy no alcanza, por el día de salida: solo si ese día hay una única
//    pieza de feed de Instagram sin link.
// Ante la duda (dos piezas posibles) no empareja: el link se carga a mano.

export type LinkCandidate = {
  source_key: string;
  channel: string;
  format: string;
  status: string;
  scheduled_at: string | null;
  caption_es: string;
  published_url: string | null;
};

export type PublishedLink = { source_key: string; permalink: string };

const TIME_ZONE = "America/Argentina/Buenos_Aires";
const TEXT_LENGTH = 40;
const MIN_TEXT = 20;
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function permalinkKey(url: string | null | undefined) {
  return (url ?? "").split("?")[0].replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "").toLowerCase();
}

/** Comienzo del copy, sin marcas entre corchetes, acentos, signos ni mayúsculas. */
export function textKey(caption: string) {
  return caption
    .replace(/\[[^\]]*\]/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, TEXT_LENGTH);
}

const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(iso));

function feedCandidate(item: LinkCandidate) {
  return item.channel !== "linkedin"
    && !/story/i.test(item.format)
    && !item.published_url?.trim()
    && item.status !== "rejected"
    && Boolean(item.scheduled_at && !Number.isNaN(Date.parse(item.scheduled_at)));
}

export function matchPublishedPosts(posts: PublishedPost[], items: LinkCandidate[]): PublishedLink[] {
  const linked = new Set(items.map((item) => permalinkKey(item.published_url)).filter(Boolean));
  let pool = items.filter(feedCandidate);
  const links: PublishedLink[] = [];

  const ordered = posts.filter((post) => !linked.has(permalinkKey(post.permalink)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  for (const post of ordered) {
    const posted = Date.parse(post.timestamp);
    if (Number.isNaN(posted)) continue;
    const near = pool.filter((item) => Math.abs(Date.parse(item.scheduled_at as string) - posted) <= WINDOW_MS);

    const postText = textKey(post.caption);
    let matches = postText.length >= MIN_TEXT
      ? near.filter((item) => {
        const itemText = textKey(item.caption_es);
        const length = Math.min(itemText.length, postText.length);
        return length >= MIN_TEXT && itemText.slice(0, length) === postText.slice(0, length);
      })
      : [];
    if (!matches.length) matches = near.filter((item) => dayOf(item.scheduled_at as string) === dayOf(post.timestamp));
    if (matches.length !== 1) continue;

    const [item] = matches;
    links.push({ source_key: item.source_key, permalink: post.permalink });
    pool = pool.filter((candidate) => candidate !== item);
  }
  return links;
}
