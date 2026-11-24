import { accessEmail, error, json, type PlannerContext } from "../../_shared/planner";
import { loadInstagramPosts } from "../../_shared/instagram";
import { matchPublishedPosts, permalinkKey, type LinkCandidate } from "../../_shared/published-links";

// Últimos posts publicados en @kanso.ar, para completar el feed del planificador.
// Se quitan los que ya corresponden a una pieza de la grilla, aunque su “URL
// publicada” todavía no se haya cargado (la carga la hace la sincronización de
// Apps Script; si no corrió, el post se vería dos veces). Solo lee: no escribe
// en D1 ni en la grilla.
export async function onRequestGet({ request, env }: PlannerContext) {
  const email = await accessEmail(request, env);
  if (!email) return error("Ingresá al planificador con un email habilitado del equipo.", 401);
  const feed = await loadInstagramPosts(env);
  if (!feed.posts.length) return json(feed);

  const rows = await env.PLANNER_DB.prepare(
    "SELECT source_key, channel, format, status, scheduled_at, caption_es, published_url FROM content_items",
  ).all<LinkCandidate>();
  const planned = new Set(matchPublishedPosts(feed.posts, rows.results).map((link) => permalinkKey(link.permalink)));
  return json({ ...feed, posts: feed.posts.filter((post) => !planned.has(permalinkKey(post.permalink))) });
}
