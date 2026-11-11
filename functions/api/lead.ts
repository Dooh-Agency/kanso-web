import type { D1Database } from "../_shared/planner";
import { readOrigin, recordLead } from "../_shared/leads";

interface Env {
  ALLOWED_CONTACT_ORIGIN?: string;
  PLANNER_DB?: D1Database;
}

// Registra un clic en el botón de WhatsApp con el origen de la visita.
// Lo llama navigator.sendBeacon desde components/LeadSource.tsx; no recibe datos personales.
export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const origin = request.headers.get("Origin");
  if (env.ALLOWED_CONTACT_ORIGIN && origin !== env.ALLOWED_CONTACT_ORIGIN) {
    return new Response(null, { status: 403 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.kind !== "whatsapp") return new Response(null, { status: 400 });
    await recordLead(env.PLANNER_DB, "whatsapp", readOrigin((name) => body[name]));
  } catch (error) {
    console.error(`No se pudo registrar el clic de WhatsApp: ${String(error).slice(0, 200)}`);
  }
  return new Response(null, { status: 204 });
}
