import type { PlannerEnv } from "./planner";

// Lectura de los últimos posts publicados en @kanso.ar. Solo lectura: la
// función únicamente lista posts, aunque el token tenga otros permisos. Acepta
// dos tipos de token:
// - De usuario de Instagram (empieza con “IG”): vence a los 60 días y se renueva solo.
// - De usuario del sistema de Meta (inicio de sesión unificado): no vence.
// La respuesta se guarda en D1 para no consultar Instagram en cada visita.
// La usan el feed del planificador y la sincronización de la grilla.

const INSTAGRAM_GRAPH = "https://graph.instagram.com";
const FACEBOOK_GRAPH = "https://graph.facebook.com";
// ID de la cuenta de Instagram de @kanso.ar en Meta: se carga en INSTAGRAM_ACCOUNT_ID
// (no es secreto). Sin él se prueban las rutas que no lo necesitan.
const DEFAULT_ACCOUNT_ID = "";
const FEED_TTL_MS = 3 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const LIMIT = 12;

type InstagramMedia = {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
};

export type PublishedPost = {
  id: string;
  type: "image" | "video" | "carousel";
  imageUrl: string;
  permalink: string;
  timestamp: string;
  caption: string;
};

type StoredToken = { token: string; refreshedAt: number; seed: string };
type StoredFeed = { fetchedAt: number; posts: PublishedPost[] };

async function settings(env: PlannerEnv) {
  await env.PLANNER_DB.prepare(
    "CREATE TABLE IF NOT EXISTS planner_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))",
  ).run();
  return {
    async get<T>(key: string): Promise<T | null> {
      const row = await env.PLANNER_DB.prepare("SELECT value FROM planner_settings WHERE key = ?").bind(key).first<{ value: string }>();
      return row ? JSON.parse(row.value) as T : null;
    },
    async set(key: string, value: unknown) {
      await env.PLANNER_DB.prepare(
        "INSERT INTO planner_settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ).bind(key, JSON.stringify(value)).run();
    },
  };
}

// El secreto de Cloudflare es el token inicial; si se vuelve a autorizar la
// cuenta y se pega uno nuevo, reemplaza al renovado que estaba guardado.
async function currentToken(env: PlannerEnv, store: Awaited<ReturnType<typeof settings>>) {
  const initial = env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!initial) return null;
  const seed = initial.slice(-12);
  let stored = await store.get<StoredToken>("instagram_token");
  if (!stored || stored.seed !== seed) {
    stored = { token: initial, refreshedAt: Date.now(), seed };
    await store.set("instagram_token", stored);
  }
  if (stored.token.startsWith("IG") && Date.now() - stored.refreshedAt > REFRESH_AFTER_MS) {
    const response = await fetch(`${INSTAGRAM_GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(stored.token)}`).catch(() => null);
    const refreshed = response?.ok ? await response.json() as { access_token?: string } : null;
    if (refreshed?.access_token) {
      stored = { token: refreshed.access_token, refreshedAt: Date.now(), seed };
      await store.set("instagram_token", stored);
    }
  }
  return stored.token;
}

function toPost(media: InstagramMedia): PublishedPost | null {
  const imageUrl = media.media_type === "VIDEO" ? media.thumbnail_url : media.media_url;
  if (!imageUrl) return null;
  return {
    id: media.id,
    type: media.media_type === "VIDEO" ? "video" : media.media_type === "CAROUSEL_ALBUM" ? "carousel" : "image",
    imageUrl,
    permalink: media.permalink,
    timestamp: media.timestamp,
    caption: (media.caption ?? "").slice(0, 140),
  };
}

export type InstagramFeed = { connected: boolean; posts: PublishedPost[]; attempts?: { route: string; status: number; message: string }[]; error?: string };

