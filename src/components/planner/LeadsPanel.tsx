
import { useEffect, useMemo, useState } from "react";

// Pestaña “Consultas” del planificador: de qué canal llegan las consultas del
// sitio (clics en WhatsApp; el formulario queda listo si se suma uno). Datos de /api/planner/leads.

type Kind = "form" | "whatsapp";
type MonthRow = { month: string; channel: string; kind: Kind; total: number };
type Recent = { created_at: string; kind: Kind; channel: string; campaign: string; landing_path: string; contact_path: string };

const kindLabel: Record<Kind, string> = { form: "Formulario", whatsapp: "WhatsApp" };
const monthName = (month: string) => {
  const text = new Date(`${month}-01T12:00:00`).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const when = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function LeadsPanel() {
  const [data, setData] = useState<{ byMonth: MonthRow[]; recent: Recent[] } | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    fetch("/api/planner/leads", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudieron leer las consultas.");
        setData(body);
      })
      .catch((error: Error) => setFailed(error.message));
  }, []);

  const months = useMemo(() => {
    const grouped = new Map<string, { total: number; form: number; whatsapp: number; channels: Map<string, number> }>();
    for (const row of data?.byMonth ?? []) {
      const month = grouped.get(row.month) ?? { total: 0, form: 0, whatsapp: 0, channels: new Map() };
      month.total += row.total;
      month[row.kind] += row.total;
      month.channels.set(row.channel, (month.channels.get(row.channel) ?? 0) + row.total);
      grouped.set(row.month, month);
    }
    return Array.from(grouped.entries());
  }, [data]);

  if (failed) return <p className="mt-8 rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink/70">{failed}</p>;
  if (!data) return <p className="py-16 text-center text-sm text-ink/55">Cargando consultas…</p>;

  return (
    <section className="mt-8">
      <p className="text-[10px] font-bold uppercase tracking-[.2em] text-ink/45">Sitio web · últimos 12 meses</p>
      <h2 className="mt-1 text-2xl font-bold tracking-tightest">Consultas por canal</h2>
      <p className="mt-2 max-w-2xl text-sm text-ink/60">
        Cada clic en un botón de WhatsApp del sitio, con el canal por el que llegó la persona. No guarda datos personales:
        el detalle de cada consulta está en la conversación de WhatsApp. Instagram suele llegar como “Directo” si el link no tiene
        etiqueta: usá links con <code className="rounded bg-white px-1">utm_source</code>.
      </p>

      <details className="mt-4 max-w-3xl rounded-2xl bg-white p-5 text-sm">
        <summary className="cursor-pointer font-bold">Cómo etiquetar los links de redes</summary>
        <p className="mt-3 text-ink/70">
          Formato: <code className="break-all rounded bg-bone px-1">https://www.kanso.ar/página?utm_source=red&amp;utm_medium=ubicación&amp;utm_campaign=pieza</code>.
          En <code>utm_campaign</code> va el código de la pieza de la grilla, en minúsculas.
        </p>
        <table className="mt-3 w-full text-left">
          <thead className="text-[10px] uppercase tracking-[.14em] text-ink/45">
            <tr><th className="py-1.5 font-bold">Dónde</th><th className="font-bold">utm_source</th><th className="font-bold">utm_medium</th><th className="font-bold">utm_campaign</th></tr>
          </thead>
          <tbody className="text-ink/75">
            {[
              ["Bio de Instagram", "instagram", "bio", "bio"],
              ["Sticker de story", "instagram", "story", "código, ej. 03s"],
              ["Post de LinkedIn", "linkedin", "post", "código, ej. 03"],
              ["Newsletter", "email", "newsletter", "mes, ej. 2026-11"],
              ["Link por WhatsApp", "whatsapp", "mensaje", "tema"],
            ].map(([where, source, medium, campaign]) => (
              <tr key={where} className="border-t border-ink/10"><td className="py-1.5 pr-3">{where}</td><td className="pr-3"><code>{source}</code></td><td className="pr-3"><code>{medium}</code></td><td>{campaign}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-ink/55">En los captions de Instagram los links no se pueden tocar: el link etiquetado va en la bio o en el sticker, y el texto dice “link en la bio”. La guía completa está en automation/grid/TANDA_SEMANAL.md.</p>
      </details>

      {months.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-ink/55">Todavía no hay consultas registradas.</p>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {months.map(([month, summary]) => (
            <article key={month} className="rounded-2xl bg-white p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-bold">{monthName(month)}</h3>
                <p className="text-xs text-ink/55">
                  {summary.total} {summary.total === 1 ? "consulta" : "consultas"} · {summary.form} formulario · {summary.whatsapp} WhatsApp
                </p>
              </div>
              <ul className="mt-4 space-y-2">
                {Array.from(summary.channels.entries()).sort((a, b) => b[1] - a[1]).map(([channel, total]) => (
                  <li key={channel} className="text-sm">
                    <div className="flex justify-between"><span>{channel}</span><span className="font-bold">{total}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-ink/5">
                      <div className="h-1.5 rounded-full bg-ink" style={{ width: `${Math.max(6, (total / summary.total) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}

      {data.recent.length > 0 && (
        <div className="mt-8 overflow-x-auto rounded-2xl bg-white p-5">
          <h3 className="text-sm font-bold">Últimas consultas</h3>
          <table className="mt-3 w-full min-w-[560px] text-left text-sm">
            <thead className="text-[10px] uppercase tracking-[.14em] text-ink/45">
              <tr><th className="py-2 font-bold">Fecha</th><th className="font-bold">Tipo</th><th className="font-bold">Canal</th><th className="font-bold">Campaña</th><th className="font-bold">Entró por</th><th className="font-bold">Consultó desde</th></tr>
            </thead>
            <tbody>
              {data.recent.map((row, index) => (
                <tr key={`${row.created_at}-${index}`} className="border-t border-ink/10">
                  <td className="py-2 pr-3 text-ink/70">{when(row.created_at)}</td>
                  <td className="pr-3">{kindLabel[row.kind] ?? row.kind}</td>
                  <td className="pr-3 font-bold">{row.channel}</td>
                  <td className="pr-3 text-ink/70">{row.campaign || "—"}</td>
                  <td className="pr-3 text-ink/70">{row.landing_path || "—"}</td>
                  <td className="text-ink/70">{row.contact_path || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
