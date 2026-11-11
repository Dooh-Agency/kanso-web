# KANSO Studio · sitio web

Sitio de [kanso.ar](https://www.kanso.ar) migrado desde Wix a **Astro** (sitio estático) y publicado gratis en **Cloudflare Pages**, con el **planificador de redes** de KANSO en `/planificador-redes`.

## Estructura

```
src/
  data/site.ts        ← teléfonos, mail, links (editar acá)
  pages/              ← una página por archivo: index, servicios, bio, eventosprivados
  components/         ← Header, Footer, botón de WhatsApp
  layouts/Base.astro  ← <head>, SEO, Open Graph
  styles/global.css   ← colores, tipografías, estilos comunes
  assets/img/         ← fotos (Astro las optimiza a WebP al compilar)
  assets/logos/       ← logo, isotipo y logos de clientes (SVG)
  components/planner/ ← panel del planificador de redes (React + Tailwind)
public/               ← favicon, robots.txt, _headers y _redirects de Cloudflare
functions/            ← Cloudflare Pages Functions: planificador, sincronización y clics de WhatsApp
cloudflare/migrations ← esquema de la base D1
automation/           ← Apps Script de la grilla, guía de setup y de tandas semanales
brand/                ← marca, voz, ejes editoriales, templates de Canva y logos
inputs/ grid/ logs/   ← material, tandas y registros de redes
```

## Planificador de redes

Mismo sistema que usa DOOH, aplicado a KANSO: la grilla de Google Sheets es la fuente de verdad; Apps Script sincroniza cada pieza (copy + gráficas de Drive) a Cloudflare (D1 + R2) y el panel `/planificador-redes`, protegido con Cloudflare Access, muestra el feed y las stories como se verán en Instagram. Desde ahí se aprueba, se piden cambios y se ordena la salida; todo se escribe en la grilla. La pestaña **Consultas** cuenta los clics en WhatsApp del sitio por canal de origen (UTM), sin datos personales.

- Setup (una vez): [`automation/google-sheet-sync/SETUP.md`](automation/google-sheet-sync/SETUP.md)
- Armar una tanda: [`automation/TANDA_SEMANAL.md`](automation/TANDA_SEMANAL.md)
- Marca y voz: [`brand/skill.md`](brand/skill.md)
- Probar en local con funciones: `npm run planner:local` (ver SETUP).

## Trabajar en local

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # genera /dist
```

Para editar con IA: abrí esta carpeta con Claude Code y pedí el cambio ("agregá una sección de prensa en la home", "cambiá la foto de bio"...). Revisá en `npm run dev` y publicá.

## Publicar

**Opción A – automático con GitHub (recomendado):** Cloudflare Pages conectado al repo. Cada `git push` a `main` publica solo; cada rama genera una URL de preview.

Configuración en Cloudflare (Workers & Pages → Create → Pages → Connect to Git):
- Framework preset: **Astro**
- Build command: `npm run build`
- Output directory: `dist`
- Variable de entorno: `NODE_VERSION = 22`

**Opción B – manual desde la compu:**

```bash
npx wrangler login
npm run deploy
```

## Dominio kanso.ar (pasar de Wix a Cloudflare)

1. Cloudflare → **Add a domain** → `kanso.ar` → plan Free. Cloudflare copia los registros DNS actuales.
2. Revisar que estén los registros de **mail** (MX, SPF/TXT, DKIM) si usan hola@kanso.ar con Google/Zoho/etc. — no borrarlos.
3. En **NIC Argentina** (nic.ar → Trámites → Delegaciones) reemplazar los nameservers de Wix por los 2 que indica Cloudflare. Tarda entre minutos y 24 h.
4. En el proyecto de Pages → **Custom domains** → agregar `www.kanso.ar` y `kanso.ar`.
5. Redirigir `kanso.ar` → `www.kanso.ar` (Rules → Redirect Rules) o al revés, para tener una sola URL canónica.
6. Recién cuando el sitio nuevo responda bien en el dominio: cancelar el plan premium de Wix (y el dominio en Wix si estaba gestionado ahí).

> Si el dominio está registrado *a través de Wix* (no directo en NIC.ar), primero hay que transferirlo o cambiar los DNS desde el panel de Wix → Dominios.

## Pendientes / a revisar

- Google Search Console: verificar el dominio y enviar `https://www.kanso.ar/sitemap-index.xml` después del cambio.