/** Posts publicados. Usa lo guardado en D1 si tiene menos de maxAgeMs. */
export async function loadInstagramPosts(env: PlannerEnv, maxAgeMs = FEED_TTL_MS): Promise<InstagramFeed> {
  if (!env.INSTAGRAM_ACCESS_TOKEN?.trim()) return { connected: false, posts: [] };

  const store = await settings(env);
  const cached = await store.get<StoredFeed>("instagram_feed");
  if (cached && Date.now() - cached.fetchedAt < maxAgeMs) return { connected: true, posts: cached.posts };

  const token = (await currentToken(env, store)) ?? "";
  const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";
  const query = `fields=${fields}&limit=${LIMIT}&access_token=${encodeURIComponent(token)}`;
  const accountId = env.INSTAGRAM_ACCOUNT_ID?.trim() || DEFAULT_ACCOUNT_ID;

  // Según cómo se generó, el token sirve en la API de Instagram o en la de
  // Facebook. Se prueban los caminos posibles y se recuerda el que funcionó.
  const routes: Record<string, () => Promise<string | null>> = {
    instagram: async () => `${INSTAGRAM_GRAPH}/me/media?${query}`,
    facebook: async () => accountId ? `${FACEBOOK_GRAPH}/${accountId}/media?${query}` : null,
    pages: async () => {
      const pages = await fetch(`${FACEBOOK_GRAPH}/me/accounts?fields=instagram_business_account&access_token=${encodeURIComponent(token)}`).catch(() => null);
      const body = pages?.ok ? await pages.json() as { data?: { instagram_business_account?: { id: string } }[] } : null;
      const id = body?.data?.find((page) => page.instagram_business_account)?.instagram_business_account?.id;
      return id ? `${FACEBOOK_GRAPH}/${id}/media?${query}` : null;
    },
  };
  const remembered = await store.get<string>("instagram_route");
  const order = [remembered, "instagram", "facebook", "pages"].filter((name, index, list): name is string => Boolean(name && routes[name]) && list.indexOf(name) === index);
  const attempts: { route: string; status: number; message: string }[] = [];
  let response: Response | null = null;
  for (const name of order) {
    const url = await routes[name]();
    if (!url) { attempts.push({ route: name, status: 0, message: "sin cuenta de Instagram vinculada" }); continue; }
    const candidate = await fetch(url).catch(() => null);
    if (candidate?.ok) {
      response = candidate;
      if (name !== remembered) await store.set("instagram_route", name);
      break;
    }
    // Motivo que da Meta (nunca incluye el token).
    const reason = await candidate?.json().then((body: { error?: { message?: string } }) => body.error?.message ?? "").catch(() => "") ?? "";
    attempts.push({ route: name, status: candidate?.status ?? 0, message: reason });
  }
  if (!response) {
    // Diagnóstico sin datos sensibles: a quién pertenece el token y qué permisos tiene.
    const whoami = await fetch(`${FACEBOOK_GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token)}`).then((r) => r.json()).catch(() => null) as { id?: string; name?: string } | null;
    const granted = await fetch(`${FACEBOOK_GRAPH}/me/permissions?access_token=${encodeURIComponent(token)}`).then((r) => r.json()).catch(() => null) as { data?: { permission: string; status: string }[] } | null;
    attempts.push({ route: "diagnostico", status: 0, message: `usuario ${whoami?.name ?? "?"} (${whoami?.id ?? "?"}); permisos: ${(granted?.data ?? []).filter((item) => item.status === "granted").map((item) => item.permission).join(", ") || "ninguno"}` });
    // Si Instagram no responde, se muestra lo último guardado y se avisa.
    const rejected = attempts.some((attempt) => attempt.status === 400 || attempt.status === 401 || attempt.status === 403);
    return {
      connected: true,
      posts: cached?.posts ?? [],
      attempts,
      error: rejected
        ? "Instagram rechazó el token: hay que volver a autorizar la cuenta."
        : "Instagram no respondió; se muestran los últimos posts guardados.",
    };
  }
  const { data } = await response.json() as { data: InstagramMedia[] };
  const posts = data.map(toPost).filter((post): post is PublishedPost => Boolean(post));
  await store.set("instagram_feed", { fetchedAt: Date.now(), posts } satisfies StoredFeed);
  return { connected: true, posts };
}
