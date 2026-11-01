# Lecciones de la sesión «Semana 11» y cambios en el MCP (v0.4.0)

Sesión del 01/11/2026: se construyó la página «Semana 11» de un Site real (74 bloques, 11 imágenes, un video de Drive) controlando este servidor. Esto es lo que falló, por qué, y qué se cambió.
Rama de trabajo: `mejoras-semana11` (sin commit; revisar con `git diff`). Copia de seguridad previa: `_respaldo-2026-11-01/`.

## Qué falló y qué se hizo

| # | Síntoma | Causa raíz | Cambio | Verificación |
|---|---|---|---|---|
| 1 | Las tildes, la ñ, «¿» y «—» desaparecían («acción» → «accin») | `keyboard.type()` descarta en el editor de Sites los caracteres que no están en el teclado básico; `insertText` solo conserva el último | `typeText()` en `util.ts`: ASCII por teclado, el resto pegado desde el portapapeles (permisos de portapapeles concedidos en `browser.ts`) | ✅ en vivo: «Prueba: acción, ñandú, ¿qué? — ü» quedó intacto |
| 2 | El **índice** (TOC) «migraba» al final con cada inserción; `add_block` tardó 401 s y desordenó la página | El servidor detectaba «bloque nuevo» comparando el **texto** de cada sección. El índice cambia su propio texto cuando se añade un título, así que se tomaba por el bloque nuevo y se arrastraba al final una y otra vez | `signature()` y `moveNewSectionsToEnd()` ahora comparan por el `data-id` estable de cada `<section>` | ✅ en vivo: el índice se quedó arriba mientras se insertaban bloques después |
| 3 | Los divisores aparecían como «Eliminar sección» en `list_sections` | El texto de la barra flotante del editor se colaba en la vista previa | Se elimina ese texto; vuelve a salir `[divider]` | ⚠️ sin probar en la sesión de prueba (el sitio de prueba no tenía divisores) |
| 4 | Las imágenes entraban de **283 px** y no había forma de agrandarlas | No existía la herramienta; el editor solo deja redimensionar arrastrando el tirador | `gsites_resize_block`: arrastra el tirador, calcula la altura con la proporción natural y corrige la altura al ancho que el editor aceptó (sin deformar) | ✅ la misma lógica funcionó en 11 imágenes con scripts; ⚠️ la herramienta MCP en sí no se ejecutó |
| 5 | No se podía insertar un video | Las herramientas de Drive solo cubren Docs/Slides/Hojas/Forms/Gráficos/Calendar; el selector genérico tiene la búsqueda plegada, su botón se llama «Insertar 1 elemento» y Sites pregunta si compartir el archivo | `gsites_upload_to_drive` (sube por la web de Drive en otra pestaña) y `gsites_add_drive_file` (por nombre; **no comparte** salvo `share="link_viewer"`) | ✅ la lógica funcionó en vivo con scripts; ⚠️ herramientas MCP sin ejecutar |
| 6 | Se usó un id de sitio mal copiado («l» minúscula por «I» mayúscula) → «Página no encontrada» | Copiar ids a mano desde una captura | `gsites_open_site(name)` y `gsites_open_page(name)` | ✅ `open_site` en vivo; ⚠️ `open_page` sin probar |
| 7 | Mover bloques tarda ~5 s **por posición** (16 posiciones = 80 s; el servidor cortaba a los 60 s) | `moveSection` arrastra de a una posición; el cliente MCP tiene 60 s de espera por defecto | Documentado. En el cliente, subir el `timeout` de `callTool`. Pendiente: arrastrar varias posiciones de una vez | ⚠️ pendiente |
| 8 | `gsites_set_insert_point(after=0)` colocó mal el primer bloque | La inserción al inicio depende de mover desde el final; falló | Queda marcado **EXPERIMENTAL** en su descripción. No usar `after=0` hasta arreglarlo | ❌ fallo reproducido |
| 9 | Las herramientas `gsites_*` **no aparecían** en la sesión de Claude Code | El servidor está registrado solo para la carpeta del proyecto en `~/.claude.json` (`hasTrustDialogAccepted: false`) | Registrarlo a nivel de usuario: `claude mcp add -s user google-sites -- node "C:\ruta\google-sites-mcp-server\dist\index.js"` | ⏳ no ejecutado (cambia tu configuración) |
| 10 | Un fallo a mitad de un script dejaba Edge abierto y bloqueaba el perfil | Un solo perfil persistente no admite dos procesos a la vez | Documentar: cerrar el MCP antes de usar scripts propios con el mismo perfil | — |

## Lo que quedó sin hacer (en orden de utilidad)
1. Arreglar `set_insert_point` (o sustituirlo por «seleccionar sección N y que Sites inserte tras ella»; en la prueba, `selectSection` al inicio de la página pareció seleccionar el encabezado).
2. Mover varias posiciones en un solo arrastre (hoy ~5 s por posición).
3. Probar con el MCP real `resize_block`, `upload_to_drive`, `add_drive_file`, `open_page` y el limpiado de divisores.
4. Herramienta por lotes (`gsites_build`) que reciba una lista de operaciones y evite repetir «seleccionar la última sección» (cada inserción tardaba 5–15 s).
5. Informar progreso en las operaciones largas.

## Cómo revertir
Volver a la rama original (`git checkout -`) y ejecutar `npm run build`; `dist/` no está en git, se regenera. También sirve copiar `_respaldo-2026-11-01/src` y `_respaldo-2026-11-01/dist`. Los archivos nuevos son `src/extras.ts` y `src/state.ts`.
