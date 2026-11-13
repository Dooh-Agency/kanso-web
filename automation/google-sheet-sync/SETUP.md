# Sincronización de la grilla con el planificador

Esta integración es gratuita a la escala actual: usa Google Apps Script, Google Drive y Cloudflare (Pages Functions, base D1, almacenamiento R2 y Access, todos en plan gratuito). No publica en redes ni llama a un modelo de IA.

## Cómo funciona

```text
Grilla (Google Sheets) ──Apps Script──▶ /api/sync/planner ──▶ D1 (piezas) + R2 (imágenes)
                                                                   │
Planificador (/planificador-redes) ◀──── /api/planner/* ◀──────────┘
        │  Aprobar / Pedir cambios
        └──▶ /api/planner/review ──▶ Apps Script (doPost) ──▶ escribe en la grilla y re-sincroniza la fila
```

- La grilla es la fuente de verdad. El planificador solo muestra lo sincronizado y escribe en la grilla las aprobaciones.
- **Cloudflare Access** protege `/planificador-redes` y `/api/planner`: solo entran los emails de la política “Equipo KANSO”, con un código que llega por mail. Para sumar a alguien, agregar su email en **Zero Trust → Access controls → Policies → Equipo KANSO**.
- `/api/sync/*` queda fuera de Access y se autentica con la clave compartida `PLANNER_SYNC_SECRET`.

## Qué sincroniza

