
import { LeadsPanel } from "./LeadsPanel";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Channel = "instagram" | "linkedin" | "both";
type PlannerStatus = "draft" | "review" | "changes_requested" | "approved" | "rejected" | "scheduled" | "published";
type ReviewAction = "approve" | "request_changes";

type Asset = {
  id: string;
  asset_type: "image" | "video";
  alt_text: string;
  sort_order: number;
  previewUrl: string;
};

type Item = {
  id: string;
  piece: string;
  project: string;
  title: string;
  channel: Channel;
  format: string;
  objective: string;
  caption_es: string;
  caption_en: string;
  call_to_action: string;
  creative_direction: string;
  canva_url: string | null;
  previewUrl: string;
  scheduled_at: string | null;
  status: PlannerStatus;
  publish_requested: boolean;
  published_url: string | null;
  review_notes: string;
  sort_order: number;
  assets: Asset[];
};

// Post ya publicado en Instagram, leído con la API de solo lectura.
type PublishedPost = { id: string; type: "image" | "video" | "carousel"; imageUrl: string; permalink: string; timestamp: string; caption: string };

// Para no repetir un post que ya figura en la grilla con su “URL publicada”.
function permalinkKey(url: string | null) {
  return (url ?? "").split("?")[0].replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "").toLowerCase();
}

const labels: Record<PlannerStatus, string> = {
  draft: "Borrador", review: "En revisión", changes_requested: "Cambios solicitados", approved: "Aprobado", rejected: "Descartado", scheduled: "Programado", published: "Publicado",
};

function story(item: Item) { return item.format.toLowerCase().includes("story"); }
function reel(item: Item) { return item.format.toLowerCase().includes("reel"); }
function carousel(item: Item) { return item.format.toLowerCase().includes("carrusel"); }
function vertical(item: Item) { return story(item) || reel(item); }
function day(value: string | null) {
  if (!value) return "Sin fecha asignada";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Sin fecha asignada" : new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "short" }).format(parsed);
}
function compactCopy(copy: string) { return copy.replace(/\n{2,}/g, "\n").trim(); }
function released(item: Item) { return item.status === "scheduled" || item.status === "published"; }
function time(item: Item) {
  const value = item.scheduled_at ? new Date(item.scheduled_at).getTime() : NaN;
  return Number.isNaN(value) ? null : value;
}
// Orden de cada vista: el feed de Instagram va de la más nueva a la más vieja, como en el perfil;
// stories y LinkedIn van en orden de salida. Las piezas sin fecha quedan al final.
function byDate(direction: 1 | -1) {
  return (a: Item, b: Item) => {
    const first = time(a);
    const second = time(b);
    if (first === null || second === null) return first === second ? b.sort_order - a.sort_order : first === null ? 1 : -1;
    return (first - second) * direction || b.sort_order - a.sort_order;
  };
}
// Solo se reordenan piezas con fecha que todavía no se cargaron en las redes.
function lockReason(item: Item) {
  if (item.status === "published") return "Publicada";
  if (item.status === "scheduled") return "Programada";
  if (item.status === "rejected") return "Descartada";
  if (time(item) === null) return "Sin fecha";
  return "";
}
function movable(item: Item) { return !lockReason(item); }
// Lo que necesita una pieza para salir: el mismo criterio que la regla de publicación de la grilla.
function readiness(item: Item) {
  return [
    { label: "Copy", done: Boolean(item.caption_es.trim()) && !item.caption_es.includes("[REVISAR]") },
    { label: "Gráfica", done: item.assets.length > 0 || Boolean(item.previewUrl) },
    { label: "Fecha", done: Boolean(item.scheduled_at) },
    { label: "Aprobada", done: item.status === "approved" || released(item) },
    { label: "Programar", done: item.publish_requested || released(item) },
  ];
}
function readinessSummary(item: Item) {
  if (item.status === "published") return "Publicada";
  if (item.status === "scheduled") return "Programada";
  if (item.status === "rejected") return "Rechazada";
  const missing = readiness(item).filter((check) => !check.done).map((check) => check.label.toLowerCase());
  return missing.length ? `Falta: ${missing.join(", ")}` : "Lista para salir";
}

