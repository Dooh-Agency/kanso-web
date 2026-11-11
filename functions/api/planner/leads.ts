import { accessEmail, error, json, type PlannerContext } from "../../_shared/planner";
import { leadSummary } from "../../_shared/leads";

// Consultas del sitio por canal y mes, para la pestaña “Consultas” del planificador.
export async function onRequestGet({ request, env }: PlannerContext) {
  const email = await accessEmail(request, env);
  if (!email) return error("Ingresá al planificador con un email habilitado del equipo.", 401);
  return json(await leadSummary(env.PLANNER_DB));
}
