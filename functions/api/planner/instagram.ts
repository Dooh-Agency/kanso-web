import { accessEmail, error, json, type PlannerContext } from "../../_shared/planner";
import { loadInstagramPosts } from "../../_shared/instagram";

// Últimos posts publicados en @kanso.ar, para completar el feed del planificador.
export async function onRequestGet({ request, env }: PlannerContext) {
  const email = await accessEmail(request, env);
  if (!email) return error("Ingresá al planificador con un email habilitado del equipo.", 401);
  return json(await loadInstagramPosts(env));
}
