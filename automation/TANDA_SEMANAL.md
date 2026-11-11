# Armar una tanda semanal

Procedimiento a pedido: el equipo pide “armá la tanda de la semana” y el asistente prepara el copy y los diseños en Canva para la grilla fija. La aprobación y la publicación siguen siendo humanas.

El circuito completo es: **ideas en el Formulario de inputs → el asistente arma la tanda y sus diseños → el equipo aprueba en la grilla.**

## Fuentes

| Fuente | Uso |
| --- | --- |
| [Formulario de inputs](https://docs.google.com/spreadsheets/d/1hpm8c62Y4XyOqbT59MVv3RyNVf3XMeruWr_rw6ht8XQ/edit) | Temas disponibles. Solo filas con `Autorizado para usar = Confirmado` y `Estado` distinto de `Usado`. |
| [Grilla de redes](https://docs.google.com/spreadsheets/d/1SO6y7c2pHl652FgkZJ5aNCljmjJNRiZ0LzaLvHXCUpI/edit) | Único lugar de revisión y aprobación. Historial para evitar repetir temas, ganchos o CTA, y continuar la numeración de piezas. |
| Carpeta de imágenes del proyecto en Drive | Fotos reales del trabajo, una carpeta por proyecto. Se reutilizan en todas las piezas de ese proyecto. |
| [`../brand/skill.md`](../brand/skill.md) | Voz, ejes, cadencia y guardrails de KANSO. |
| [`../../docs/base/01-brand-identity.md`](../../docs/base/01-brand-identity.md) | Identidad de marca. |

## Pasos

1. Leer las fuentes. Si el pedido no indica la semana, usar la próxima semana que empieza en lunes.
2. Elegir 3 temas balanceando los ejes del mes definidos en [`../brand/skill.md`](../brand/skill.md#ejes-editoriales). Si no hay 3 inputs válidos, armar solo los que haya y avisar: nunca completar con temas inventados.
3. Por cada tema, preparar la pieza principal, y una story de Instagram para el día siguiente.
4. Generar el diseño de cada pieza en Canva con el autofill del Brand Template que corresponde (ver [Diseños en Canva](#diseños-en-canva)).
5. Cargar las filas en la grilla con las columnas de abajo, incluido el link del diseño.
   - **Con el conector de Google Sheets:** escribir las filas directo al final de la grilla y crear sus carpetas de assets.
   - **Sin el conector:** subir la tanda como CSV en UTF-8, **sin convertirlo a Google Sheets**, a la carpeta `Tandas para importar` con el título `Tanda AAAA-MM-DD.csv` (lunes de la semana), y ejecutar **Planificador KANSO → Importar tanda nueva** en la grilla. Si se convierte, Drive transforma textos como `Lunes 09/11` en fechas y el script no lo importa.
6. Exportar cada borrador de Canva como PNG (solo las páginas que se usan, numeradas `1`, `2`, `3`… en orden de placa) y subirlo a la carpeta de `Assets finales (Drive)` de su pieza, para que el planificador muestre la gráfica junto al copy. Si el equipo ajusta el diseño en Canva, reemplaza esos archivos antes de aprobar: esa carpeta es la que se publica.
7. Informar al equipo qué temas se usaron para que marquen esos inputs como `Usado`.

## Diseños en Canva

- Usar solo los Brand Templates de [`../brand/canva_templates.md`](../brand/canva_templates.md). Antes de llenarlos, confirmar sus campos de autofill; si un template no tiene campos o no está accesible, marcar `[FALTA TEMPLATE]` y dejar la dirección visual para que el equipo lo diseñe.
- Textos cortos: en stories, hasta unos 25 caracteres por campo; el texto largo va en el caption, no en la placa.
- Imágenes:
  - **Piezas de proyectos:** solo fotos reales de la carpeta del proyecto en Drive. Se puede recortar al formato y ajustar luz, contraste o color; no se cambia el contenido del trabajo ni se completan zonas con IA.
  - **Sin foto disponible:** dejar la imagen del template y anotar en `Dirección visual` qué imagen falta.
- El diseño generado es un borrador: el equipo lo revisa, ajusta y exporta desde Canva. Si el template tiene variantes de más, el equipo borra las páginas que no se usan.

## Columnas de la tanda

Se escriben con los encabezados exactos de la grilla. Las columnas que no figuren quedan vacías.

| Columna | Contenido |
| --- | --- |
| `Pieza` | Continuar la numeración de la grilla: `05-IG`, `05-LI`, `05S`, `06-IG`… |
| `Día` | Día y fecha, por ejemplo `Lunes 09/11`. |
| `Canal` | `Instagram` (o `LinkedIn` si en algún momento se suma). |
| `Formato` | `Carrusel IG`, `Post Instagram`, `Reel IG` o `Story IG`. |
| `Tamaño final` | `1080 × 1350 px · 4:5` (feed y carrusel) o `1080 × 1920 px · 9:16` (story y reel). |
| `Objetivo` | Una línea. |
| `Tema` | `Proyecto — ángulo`, por ejemplo `MUUD — identidad para cafetería en Trelew`. |
| `Copy ES` | Caption en español con hashtags. |
| `Copy EN` | Opcional. KANSO publica en español; se completa solo si una pieza lo pide. |
| `Dirección visual` | Link del diseño generado en Canva, template usado y qué falta ajustar (imagen, placas, variantes). Si no se generó diseño, template a usar, texto por placa, imágenes sugeridas y CTA. |
| `Assets / fuente` | Link del input en Drive o fuente del dato. |
| `Estado` | Siempre `En revisión`. Es una lista desplegable en la grilla: un valor distinto queda marcado como inválido. |
| `Pieza relacionada` | En stories y adaptaciones, la pieza principal (`05-IG`). |
| `Fecha/hora salida` | Sugerida, en formato `AAAA-MM-DD HH:MM` (hora de Argentina). |
| `Programar publicación` | Siempre `No`. |

## Links con etiqueta (UTM)

Todo link al sitio que se use en redes lleva etiquetas `utm_*`. Así la pestaña **Consultas** del planificador sabe qué canal y qué pieza trajo cada consulta. Sin etiqueta, las visitas desde la app de Instagram suelen figurar como “Directo”.

Formato: `https://www.kanso.ar/<página>?utm_source=<red>&utm_medium=<ubicación>&utm_campaign=<pieza>`

| Dónde va el link | `utm_source` | `utm_medium` | `utm_campaign` |
| --- | --- | --- | --- |
| Bio de Instagram | `instagram` | `bio` | `bio` (o el tema del mes si la bio apunta a una nota) |
| Sticker de enlace en story | `instagram` | `story` | código de la pieza en minúsculas, por ejemplo `03s` |
| Newsletter o mail | `email` | `newsletter` | mes, por ejemplo `2026-11` |
| WhatsApp (link enviado a mano) | `whatsapp` | `mensaje` | tema |

Reglas:

- Solo letras minúsculas, números y guiones; sin espacios ni tildes.
- En `utm_campaign` usar el código de `Pieza` de la grilla, así la consulta se puede cruzar con la publicación.
- En Instagram los links del caption no se pueden tocar: el link etiquetado va en la bio o en el sticker de la story, y el caption dice “link en la bio”.
- Al armar una tanda, cada pieza que lleve al sitio incluye su link etiquetado en `Dirección visual` (stories: en “link al post”/sticker).

Ejemplo, sticker de la story `03S` que lleva a talleres privados:
`https://www.kanso.ar/eventosprivados?utm_source=instagram&utm_medium=story&utm_campaign=03s`

## Reglas

- No inventar clientes, métricas, resultados ni citas. Si falta información, escribir `[REVISAR]` al comienzo del copy y explicar qué falta en `Dirección visual`.
- No usar inputs con autorización `Pendiente`.
- No marcar piezas como aprobadas, no programarlas y no publicar.
- No mezclar KANSO con DOOH, FA Pottery ni otros proyectos: cada marca tiene su repositorio, su voz y sus assets.
