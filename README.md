<div align="center">

# 🌐 Google Sites MCP

**Let Claude build your Google Site.**
An MCP server that drives the Google Sites editor, because Google never shipped an API for it.

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Node 18+](https://img.shields.io/badge/node-%E2%89%A518-339933)
![MCP](https://img.shields.io/badge/MCP-server-blueviolet)
![Tools](https://img.shields.io/badge/tools-29-blue)

[English](#english) · [Español](#español)

</div>

---

## English

Google Sites (the "new" Sites) has **no public API**. The old Sites API only works with *classic* Sites and is deprecated.
This server fills the gap: it opens a real browser with **your** Google session and operates the editor for you,
exposing everything as [MCP](https://modelcontextprotocol.io) tools that Claude (or any MCP client) can call.

> Ask: *"Create a portfolio site with a hero title, an About section, my skills as bullets, a photo, a map of my city and a contact button, then publish it."*
> The server does the clicking.

### What you can do

| Area | Tools |
|---|---|
| **Sites & pages** | `gsites_create_site` · `gsites_add_page` · `gsites_set_page_title` |
| **Text** | `gsites_add_text` — title / heading / subtitle / small, alignment, bold, bullet and numbered lists |
| **Media** | `gsites_add_image` (upload a local file) · `gsites_add_carousel` · `gsites_add_youtube` · `gsites_add_map` |
| **Layout & blocks** | `gsites_add_layout` (6 image + caption layouts) · `gsites_add_button` · `gsites_add_divider` · `gsites_add_block` (table of contents, collapsible group, spacer, placeholder) |
| **Embeds** | `gsites_add_embed` — any public URL **or raw HTML/CSS/JS** · `gsites_add_social_links` |
| **Google Drive** | `gsites_add_drive_item` — Docs, Slides, Sheets, Forms, Charts, Calendar |
| **Organize** | `gsites_list_sections` · `gsites_move_section` · `gsites_duplicate_section` · `gsites_delete_section` |
| **Publish** | `gsites_publish` · `gsites_unpublish` |
| **Escape hatches** | `gsites_open` · `gsites_snapshot` · `gsites_screenshot` · `gsites_get_text` · `gsites_click` · `gsites_type` · `gsites_press_key` · `gsites_close_browser` |

Content is always **appended at the end of the page**: after every insert the server checks the section order and fixes it if Sites put the block somewhere else.

### Requirements

- Node.js 18+
- Microsoft Edge (default) or Google Chrome (`GSITES_CHANNEL=chrome`)
- A Google account that can use Google Sites
- Windows is the tested platform; macOS and Linux should work but are untested

### Install

```bash
git clone https://github.com/RXDG2908/google-sites-mcp.git
cd google-sites-mcp
npm install        # also builds (prepare script)
npm run login      # one-time: sign in to Google in the window that opens, then close it
```

Register it with Claude Code:

```bash
claude mcp add google-sites -- node /absolute/path/to/google-sites-mcp/dist/index.js
```

Or in any MCP client config (Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "google-sites": {
      "command": "node",
      "args": ["/absolute/path/to/google-sites-mcp/dist/index.js"]
    }
  }
}
```

Your Google session is stored in `~/.google-sites-mcp-profile` (change with `GSITES_PROFILE_DIR`). It never leaves your machine.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `GSITES_CHANNEL` | `msedge` | Browser to drive: `msedge`, `chrome`, or empty for Playwright's bundled Chromium |
| `GSITES_PROFILE_DIR` | `~/.google-sites-mcp-profile` | Where the signed-in browser profile lives |
| `GSITES_HEADLESS` | off | `1` to hide the window (Google may block sign-in in headless mode) |
| `GSITES_DEBUG` | off | `1` for full Playwright error messages |

### How it works

```
Claude ──MCP/stdio──▶ google-sites-mcp ──Playwright──▶ Edge/Chrome ──▶ sites.google.com editor
                          │                                  └─ persistent profile (your login)
                          └─ after each insert: list sections → detect new block → move to end if needed
```

It uses accessible labels, ARIA roles and Google's own `data-value` attributes rather than pixel positions, in Spanish and English UI.
Sections are dragged by their handle one step at a time, away from the canvas edges (dragging near an edge makes Sites auto-scroll and overshoot).

### Tested

Verified against the live editor with an automated end-to-end run (31 checks, all passing):
create site, page title, add page, text (heading, bold, bullets, centered), image, button, divider, 3-column layout,
HTML embed, URL embed, YouTube, map, Drive doc, calendar, carousel, social icons, table of contents, collapsible group,
spacer, placeholder, insertion order, duplicate, move, delete, publish and unpublish.

### Limitations — please read

- **It automates a web UI.** Google can change the editor at any time and a selector may break. Use `gsites_snapshot` / `gsites_screenshot` + `gsites_click` / `gsites_type` as a fallback, and open an issue.
- **It cannot** change themes, colors or fonts; edit text that is already written; rename, reorder or delete pages; manage sharing permissions; edit the header image or footer; list or delete your sites.
- Drive items insert the **first** search result — use a specific query.
- Images are uploaded from local files, not URLs.
- Slides, Sheets, Forms and Charts pickers share the Docs flow but have not been individually tested.
- One site at a time, one action at a time; each action takes a few seconds. Moving a section far away takes about 3 s per position.
- Only the **new** Google Sites. Classic Sites are not supported.
- It does not solve CAPTCHAs or two-step verification; sign in manually once.
- `gsites_publish` / `gsites_unpublish` change who can see a site. Ask before using them on real sites.

### Responsible use

This is an **unofficial** project, not affiliated with or endorsed by Google. It drives the website you are already signed in to,
on your behalf, with your account. Review Google's Terms of Service for your account type before using automation, and don't use it to
mass-create sites or bypass any restriction. You are responsible for what it does with your account.

### Contributing

Issues and PRs are welcome — especially: selector fixes after Google UI changes, other UI languages, macOS/Linux reports,
and the untested pickers. Run `npm run build` before sending a PR.

### License

[MIT](LICENSE)

---

## Español

Google Sites (el Sites "nuevo") **no tiene API pública**. La API antigua solo sirve para Sites *clásico* y está obsoleta.
Este servidor resuelve ese hueco: abre un navegador real con **tu** sesión de Google y maneja el editor por ti,
exponiendo todo como herramientas [MCP](https://modelcontextprotocol.io) que Claude (o cualquier cliente MCP) puede llamar.

> Pídele: *"Crea un portafolio con un título grande, una sección Sobre mí, mis habilidades en viñetas, una foto, un mapa de mi ciudad y un botón de contacto, y publícalo."*
> El servidor hace los clics.

### Qué puedes hacer

| Área | Herramientas |
|---|---|
| **Sitios y páginas** | `gsites_create_site` · `gsites_add_page` · `gsites_set_page_title` |
| **Texto** | `gsites_add_text`: título / encabezado / subtítulo / pequeño, alineación, negrita, listas con viñetas y numeradas |
| **Multimedia** | `gsites_add_image` (sube un archivo local) · `gsites_add_carousel` · `gsites_add_youtube` · `gsites_add_map` |
| **Diseño y bloques** | `gsites_add_layout` (6 diseños de imagen + subtítulo) · `gsites_add_button` · `gsites_add_divider` · `gsites_add_block` (índice, grupo ocultable, separador, marcador) |
| **Incrustar** | `gsites_add_embed`: cualquier URL pública **o HTML/CSS/JS propio** · `gsites_add_social_links` |
| **Google Drive** | `gsites_add_drive_item`: Documentos, Presentaciones, Hojas, Formularios, Gráficos, Calendar |
| **Organizar** | `gsites_list_sections` · `gsites_move_section` · `gsites_duplicate_section` · `gsites_delete_section` |
| **Publicar** | `gsites_publish` · `gsites_unpublish` |
| **Salidas de emergencia** | `gsites_open` · `gsites_snapshot` · `gsites_screenshot` · `gsites_get_text` · `gsites_click` · `gsites_type` · `gsites_press_key` · `gsites_close_browser` |

El contenido siempre se **agrega al final de la página**: tras cada inserción el servidor revisa el orden de las secciones y lo corrige si Sites colocó el bloque en otro sitio.

### Requisitos

- Node.js 18 o superior
- Microsoft Edge (por defecto) o Google Chrome (`GSITES_CHANNEL=chrome`)
- Una cuenta de Google que pueda usar Google Sites
- Windows es la plataforma probada; macOS y Linux deberían funcionar pero no están probados

### Instalación

```bash
git clone https://github.com/RXDG2908/google-sites-mcp.git
cd google-sites-mcp
npm install        # también compila (script prepare)
npm run login      # una sola vez: inicia sesión en Google en la ventana que se abre y ciérrala
```

Regístralo en Claude Code:

```bash
claude mcp add google-sites -- node /ruta/absoluta/a/google-sites-mcp/dist/index.js
```

O en la configuración de cualquier cliente MCP (Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "google-sites": {
      "command": "node",
      "args": ["/ruta/absoluta/a/google-sites-mcp/dist/index.js"]
    }
  }
}
```

Tu sesión de Google se guarda en `~/.google-sites-mcp-profile` (cámbialo con `GSITES_PROFILE_DIR`). No sale de tu equipo.

### Variables de entorno

| Variable | Valor por defecto | Significado |
|---|---|---|
| `GSITES_CHANNEL` | `msedge` | Navegador a controlar: `msedge`, `chrome`, o vacío para el Chromium de Playwright |
| `GSITES_PROFILE_DIR` | `~/.google-sites-mcp-profile` | Dónde está el perfil con tu sesión iniciada |
| `GSITES_HEADLESS` | desactivado | `1` para ocultar la ventana (Google puede bloquear el inicio de sesión sin ventana) |
| `GSITES_DEBUG` | desactivado | `1` para ver los errores completos de Playwright |

### Cómo funciona

Usa etiquetas accesibles, roles ARIA y los atributos `data-value` de Google, no posiciones en pantalla, tanto en español como en inglés.
Las secciones se arrastran por su asa de una posición a la vez y lejos de los bordes del lienzo (arrastrar cerca de un borde hace que Sites desplace la página y se pase de largo).

### Probado

Verificado contra el editor real con una corrida automática de punta a punta (31 comprobaciones, todas aprobadas):
crear sitio, título de página, añadir página, texto (encabezado, negrita, viñetas, centrado), imagen, botón, divisor, diseño de 3 columnas,
embed HTML, embed por URL, YouTube, mapa, documento de Drive, calendario, carrusel, iconos sociales, índice, grupo ocultable,
separador, marcador, orden de inserción, duplicar, mover, borrar, publicar y despublicar.

### Limitaciones — léelas

- **Automatiza una interfaz web.** Google puede cambiar el editor en cualquier momento y algún selector puede romperse. Usa `gsites_snapshot` / `gsites_screenshot` + `gsites_click` / `gsites_type` como respaldo y abre un issue.
- **No puede** cambiar temas, colores o fuentes; editar texto ya escrito; renombrar, reordenar o borrar páginas; gestionar permisos de uso compartido; editar la imagen de encabezado o el pie; listar o borrar tus sitios.
- Los elementos de Drive insertan el **primer** resultado de la búsqueda: usa una consulta específica.
- Las imágenes se suben desde archivos locales, no desde URL.
- Los selectores de Presentaciones, Hojas, Formularios y Gráficos usan el mismo flujo que Documentos pero no se probaron uno a uno.
- Un sitio y una acción a la vez; cada acción tarda unos segundos. Mover una sección lejos tarda unos 3 s por posición.
- Solo el Google Sites **nuevo**. El clásico no está soportado.
- No resuelve CAPTCHA ni verificación en dos pasos; inicia sesión manualmente una vez.
- `gsites_publish` / `gsites_unpublish` cambian quién puede ver un sitio. Pregunta antes de usarlos en sitios reales.

### Uso responsable

Es un proyecto **no oficial**, sin relación ni respaldo de Google. Maneja el sitio web en el que ya iniciaste sesión, en tu nombre y con tu cuenta.
Revisa los Términos de Servicio de Google para tu tipo de cuenta antes de usar automatización, y no lo uses para crear sitios en masa ni para saltarte restricciones.
Tú eres responsable de lo que haga con tu cuenta.

### Contribuir

Los issues y PR son bienvenidos, sobre todo: arreglos de selectores cuando Google cambie la interfaz, otros idiomas de la interfaz,
reportes de macOS/Linux y los selectores sin probar. Ejecuta `npm run build` antes de enviar un PR.

### Licencia

[MIT](LICENSE)
