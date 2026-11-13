# Guía para asistentes y colaboradores

Pautas independientes de la herramienta: aplican a Claude Code, Codex, Cursor, Gemini CLI y cualquier asistente que modifique el repositorio.

## Alcance

- Sitio de KANSO Studio (kanso.ar) y su planificador de redes.
- Cambios pequeños, claros y verificables.
- No mezclar KANSO con DOOH, FA Pottery ni otros proyectos.
- No inventar clientes, servicios, precios, plazos ni testimonios.

## Convenciones técnicas

- Astro (sitio estático) + Cloudflare Pages. El planificador es una isla de React con Tailwind, que solo se carga en `/planificador-redes`.
- Contactos y links en `src/data/site.ts`; textos en `src/pages/`; estilos del sitio en `src/styles/global.css`, con colores, tipografías y espaciados en `src/styles/tokens.css`.
- Diseño web: seguir [`brand/web-system.md`](brand/web-system.md) (tokens, escala tipográfica, grilla de 8 px y de 12 columnas, fotos y CTAs).
- Funciones de Cloudflare en `functions/` (planificador, sincronización y clics de WhatsApp). Esquema de la base en `cloudflare/migrations/`.
- No guardar secretos en código, documentación ni commits. Declarar variables nuevas en `.env.example`.
- No agregar un `wrangler.toml` al repo: Pages dejaría de usar la configuración del panel.
- Ejecutar `npm run build` antes de dar un cambio por terminado. Para cambios visuales, revisar escritorio y celular.

## Redes

- Marca, voz y ejes: [`brand/skill.md`](brand/skill.md). Tandas: [`automation/TANDA_SEMANAL.md`](automation/TANDA_SEMANAL.md). Planificador: [`automation/google-sheet-sync/SETUP.md`](automation/google-sheet-sync/SETUP.md).
- El asistente prepara material para aprobación humana: no aprueba, no programa y no publica.

## Git

- No hacer commits ni push salvo pedido expreso. No reescribir historial ni borrar archivos ajenos al pedido.