function Status({ status }: { status: PlannerStatus }) {
  const color = status === "approved" ? "bg-sand text-ink" : status === "scheduled" || status === "published" ? "bg-ink text-white" : status === "changes_requested" ? "border border-ink/40 text-ink" : "bg-ink/10 text-ink/55";
  return <span className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.13em] ${color}`}>{labels[status]}</span>;
}

function Readiness({ item }: { item: Item }) {
  return <ul className="flex flex-wrap gap-2">{readiness(item).map((check) => <li key={check.label} className={`rounded-full px-3 py-1.5 text-xs font-bold ${check.done ? "bg-sand text-ink" : "border border-dashed border-ink/30 text-ink/55"}`}>{check.done ? "✓" : "○"} {check.label}</li>)}</ul>;
}

function ReviewPanel({ item, onReview }: { item: Item; onReview: (action: ReviewAction, comment: string) => Promise<string | null> }) {
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState<ReviewAction | null>(null);
  const [error, setError] = useState("");

  async function send(action: ReviewAction) {
    setSending(action);
    setError("");
    const failure = await onReview(action, comment.trim());
    setSending(null);
    if (failure) setError(failure);
  }

  return <div className="rounded-2xl border border-ink/10 bg-[#f7f8f8] p-4">
    {asking
      ? <form onSubmit={(event) => { event.preventDefault(); void send("request_changes"); }}>
          <label className="block text-xs font-bold">¿Qué hay que cambiar?<textarea required autoFocus value={comment} onChange={(event) => setComment(event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-ink/20 bg-white px-4 py-3 text-sm font-normal outline-none focus:border-ink" placeholder="Por ejemplo: acortar el título de la placa 2 y usar otra foto." /></label>
          <div className="mt-3 flex flex-wrap gap-2"><button disabled={sending !== null || !comment.trim()} className="rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{sending ? "Enviando…" : "Enviar pedido"}</button><button type="button" onClick={() => { setAsking(false); setError(""); }} className="rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-bold">Cancelar</button></div>
        </form>
      : <div className="flex flex-wrap items-center gap-2">
          {item.status !== "approved" && <button type="button" disabled={sending !== null} onClick={() => void send("approve")} className="rounded-full bg-sand px-5 py-2.5 text-sm font-bold text-ink disabled:opacity-50">{sending === "approve" ? "Aprobando…" : "Aprobar"}</button>}
          <button type="button" disabled={sending !== null} onClick={() => setAsking(true)} className="rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-bold disabled:opacity-50">Pedir cambios</button>
          <p className="text-xs text-ink/55">{item.status === "approved" ? "Ya está aprobada. Si algo cambió, pedí cambios para volver a revisarla." : "Se guarda en la grilla con tu email y la fecha."}</p>
        </div>}
    {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
  </div>;
}

type View = "stories" | "instagram" | "linkedin";
type Ordering = { view: View; original: string[]; order: string[] };
// Cada posición de la vista conserva su fecha: al reordenar, la pieza toma la fecha del lugar
// donde se suelta (`slot`), y la pieza que estaba ahí pasa al lugar siguiente.
type Placement = { item: Item; slot: Item; draggable: boolean };

// Definido fuera del componente principal para que el arrastre no se reinicie en cada render.
function SortableTile({ id, className = "", children }: { id: string; className?: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  // Las imágenes y videos no reciben el puntero: si no, el navegador arranca su propio
  // "arrastrar imagen" y la pieza no se mueve.
  return <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} onDragStart={(event) => event.preventDefault()} className={`${className} relative cursor-grab touch-manipulation select-none active:cursor-grabbing [&_img]:pointer-events-none [&_video]:pointer-events-none ${isDragging ? "z-20 opacity-80 shadow-2xl ring-4 ring-sand" : ""}`} {...attributes} {...listeners}>{children}</div>;
}

export default function PlanificadorRedes() {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [tab, setTab] = useState<"instagram" | "linkedin" | "consultas">("instagram");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewerEmail, setViewerEmail] = useState("");
  const [published, setPublished] = useState<PublishedPost[]>([]);
  const [instagramNotice, setInstagramNotice] = useState("");

  // Cloudflare Access protege la página y la API: la sesión viaja en su cookie.
  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/planner/items", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      setNotice(response?.status === 401 ? "Tu sesión venció. Recargá la página para volver a ingresar." : "No fue posible leer el planificador. Probá de nuevo en unos minutos.");
      setLoading(false);
      return;
    }
    const result = await response.json() as { viewer: string; items: Item[] };
    setViewerEmail(result.viewer);
    setItems(result.items);
    setSelected((current) => current ? result.items.find((item) => item.id === current.id) ?? null : null);
    setNotice(result.items.length ? "" : "Todavía no hay piezas sincronizadas desde la grilla.");
    setLoading(false);
    // Los posts publicados completan el feed; si fallan, el planificador sigue funcionando.
    const instagram = await fetch("/api/planner/instagram", { cache: "no-store" }).catch(() => null);
    const feed = instagram?.ok ? await instagram.json().catch(() => null) as { connected: boolean; posts: PublishedPost[]; error?: string } | null : null;
    setPublished(feed?.posts ?? []);
    setInstagramNotice(!feed ? "No fue posible leer los posts publicados de Instagram." : !feed.connected ? "Los posts ya publicados aparecen acá cuando se conecta Instagram (ver SETUP del planificador)." : feed.error ?? "");
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Devuelve un mensaje de error, o null si la decisión quedó guardada en la grilla.
  async function review(item: Item, action: ReviewAction, comment: string) {
    try {
      const response = await fetch("/api/planner/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: item.id, action, comment }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!result.ok) return result.error ?? "No fue posible guardar la decisión.";
    } catch {
      return "No fue posible conectar con la grilla. Probá de nuevo.";
    }
    await load();
    return null;
  }

  // Stories y LinkedIn ya publicados pasan al archivo (se ven con “Ver publicadas”).
  // El feed de Instagram los mantiene: es el perfil como queda.
  const [showArchive, setShowArchive] = useState<Record<"stories" | "linkedin", boolean>>({ stories: false, linkedin: false });
  const allStories = useMemo(() => items.filter(story).sort(byDate(1)), [items]);
  const instagram = useMemo(() => items.filter((item) => !story(item) && item.channel !== "linkedin").sort(byDate(-1)), [items]);
  const allLinkedin = useMemo(() => items.filter((item) => !story(item) && item.channel !== "instagram").sort(byDate(1)), [items]);
  const archived = { stories: allStories.filter((item) => item.status === "published").length, linkedin: allLinkedin.filter((item) => item.status === "published").length };
  const stories = showArchive.stories ? allStories : allStories.filter((item) => item.status !== "published");
  const linkedin = showArchive.linkedin ? allLinkedin : allLinkedin.filter((item) => item.status !== "published");
  const lists: Record<View, Item[]> = { stories, instagram, linkedin };

  const [ordering, setOrdering] = useState<Ordering | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderError, setOrderError] = useState("");
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // En el celular hay que mantener apretado un instante para arrastrar; si no, la página se desplaza.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function startOrdering(view: View) {
    const ids = lists[view].filter(movable).map((item) => item.id);
    setOrdering({ view, original: ids, order: ids });
    setOrderError("");
    setSelected(null);
  }
  function cancelOrdering() {
    setOrdering(null);
    setOrderError("");
  }
  function placements(view: View): Placement[] {
    const list = lists[view];
    if (ordering?.view !== view) return list.map((item) => ({ item, slot: item, draggable: false }));
    const byId = new Map(list.map((item) => [item.id, item]));
    let position = 0;
    return list.map((slot) => {
      if (!movable(slot)) return { item: slot, slot, draggable: false };
      const item = byId.get(ordering.order[position]) ?? slot;
      position += 1;
      return { item, slot, draggable: true };
    });
  }
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    setOrdering((current) => {
      if (!current) return current;
      const from = current.order.indexOf(String(active.id));
      const to = current.order.indexOf(String(over.id));
      return from === -1 || to === -1 ? current : { ...current, order: arrayMove(current.order, from, to) };
    });
  }
  const orderChanged = Boolean(ordering && ordering.order.some((id, index) => id !== ordering.original[index]));

  // Cada pieza movida toma la fecha de la que estaba en ese lugar. La grilla también corre
  // la story y la adaptación de LinkedIn asociadas (`Pieza relacionada`).
  async function saveOrder() {
    if (!ordering || !orderChanged) return;
    const moves = ordering.order
      .map((id, index) => ({ item_id: id, from_item_id: ordering.original[index] }))
      .filter((move) => move.item_id !== move.from_item_id);
    setSavingOrder(true);
    setOrderError("");
    try {
      const response = await fetch("/api/planner/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moves }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; moved?: number; followed?: number };
      if (!result.ok) {
        setOrderError(result.error ?? "No fue posible guardar el orden.");
        setSavingOrder(false);
        return;
      }
      setOrdering(null);
      setSavingOrder(false);
      await load();
      const followed = result.followed ? ` y ${result.followed} ${result.followed === 1 ? "pieza asociada" : "piezas asociadas"}` : "";
      setNotice(`Orden guardado en la grilla: ${result.moved ?? moves.length} ${moves.length === 1 ? "pieza" : "piezas"}${followed} con fecha nueva.`);
    } catch {
      setOrderError("No fue posible conectar con la grilla. Probá de nuevo.");
      setSavingOrder(false);
    }
  }

  function Media({ asset, alt, poster = "", controls = true, contain = false, cover = false }: { asset: Asset; alt: string; poster?: string; controls?: boolean; contain?: boolean; cover?: boolean }) {
    if (!asset.previewUrl) return <div className="flex h-full w-full items-center justify-center bg-[#e9ecee] p-4 text-center text-xs text-ink/50">Vista previa no disponible.</div>;
    return asset.asset_type === "video" ? <VideoPreview source={asset.previewUrl} poster={poster} controls={controls} cover={cover} /> : <img src={asset.previewUrl} alt={alt} className={`h-full w-full ${contain ? "object-contain" : "object-cover"}`} />;
  }
  function VideoPreview({ source, poster = "", controls = true, cover = false }: { source: string; poster?: string; controls?: boolean; cover?: boolean }) {
    const video = useRef<HTMLVideoElement>(null);
    const previewFrameSet = useRef(false);
    function showPreviewFrame() {
      const element = video.current;
      if (!element || previewFrameSet.current || element.currentTime > 0 || !Number.isFinite(element.duration) || element.duration <= 0) return;
      // Evita la pantalla negra habitual del primer fotograma sin iniciar la reproducción.
      previewFrameSet.current = true;
      element.currentTime = Math.min(1, Math.max(0.15, element.duration * 0.1));
    }
    return <video ref={video} controls={controls} playsInline muted preload="metadata" className={`h-full w-full bg-black ${cover ? "object-cover" : "object-contain"}`} src={source} poster={poster || undefined} onLoadedMetadata={showPreviewFrame} onCanPlay={showPreviewFrame} />;
  }
  function Preview({ item, controls = false, cover = false }: { item: Item; controls?: boolean; cover?: boolean }) {
    const asset = item.assets[0];
    // Una portada no reemplaza al video: se usa como poster para conservar el play.
    if (asset?.asset_type === "video") return <Media asset={asset} alt={`Vista previa de ${item.project}`} poster={item.previewUrl} controls={controls} cover={cover} />;
    if (item.previewUrl) return <img src={item.previewUrl} alt={`Vista previa de ${item.project}`} className="h-full w-full object-cover" />;
    if (asset) return <Media asset={asset} alt={`Vista previa de ${item.project}`} controls={controls} />;
    return <div className="flex h-full w-full flex-col justify-between bg-[#e9ecee] p-5 text-ink/55"><span className="text-[10px] font-bold uppercase tracking-[.16em]">Sin asset</span><p className="text-base leading-tight">{item.title}</p></div>;
  }
  function CollectionPreview({ item, controls = false }: { item: Item; controls?: boolean }) {
    const assets = item.assets;
    if (!carousel(item) || assets.length < 2) return <Preview item={item} controls={controls} />;
    const visibleAssets = assets.slice(0, 4);
    return <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px bg-white/20">{visibleAssets.map((asset, index) => <div key={asset.id} className="relative min-h-0 overflow-hidden bg-[#242426]"><Media asset={asset} alt={`${item.project} · pieza ${index + 1}`} controls={false} />{index === 3 && assets.length > 4 && <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-lg font-bold text-white">+{assets.length - 4}</span>}</div>)}</div>;
  }
  // En modo ordenar, la tarjeta no abre el detalle y muestra la fecha del lugar que ocupa.
  function Opener({ item, className, children }: { item: Item; className: string; children: ReactNode }) {
    if (ordering) return <div className={className}>{children}</div>;
    return <button type="button" onClick={() => setSelected(item)} className={`${className} focus:outline-none focus:ring-4 focus:ring-sand`}>{children}</button>;
  }
  function Lock({ item }: { item: Item }) {
    if (!ordering) return null;
    const reason = lockReason(item);
    return reason ? <span className="absolute left-2 top-2 z-10 rounded-full bg-ink/80 px-2.5 py-1 text-[10px] font-bold text-white">🔒 {reason}</span> : <span className="absolute left-2 top-2 z-10 rounded-full bg-sand px-2.5 py-1 text-[10px] font-bold text-ink">↕ Arrastrar</span>;
  }
  // Post que ya está en el perfil: abre la publicación en Instagram.
  function PublishedCard({ post }: { post: PublishedPost }) {
    const icon = post.type === "video" ? "M4 4h16v16H4z M10 9l5 3-5 3z" : post.type === "carousel" ? "M8 8h12v12H8z M4 16V4h12" : "";
    return <a href={post.permalink} target="_blank" rel="noreferrer" className={`group relative block aspect-[3/4] overflow-hidden bg-[#242426] ${ordering ? "pointer-events-none opacity-40" : ""}`}><img src={post.imageUrl} alt={post.caption || "Post publicado en Instagram"} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />{icon && <svg viewBox="0 0 24 24" aria-hidden="true" className="absolute right-2 top-2 h-5 w-5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.6)]"><path d={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>}<span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-8 text-[9px] font-bold uppercase tracking-[.12em] text-white opacity-0 transition-opacity group-hover:opacity-100 sm:px-4 sm:pb-3 sm:text-[10px]">Publicado · {day(post.timestamp)}</span></a>;
  }
  // Ícono de tipo arriba a la derecha, como en la grilla de Instagram.
  function FeedIcon({ item }: { item: Item }) {
    if (ordering) return null;
    const icon = reel(item)
      ? <path d="M4 4h16v16H4z M10 9l5 3-5 3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      : carousel(item) || item.assets.length > 1 ? <path d="M8 8h12v12H8z M4 16V4h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /> : null;
    return icon ? <svg viewBox="0 0 24 24" aria-hidden="true" className="absolute right-2 top-2 z-10 h-5 w-5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.6)]">{icon}</svg> : null;
  }
  function Card({ item, when }: { item: Item; when: string | null }) {
    // Como el perfil de Instagram: todas las celdas miden 3:4 y recortan al centro, sea post, carrusel o reel.
    return <Opener item={item} className={`group block h-full w-full overflow-hidden bg-[#e9ecee] text-left ${ordering && lockReason(item) ? "opacity-60" : ""}`}><div className="relative aspect-[3/4]"><Lock item={item} /><Preview item={item} cover /><FeedIcon item={item} /><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-8 text-white sm:px-4 sm:pb-3 sm:pt-10"><p className="truncate text-[9px] font-bold uppercase tracking-[.12em] sm:text-[10px]">{item.piece ? `${item.piece} · ` : ""}{item.project}</p><p className="mt-0.5 hidden text-[9px] text-white/70 sm:block">{carousel(item) ? `${item.assets.length} piezas · ` : ""}{day(when)}{ordering ? "" : " · Ver propuesta"}</p><p className="mt-1 hidden text-[9px] font-bold text-sand sm:block">{readinessSummary(item)}</p></div></div></Opener>;
  }
  function StoryCard({ item, when }: { item: Item; when: string | null }) {
    return <article className={`w-[11.5rem] shrink-0 overflow-hidden rounded-2xl border border-ink/10 bg-white ${ordering && lockReason(item) ? "opacity-60" : ""}`}><div className="relative aspect-[9/16] bg-[#e9ecee]"><Lock item={item} /><Preview item={item} controls={!ordering} /></div><Opener item={item} className="block w-full p-3 text-left"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-ink/45">Story IG{item.piece ? ` · ${item.piece}` : ""}</p><p className="mt-2 text-sm font-bold">{item.project}</p><p className="mt-1 text-xs text-ink/55">{day(when)}{ordering ? "" : " · Ver detalle"}</p><p className="mt-2 text-[11px] font-bold text-ink/70">{readinessSummary(item)}</p></Opener></article>;
  }
  function LinkedInCard({ item, when }: { item: Item; when: string | null }) {
    return <Opener item={item} className={`block h-full w-full overflow-hidden rounded-2xl border border-ink/10 bg-white text-left ${ordering && lockReason(item) ? "opacity-60" : ""}`}><div className={`relative ${vertical(item) ? "aspect-[9/16]" : "aspect-square"} bg-[#e9ecee]`}><Lock item={item} /><CollectionPreview item={item} /></div><div className="p-4"><div className="flex items-start justify-between gap-3"><p className="text-sm font-bold">{item.piece ? `${item.piece} · ` : ""}{item.project}</p><Status status={item.status} /></div><p className="mt-2 text-xs text-ink/55">{carousel(item) ? `${item.assets.length} piezas · ` : ""}{day(when)}{ordering ? "" : " · Ver propuesta"}</p><p className="mt-2 text-[11px] font-bold text-ink/70">{readinessSummary(item)}</p></div></Opener>;
  }
  // Envuelve cada vista: en modo ordenar, las piezas movibles se arrastran; las bloqueadas quedan fijas.
  function Arrangeable({ view, className, strategy, empty, render, after }: { view: View; className: string; strategy: "grid" | "row"; empty?: ReactNode; render: (item: Item, when: string | null) => ReactNode; after?: ReactNode }) {
    const placed = placements(view);
    const tiles = placed.map(({ item, slot, draggable }) => draggable
      ? <SortableTile key={item.id} id={item.id} className={strategy === "row" ? "shrink-0" : ""}>{render(item, slot.scheduled_at)}</SortableTile>
      : <div key={item.id} className={strategy === "row" ? "shrink-0" : ""}>{render(item, item.scheduled_at)}</div>);
    const content = <div className={className}>{tiles}{placed.length === 0 && !after && empty}{after}</div>;
    if (ordering?.view !== view) return content;
    return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={ordering.order} strategy={strategy === "row" ? horizontalListSortingStrategy : rectSortingStrategy}>{content}</SortableContext></DndContext>;
  }
  function ArchiveButton({ view }: { view: "stories" | "linkedin" }) {
    if (!archived[view] || ordering) return null;
    return <button type="button" onClick={() => setShowArchive((current) => ({ ...current, [view]: !current[view] }))} className="rounded-full border border-ink/15 bg-white px-4 py-2 text-xs font-bold hover:bg-sand">{showArchive[view] ? "Ocultar publicadas" : `Ver publicadas (${archived[view]})`}</button>;
  }
  // Botón para entrar al modo ordenar y barra para guardar o cancelar.
  function OrderButton({ view }: { view: View }) {
    if (ordering || lists[view].filter(movable).length < 2) return null;
    return <button type="button" onClick={() => startOrdering(view)} className="rounded-full border border-ink/15 bg-white px-4 py-2 text-xs font-bold hover:bg-sand">Ordenar</button>;
  }
  function OrderBar({ view }: { view: View }) {
    if (ordering?.view === view) {
      return <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-ink/15 bg-white p-3 pl-4"><p className="mr-auto text-xs text-ink/70">Arrastrá las piezas al lugar donde querés que salgan. Cada una toma la fecha de ese lugar; las de 🔒 quedan fijas.{view !== "linkedin" && view !== "stories" ? " La story y la adaptación de LinkedIn de cada pieza se corren con ella." : ""}</p><button type="button" disabled={savingOrder || !orderChanged} onClick={() => void saveOrder()} className="rounded-full bg-sand px-5 py-2.5 text-sm font-bold text-ink disabled:opacity-50">{savingOrder ? "Guardando en la grilla…" : "Guardar orden"}</button><button type="button" disabled={savingOrder} onClick={cancelOrdering} className="rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-bold disabled:opacity-50">Cancelar</button>{orderError && <p className="w-full text-sm text-red-700">{orderError}</p>}</div>;
    }
    return null;
  }
  function Detail({ item }: { item: Item }) {
    const media = item.assets;
    const previewAspect = vertical(item) ? "aspect-[9/16] w-[min(58vw,16rem)]" : "aspect-square w-[min(58vw,20rem)]";
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true"><article className="planner-modal-scroll relative h-[calc(100dvh-2rem)] w-full max-w-5xl overflow-y-scroll overscroll-contain rounded-3xl bg-white p-6 pr-4 shadow-2xl md:p-10 md:pr-8"><button type="button" onClick={() => setSelected(null)} className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-ink/15 text-xl hover:bg-sand" aria-label="Cerrar">×</button><div className="pr-12"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-ink/45">{item.format}</p><div className="mt-3 flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-2xl font-bold tracking-tightest md:text-4xl">{item.project} — {item.title}</h2><p className="mt-2 text-sm text-ink/55">Salida propuesta: {day(item.scheduled_at)}</p></div><Status status={item.status} /></div></div><section className="mt-7"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-ink/45">Para salir</p><div className="mt-3"><Readiness item={item} /></div>{item.status === "published" && item.published_url && <a href={item.published_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-bold underline">Ver publicación</a>}{!released(item) && <div className="mt-4"><ReviewPanel key={item.id} item={item} onReview={(action, comment) => review(item, action, comment)} /></div>}</section><section className="mt-7"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-ink/45">Piezas de la publicación</p><p className="text-xs text-ink/55">{media.length ? `${media.length} ${media.length === 1 ? "pieza" : "piezas"}` : "Sin piezas"}</p></div>{media.length > 0 && <div className="mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-2xl bg-ink p-2 pb-4">{media.map((asset, index) => <div key={asset.id} className={`shrink-0 snap-start overflow-hidden rounded-xl bg-black ${previewAspect}`}><Media asset={asset} alt={`${item.project} · pieza ${index + 1}`} poster={index === 0 ? item.previewUrl : ""} contain /></div>)}</div>}<p className="mt-3 text-xs text-ink/55">Deslizá horizontalmente para revisar todas las piezas y hacia abajo para ver el contenido de la publicación.</p></section><section className="mt-7 border-t border-ink/10 pt-6"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-ink/45">Información de la grilla</p><p className="mt-2 text-sm text-ink/60">Los textos se editan en la grilla semanal; la aprobación y los pedidos de cambio se guardan ahí automáticamente.</p>{item.canva_url && <a href={item.canva_url} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-full border border-ink/15 px-4 py-2 text-xs font-bold hover:bg-sand">Abrir diseño en Canva</a>}<div className="mt-5 grid gap-4 md:grid-cols-2"><div><p className="text-xs font-bold">Estado</p><p className="mt-1 text-sm text-ink/70">{labels[item.status]}</p></div><div><p className="text-xs font-bold">Call to action</p><p className="mt-1 text-sm text-ink/70">{item.call_to_action || "Sin definir"}</p></div><div className="md:col-span-2"><p className="text-xs font-bold">Copy ES</p><p className="mt-1 whitespace-pre-line text-sm leading-snug text-ink/70">{compactCopy(item.caption_es) || "Sin definir"}</p></div>{item.caption_en.trim() && <div className="md:col-span-2"><p className="text-xs font-bold">Copy EN</p><p className="mt-1 whitespace-pre-line text-sm leading-snug text-ink/70">{compactCopy(item.caption_en)}</p></div>}{item.review_notes && <div className="md:col-span-2"><p className="text-xs font-bold">Historial de revisión</p><p className="mt-1 whitespace-pre-line text-sm leading-snug text-ink/70">{item.review_notes}</p></div>}<div className="md:col-span-2"><p className="text-xs font-bold">Dirección visual</p><p className="mt-1 whitespace-pre-line text-sm leading-snug text-ink/70">{compactCopy(item.creative_direction) || "Sin definir"}</p></div></div></section></article></div>;
  }

  const tabButton = (value: "instagram" | "linkedin" | "consultas", label: string) => <button role="tab" aria-selected={tab === value} disabled={Boolean(ordering) && tab !== value} onClick={() => setTab(value)} className={`rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-40 ${tab === value ? "bg-ink text-white" : "text-ink/55"}`}>{label}</button>;
  const plannedLinks = new Set(items.map((item) => permalinkKey(item.published_url)).filter(Boolean));
  const publishedPosts = published.filter((post) => !plannedLinks.has(permalinkKey(post.permalink)));
  const publishedTiles = publishedPosts.length ? publishedPosts.map((post) => <PublishedCard key={post.id} post={post} />) : null;
  return <main className="min-h-screen bg-bone px-5 py-8 font-sans text-ink md:px-10 md:py-12"><div className="mx-auto max-w-6xl"><header className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-ink/45">KANSO · Interno</p><h1 className="mt-1 text-2xl font-bold tracking-tightest">Planificador de redes</h1>{viewerEmail && <p className="mt-1 text-xs text-ink/55">Sesión: {viewerEmail}</p>}</div><div className="flex gap-2"><button type="button" disabled={Boolean(ordering)} onClick={() => void load()} className="rounded-full border border-ink/15 bg-white px-4 py-2 text-xs font-bold disabled:opacity-40">Actualizar</button><a href="/cdn-cgi/access/logout" className="rounded-full border border-ink/15 bg-white px-4 py-2 text-xs font-bold">Salir</a></div></header>{notice && <p className="mb-5 rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink/70">{notice}</p>}{loading ? <p className="py-16 text-center text-sm text-ink/55">Cargando planificador…</p> : <><div className="inline-flex rounded-full border border-ink/15 bg-white p-1" role="tablist">{tabButton("instagram", "Instagram")}{allLinkedin.length > 0 && tabButton("linkedin", "LinkedIn")}{tabButton("consultas", "Consultas")}</div>{tab === "consultas" ? <LeadsPanel /> : tab === "instagram" ? <section className="mt-8"><div className="flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-ink/45">Secuencia +24 h</p><h2 className="mt-1 text-2xl font-bold tracking-tightest">Stories</h2></div><div className="flex items-center gap-3"><p className="text-xs text-ink/55">Desde la grilla sincronizada.</p><ArchiveButton view="stories" /><OrderButton view="stories" /></div></div><OrderBar view="stories" /><Arrangeable view="stories" strategy="row" className="mt-4 flex gap-4 overflow-x-auto pb-5" empty={<p className="py-6 text-sm text-ink/55">No hay stories pendientes.</p>} render={(item, when) => <StoryCard item={item} when={when} />} /><div className="mt-8 flex items-center justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-ink/45">Preview visual</p><h2 className="mt-1 text-2xl font-bold tracking-tightest">Instagram feed</h2></div><div className="flex items-center gap-3"><OrderButton view="instagram" /><span className="rounded-full border border-ink/15 px-3 py-1.5 text-xs text-ink/60">@kanso.ar</span></div></div><OrderBar view="instagram" /><div className="mt-4 overflow-hidden rounded-[2rem] border-[10px] border-ink bg-ink shadow-[0_22px_70px_rgba(5,5,7,.2)]"><div className="flex items-center gap-2 border-b border-white/10 px-5 py-4"><img src="/favicon.svg" alt="" className="h-7 w-7 rounded-full bg-white p-1" /><span className="text-xs font-bold text-white">kanso.ar</span></div><Arrangeable view="instagram" strategy="grid" className="grid grid-cols-3 gap-0.5 bg-ink" empty={<div className="col-span-full p-10 text-center text-sm text-white/70">No hay piezas de Instagram en la grilla.</div>} render={(item, when) => <Card item={item} when={when} />} after={publishedTiles} /></div>{instagramNotice && <p className="mt-3 text-xs text-ink/55">{instagramNotice}</p>}</section> : <section className="mt-8"><div className="flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-ink/45">Cola editorial</p><h2 className="mt-1 text-2xl font-bold tracking-tightest">LinkedIn</h2></div><div className="flex items-center gap-3"><ArchiveButton view="linkedin" /><OrderButton view="linkedin" /></div></div><OrderBar view="linkedin" /><Arrangeable view="linkedin" strategy="grid" className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" empty={<p className="col-span-full py-6 text-sm text-ink/55">No hay posts de LinkedIn pendientes.</p>} render={(item, when) => <LinkedInCard item={item} when={when} />} /></section>}</>}</div>{selected && <Detail item={selected} />}</main>;
}
