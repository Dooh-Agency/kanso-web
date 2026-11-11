// Código compartido por las Pages Functions del planificador de redes.
// No exporta handlers, así que Pages no lo publica como ruta.

// Tipos mínimos de D1 y R2: el proyecto no instala @cloudflare/workers-types.
export interface D1Result<T> { results: T[] }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}
export interface R2ObjectBody {
  body: ReadableStream;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}
export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

export interface PlannerEnv {
  PLANNER_DB: D1Database;
  PLANNER_BUCKET: R2Bucket;
  // Equipo de Cloudflare Access (por ejemplo, kanso.cloudflareaccess.com) y AUD de la aplicación.
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  // Clave compartida con Apps Script, en los dos sentidos.
  PLANNER_SYNC_SECRET?: string;
  // Aplicación web de Apps Script que escribe aprobaciones en la grilla.
  PLANNER_ACTIONS_URL?: string;
  // Token de la API de Instagram (solo lectura) para mostrar los posts publicados.
  INSTAGRAM_ACCESS_TOKEN?: string;
  // ID de la cuenta de Instagram en Meta, para tokens de usuario del sistema (opcional).
  INSTAGRAM_ACCOUNT_ID?: string;
  // Solo para `wrangler pages dev`: email con el que se simula la sesión de Access.
  PLANNER_DEV_EMAIL?: string;
}

export type PlannerContext = { request: Request; env: PlannerEnv; params: Record<string, string | string[]> };

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function error(message: string, status: number) {
  return json({ ok: false, error: message }, status);
}

// Comparación en tiempo constante para la clave de sincronización.
// Clave compartida sin espacios ni saltos de línea: al pegarla en el panel de
// Cloudflare puede quedar con el salto de línea final de `openssl rand`.
export function syncSecret(env: Pick<PlannerEnv, "PLANNER_SYNC_SECRET">) {
  return env.PLANNER_SYNC_SECRET?.trim() || undefined;
}

export function sameSecret(received: string | null, expected: string | undefined) {
  received = received?.trim() ?? null;
  expected = expected?.trim();
  if (!received || !expected || received.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) diff |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  return diff === 0;
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

type AccessKey = JsonWebKey & { kid: string };
let cachedKeys: { domain: string; keys: AccessKey[]; expires: number } | null = null;

async function accessKeys(domain: string, refresh = false) {
  if (!refresh && cachedKeys && cachedKeys.domain === domain && cachedKeys.expires > Date.now()) return cachedKeys.keys;
  const response = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("No se pudieron leer las claves de Cloudflare Access.");
  const { keys } = await response.json() as { keys: AccessKey[] };
  cachedKeys = { domain, keys, expires: Date.now() + 60 * 60 * 1000 };
  return keys;
}

/**
 * Devuelve el email validado por Cloudflare Access o null. Access ya bloquea a
 * quien no está en la política; esto verifica además la firma del token para
 * que nadie pueda llamar a la función salteando Access.
 */
export async function accessEmail(request: Request, env: PlannerEnv) {
  if (env.PLANNER_DEV_EMAIL) return env.PLANNER_DEV_EMAIL.toLowerCase();
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart))) as { kid?: string; alg?: string };
    // Cloudflare rota las claves de firma: si el token usa una que no está en
    // memoria, se vuelven a leer antes de rechazar la sesión.
    let key = (await accessKeys(env.ACCESS_TEAM_DOMAIN)).find((candidate) => candidate.kid === header.kid);
    if (!key) key = (await accessKeys(env.ACCESS_TEAM_DOMAIN, true)).find((candidate) => candidate.kid === header.kid);
    if (!key || header.alg !== "RS256") return null;

    const cryptoKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      base64UrlDecode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart))) as { aud?: string | string[]; exp?: number; iss?: string; email?: string };
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(env.ACCESS_AUD)) return null;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    return payload.email ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function assetUrl(key: string) {
  return `/api/planner/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}
