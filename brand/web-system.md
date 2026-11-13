---
name: kanso-web-system
description: Implementación fiel del Brand Design existente de KANSO Studio en la web, enfocada en jerarquía visual, sistema de espaciados, grillas editoriales y comportamiento responsive.
---

# Reglas de Implementación Web — KANSO Studio

Aplica al sitio público (`src/pages`, `src/components`, `src/styles`). El planificador de redes (`/planificador-redes`) es una herramienta interna y queda fuera de estas reglas.

## 1. Respeto Absoluto al Brand Design (Cero Improvisación)
- **Prohibido inventar estilos:** Usar EXCLUSIVAMENTE los colores, tipografías y grosores definidos en los design tokens del proyecto ([`src/styles/tokens.css`](../src/styles/tokens.css)). Si hace falta un valor nuevo, se suma primero como token. La paleta y las tipografías de marca están en [`skill.md`](skill.md#identidad-visual).
- **Sin adornos genéricos de IA:** Prohibido agregar sombras (`box-shadow`), bordes redondeados no especificados en el manual, degradados o iconos genéricos.

## 2. Jerarquía Visual y Escala Tipográfica
- Mantener una relación de contraste clara entre titulares de marca, bajadas y cuerpo de texto usando las fuentes oficiales de KANSO:
  - **Display / H1:** Escala fluida `clamp(2.5rem, 5vw, 4.5rem)`, interlineado ajustado (`1.05 - 1.15`). Token: `--fs-display`.
  - **Subtítulos / H2:** `clamp(1.5rem, 2.6vw, 2.25rem)` (24–36 px; ajustado desde `clamp(1.75rem, 3.2vw, 2.75rem)`). Token: `--fs-h2`.
  - **Títulos de ítems** (cada servicio): `clamp(1.5rem, 2.2vw, 1.875rem)` (24–30 px). Token: `--fs-h3`.
  - **Título de páginas internas** (Servicios, Bio): excepción a la escala display. Va chico, en mayúsculas y centrado sobre una banda beige: `--fs-body`, espaciado `--tracking-title`.
  - **Frase destacada:** `clamp(1.0625rem, 2vw, 1.375rem)` (17–22 px), centrada, para bloques de una sola frase como «Cerámica personalizada» en la home. Token: `--fs-lead`.
  - **Cuerpo:** `1rem - 1.125rem`, `line-height: 1.65`, ancho de línea máximo de `55ch` para evitar párrafos interminables de lado a lado. Tokens: `--fs-body`, `--lh-body`, `--measure`.
- **Un foco por pantalla:** En cada sección debe quedar claro qué se lee primero (Titular), qué acompaña (Imagen/Subtítulo) y cuál es la acción (CTA).

## 3. Sistema de Espaciado y Ritmo (Grilla 8pt)
- Todos los márgenes, paddings y gaps deben ser múltiplos estrictos de `8px` (`16, 24, 32, 48, 64, 96, 128, 160`). Tokens: `--s-1` a `--s-20`.
- **Aire entre secciones:** Separar bloques principales con `128px` a `160px` en desktop (`72px` a `96px` en mobile) para respetar el minimalismo de la marca. Token: `--section`.
- **Asimetría controlada:** Evitar que todas las secciones sean bloques centrados uno debajo del otro. Alternar grillas de 12 columnas (clase `.grid-12`) con desplazamientos y proporciones editoriales.

## 4. Tratamiento Fotográfico y CTAs
- Respetar las proporciones de las fotografías de piezas y proyectos (`4:5` y `16:9`) sin recortes forzados ni filtros CSS que alteren el color real de la cerámica.
- Jerarquizar las acciones: máximo un CTA primario por vista (`.btn`); las acciones secundarias (como los enlaces en cada servicio o cliente) deben resolverse como links tipográficos limpios (`.link-accent`).

## Excepciones aprobadas

- **Pie de página:** Instagram y «Volver arriba» van como botones circulares con ícono.

## Puntos de corte

- Mobile: hasta `799px` (una columna).
- Desktop: desde `800px` (grilla de 12 columnas); el aire y los márgenes laterales crecen desde `1200px`.