Lee la pestaña `Grilla semanal` de la [grilla de KANSO](https://docs.google.com/spreadsheets/d/1SO6y7c2pHl652FgkZJ5aNCljmjJNRiZ0LzaLvHXCUpI/edit), en la carpeta [Planificador-RRSS](https://drive.google.com/drive/folders/13KYp4fuJPn6-GmOy899v-P7lQBG3bFYO) de Drive. Junto a la grilla están las carpetas `Assets finales` y `Tandas para importar`, que el script reutiliza por nombre.

- Desde la fila 5, usando los encabezados de la fila 4.
- Pieza, copy ES, copy EN, objetivo, formato, dirección visual (y el primer enlace de Canva que incluya), estado, observaciones, enlace de asset final, programación y URL publicada.
- Cada canal es una fila independiente, aunque comparta concepto con otra pieza. Por ejemplo, `01-IG` y `01-LI` requieren sus propios assets finales y tamaños.
- `Tamaño final` (E) indica la especificación de diseño y de exportación que corresponde a esa fila. Referencias actuales: feed/carrusel de Instagram `1080 × 1350 px · 4:5`, post vertical de LinkedIn `1200 × 1500 px · 4:5` y story `1080 × 1920 px · 9:16`.
- `Assets / fuente` (K) es material de referencia: fotos base, links de inspiración o fuente del contenido. No se sincroniza.
- `Assets finales (Drive)` (M) es la única fuente de publicación. Si contiene una carpeta de Drive, incorpora las imágenes y videos en orden natural (`1`, `2`, `3`…) y los copia al bucket privado de R2. **Solo sube los archivos nuevos o modificados**: los que no cambiaron en Drive no se vuelven a subir. Un enlace de Canva por sí solo no se puede previsualizar ni publicar: primero hay que exportar la pieza y subirla a Drive.
- `Preview / cover` (N, opcional) admite un único enlace a una imagen de Drive. Usalo en reels, videos y stories de video para fijar la portada que verá el equipo en el panel. Si queda vacío, el panel usa el primer asset final disponible.
- Actualiza una misma pieza sin duplicarla: la referencia es su fila de la grilla. Las filas que ya no existen se quitan del planificador, con sus archivos.

Los originales permanecen en Drive. No hace falta publicar la carpeta ni los archivos: alcanza con que la cuenta que ejecuta Apps Script tenga acceso de lectura.

## Preparación (una vez)

### En Cloudflare

Una sola vez, en la cuenta de Cloudflare de KANSO (todo en plan gratuito):

1. **Base D1:** Workers & Pages → D1 → Create → nombre `kanso-planner`. En la consola de la base, ejecutar en orden los archivos de [`cloudflare/migrations/`](../../cloudflare/migrations/).
2. **Bucket R2:** R2 → Create bucket → `kanso-planner-assets` (privado). Opcional: alertas de uso al 50 % del plan gratuito.
3. **Conectarlos al proyecto de Pages** `kanso-web`: Settings → Bindings → D1 `PLANNER_DB` = `kanso-planner` y R2 `PLANNER_BUCKET` = `kanso-planner-assets` (Production y Preview).
4. **Cloudflare Access:** Zero Trust (plan Free) → Access → Applications → Add → Self-hosted, nombre “Planificador de redes”, con las rutas `kanso-web-uze.pages.dev/planificador-redes` y `kanso-web-uze.pages.dev/api/planner`. Política “Equipo KANSO”: Allow, Emails = las personas que aprueban. Método de ingreso: código por mail (One-time PIN). Al mudar el dominio, sumar `www.kanso.ar/planificador-redes` y `www.kanso.ar/api/planner`.

Estado actual (cuenta `hello@dooh.com.ar`): D1 `kanso-planner` y R2 `kanso-planner-assets` creados y conectados a `kanso-web`; dominio `kanso.ar` en Cloudflare (redirige a `www.kanso.ar`, HTTPS obligatorio); aplicación de Access **“Planificador de redes KANSO”** (protege `/planificador-redes` y `/api/planner` en `www.kanso.ar` y en `kanso-web-uze.pages.dev`) con la política **“Equipo KANSO”** (`florencia@`, `fernanda@` y `hello@dooh.com.ar`). El equipo de Zero Trust es el mismo que usa DOOH: `broad-waterfall-7727.cloudflareaccess.com`.

En **Workers & Pages → kanso-web → Settings → Variables and secrets** (Production) cargar:

| Nombre | Tipo | Valor |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | Text | `<equipo>.cloudflareaccess.com` (Zero Trust → Settings → Custom pages / Team domain) |
| `ACCESS_AUD` | Text | El “Application Audience (AUD) Tag” de la aplicación de Access |
| `PLANNER_SYNC_SECRET` | Secret | Una clave larga y aleatoria (`openssl rand -hex 32`); la misma va en Apps Script |
| `PLANNER_ACTIONS_URL` | Secret | La URL `/exec` de la aplicación web de Apps Script (ver abajo) |

Las variables se aplican en el siguiente despliegue.

### Posts publicados de Instagram (opcional)

El feed del planificador puede completarse con los últimos 12 posts de `@kanso.ar`, debajo de las piezas planificadas, como se ven en el perfil. Usa la API de Instagram **solo con permiso de lectura** (`instagram_business_basic`): no puede publicar ni comentar. Sin el token, el feed muestra solo la grilla. Requiere que `@kanso.ar` sea una cuenta profesional (empresa o creador).

1. En [developers.facebook.com](https://developers.facebook.com) crear una app (tipo Empresa) con el caso de uso **API de Instagram** y sumar `@kanso.ar` como evaluadora de Instagram.
2. **Inicio de sesión con Facebook para empresas → Configuraciones → Crear configuración:** token de usuario del sistema que no caduca, activo **Cuentas de Instagram** y solo el permiso de lectura básica. No usar la plantilla: pide permisos de publicación, mensajes y anuncios.
3. **Casos de uso → API de Instagram → Personalizar:** elegir esa configuración y tocar **Generar token** junto a `kanso.ar`.
4. En Cloudflare (variables de `kanso-web`, Production) guardar el secreto `INSTAGRAM_ACCESS_TOKEN` y, como texto, `INSTAGRAM_ACCOUNT_ID` con el ID de la cuenta de Instagram que muestra Meta. Volver a desplegar.

La función `/api/planner/instagram` (protegida por Access) guarda la respuesta 3 horas en D1 (tabla `planner_settings`, que crea sola). También acepta un token de usuario de Instagram (empieza con `IG`, vence a los 60 días): en ese caso lo renueva cada 7 días. Si Instagram rechaza el token, el planificador lo avisa debajo del feed: generar uno nuevo y reemplazar el secreto. Los posts que ya figuran en la grilla con su `URL publicada` no se repiten.

### En Apps Script

1. En la grilla, abrir **Extensiones → Apps Script**.
2. Reemplazar el contenido por [`Code.gs`](Code.gs), guardar el proyecto y recargar la planilla.
3. En **Project Settings → Script properties**, agregar:

   - `PLANNER_API_URL` → `https://www.kanso.ar` (el dominio ya está en Cloudflare; `https://kanso-web-uze.pages.dev` también funciona).
   - `PLANNER_SYNC_SECRET` → la misma clave cargada en Cloudflare. Nunca copiarla en el sitio, en `.env.local`, en Git ni en un mensaje de chat.

   Si quedaron `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` de la versión anterior, borrarlas.

   Opcional: `DRIVE_ASSETS_FOLDER_ID` → el ID de la carpeta de Drive donde se crearán las carpetas de cada pieza. Si no se define, el script crea (o reutiliza) una carpeta `Assets finales` junto a la planilla y guarda su ID automáticamente.
4. **Implementar → Nueva implementación → Aplicación web**, con **Ejecutar como: yo** y **Quién tiene acceso: cualquier usuario**. Autorizar los permisos y copiar la URL que termina en `/exec` en `PLANNER_ACTIONS_URL` de Cloudflare.

   “Cualquier usuario” es necesario para que Cloudflare pueda llamarla; no da acceso a la grilla. Solo acepta pedidos con `PLANNER_SYNC_SECRET`, solo cambia `Estado`, `Observaciones`, `Día` y `Fecha/hora salida` de piezas ya sincronizadas y no toca piezas programadas o publicadas.
5. Volver a la grilla y ejecutar **Planificador KANSO → Sincronizar con el planificador**. Aceptar los permisos solicitados por Google.
6. Activar **Planificador KANSO → Activar sincronización cada hora**.

Cuando se cambie `Code.gs`, actualizar la implementación existente (**Implementar → Gestionar implementaciones → Editar → Nueva versión**) para conservar la misma URL.

## Operación

La grilla es fija: cada semana se agregan filas nuevas al final, sin crear otra planilla.

1. Cargar la pieza en la grilla con, al menos, `Pieza` y `Tema`, o importar una tanda preparada (ver abajo).
2. Ejecutar **Planificador KANSO → Crear carpetas de assets** (o directamente **Sincronizar con el planificador**, que también las crea). Cada pieza sin link en `Assets finales (Drive)` recibe una carpeta `01-IG · Tema` y su link queda escrito en la columna. Nunca se reemplaza un link cargado a mano.
3. Exportar la pieza desde Canva y soltar los archivos en esa carpeta, numerados `1`, `2`, `3`… para fijar el orden del carrusel.
4. Sincronizar, o esperar a la sincronización horaria. Las ejecuciones horarias no muestran un aviso: su resumen y sus errores quedan en **Apps Script → Ejecuciones**, y Google envía un correo si alguna falla.

En el planificador, **Actualizar** recarga lo último sincronizado.

### Aprobar y pedir cambios

Cada pieza muestra qué le falta para salir (copy, gráfica, fecha, aprobación y programación), un botón para abrir el diseño en Canva si `Dirección visual` incluye el enlace, y los botones **Aprobar** y **Pedir cambios** (con comentario obligatorio). La decisión se escribe en la grilla: `Estado` pasa a `Aprobado` o `Cambios solicitados` (los valores de la lista desplegable de la grilla) y `Observaciones` suma una línea con fecha, email y comentario. La pieza se actualiza en el planificador en el momento. Aprobar no programa ni publica: `Programar publicación` se sigue marcando en la grilla.

### Ordenar la salida

En el feed de Instagram, la fila de stories y la cola de LinkedIn, **Ordenar** permite arrastrar las piezas al orden en que tienen que salir (en el celular, mantener apretada la pieza antes de arrastrarla). **Guardar orden** lo escribe en la grilla:

- Las fechas no se inventan: cada pieza movida toma `Día` y `Fecha/hora salida` del lugar donde se suelta, y la que estaba ahí pasa al lugar siguiente.
- La story y la adaptación de LinkedIn de cada pieza movida (las filas cuya `Pieza relacionada` es esa pieza) se corren los mismos días y conservan su horario. Ordenar stories o LinkedIn en su propia vista no mueve otras piezas.
- Las piezas `Programado`, `Publicado` o `Descartado`, y las que no tienen fecha, quedan fijas (🔒): el resto se ordena alrededor. Para mover una pieza ya programada, reprogramarla primero en Meta o LinkedIn y volverla a `Aprobado`.
- Cada cambio suma una línea en `Observaciones` con la fecha anterior, la nueva y el email de quien ordenó.
- Las filas de la grilla no se mueven (el planificador identifica cada pieza por su fila): para verlas en orden de salida, ordenar o filtrar la grilla por `Fecha/hora salida`.

El feed de Instagram se muestra de la pieza más nueva a la más vieja, como en el perfil; stories y LinkedIn, en orden de salida.

Si alguien inserta o mueve filas en la grilla, la acción se rechaza con el aviso “La grilla cambió desde la última sincronización”: sincronizar y volver a intentar. Así nunca se escribe sobre otra pieza.

### Importar una tanda

Las tandas que prepara el asistente ([`../TANDA_SEMANAL.md`](../TANDA_SEMANAL.md)) llegan como archivos CSV `Tanda AAAA-MM-DD.csv` (sin convertir a Google Sheets) dentro de la carpeta `Tandas para importar`, junto a la grilla (o la definida en la propiedad opcional `TANDAS_FOLDER_ID`). **Planificador KANSO → Importar tanda nueva** agrega sus filas al final de la grilla con el formato y las listas desplegables de la primera pieza, empareja las columnas por nombre de encabezado, crea las carpetas de assets y renombra la tanda como `✓ Importada · …` para no cargarla dos veces. Si algo falla, borra las filas que haya agregado de esa tanda y no la renombra. Un valor que no esté en la lista desplegable (por ejemplo, en `Estado`) se importa igual y queda marcado como inválido en la celda.

Si una carpeta se renombra o se borra el link de la columna, la siguiente ejecución reutiliza la carpeta que tenga exactamente el nombre `Pieza · Tema`, o crea una nueva si el tema cambió.



`npm run dev` sirve la página, pero no las funciones. Para probar el planificador completo, compilar (`npm run build`) y usar `npx wrangler pages dev` con un `wrangler.toml` **fuera del repositorio** que declare `PLANNER_DB`, `PLANNER_BUCKET`, `PLANNER_SYNC_SECRET` y `PLANNER_DEV_EMAIL`. No agregar un `wrangler.toml` al repo: Cloudflare Pages lo tomaría como configuración y dejaría de usar la del panel. `PLANNER_DEV_EMAIL` simula la sesión de Access y nunca debe cargarse en producción.

## Probar en local

`npm run dev` sirve el sitio y la página, pero no las funciones. Para probar el planificador completo:

1. Crear `.dev.vars` (no se sube a Git) con `PLANNER_SYNC_SECRET=<cualquier clave local>` y `PLANNER_DEV_EMAIL=<tu email>`. `PLANNER_DEV_EMAIL` simula la sesión de Access y nunca se carga en producción.
2. Crear las tablas en la base local una vez (desde una carpeta fuera del repo, con un `wrangler.toml` que declare `PLANNER_DB` con `database_id = "00000000-0000-0000-0000-000000000000"`):
   `npx wrangler d1 execute PLANNER_DB --local --persist-to <repo>/.wrangler/state --file <repo>/cloudflare/migrations/0001_planner.sql` (y las demás).
3. `npm run planner:local` → <http://localhost:8788/planificador-redes>.

No agregar un `wrangler.toml` al repositorio: Cloudflare Pages lo tomaría como configuración y dejaría de usar la del panel.
