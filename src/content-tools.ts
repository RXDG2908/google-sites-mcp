import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs";
import type { Page } from "playwright";
import { getPage } from "./browser.js";
import { ok, fail, SNAP_HINT, rw, ro, del, typeText } from "./util.js";
import { insertPoint } from "./state.js";
import {
  BLOCKS, DRIVE_KINDS, LAYOUTS, TextStyle, pickFirstResult,
  clickInsertItem, dialogButton, listSections, moveSection, openInsertTab,
  moveNewSectionsToEnd, placeNewSectionsAt, scrollPageTop, selectLastSection, selectSection, signature, selectedSectionButton, setAlign, setTextStyle,
} from "./editor.js";

export const outline = async (): Promise<string> => {
  const page = await getPage();
  const list = await listSections(page);
  return list.length ? list.map((s) => `${s.index}. ${s.preview}`).join("\n") : "(no content sections)";
};

/** Close a modal left open by a failed step so later calls are not blocked. */
export async function closeOpenDialog(): Promise<void> {
  const page = await getPage();
  for (const f of page.frames()) {
    await f.getByRole("button", { name: /cerrar el selector|close picker/i }).first().click({ timeout: 1500 }).catch(() => undefined);
  }
  await page.getByRole("button", { name: /^(cancelar|cancel)$/i }).filter({ visible: true }).first().click({ timeout: 1500 }).catch(() => undefined);
  await page.getByText(/^(cancelar|cancel)$/i).filter({ visible: true }).first().click({ timeout: 1500 }).catch(() => undefined);
  await page.keyboard.press("Escape").catch(() => undefined);
}

/** Select the last section (so Sites inserts after it) and remember the page layout. */
export async function beginInsert(page: Page): Promise<string[]> {
  if (insertPoint.after !== null && insertPoint.after > 0) await selectSection(page, insertPoint.after);
  else if (insertPoint.after === null) await selectLastSection(page);
  return signature(page);
}

export const fixOrder = async (page: Page, before: string[]): Promise<void> => {
  if (insertPoint.after === null) return moveNewSectionsToEnd(page, before);
  insertPoint.after += await placeNewSectionsAt(page, before, insertPoint.after);
};

export const AT_END = "New content goes after the currently selected section; by default the last section is selected first so content is appended at the end. Use gsites_move_section to reorder afterwards.";

export function registerContentTools(server: McpServer): void {
  server.registerTool(
    "gsites_add_text",
    {
      title: "Add a text box",
      description: `Insert a text box with the given text at the end of the open page. ${AT_END}
Style: normal | title | heading | subtitle | small. Use '\\n' for new lines. 'list' turns the lines into bullets or a numbered list. 'bold' makes all text bold.
Examples: {text:"Mis proyectos", style:"heading"}, {text:"HTML\\nCSS\\nJS", list:"bullets"}.`,
      inputSchema: {
        text: z.string().min(1).describe("Text to write; use \\n between paragraphs/list items"),
        style: z.enum(["normal", "title", "heading", "subtitle", "small"]).default("normal"),
        align: z.enum(["left", "center", "right", "justify"]).default("left"),
        bold: z.boolean().default(false),
        list: z.enum(["none", "bullets", "numbered"]).default("none"),
      },
      annotations: rw,
    },
    async ({ text, style, align, bold, list }) => {
      try {
        const page = await getPage();
        const before = await beginInsert(page);
        await clickInsertItem(page, /^(text box|cuadro de texto)$/i);
        await page.waitForTimeout(1000);
        await setTextStyle(page, style as TextStyle);
        await setAlign(page, align);
        if (list !== "none") {
          await page.getByRole("button", { name: list === "bullets" ? /viñetas|bulleted/i : /numerada|numbered/i }).filter({ visible: true }).first().click({ timeout: 6000 });
        }
        if (bold) await page.keyboard.press("Control+B");
        await typeText(page, text, 8);
        await page.waitForTimeout(800);
        await fixOrder(page, before);
        return ok(`Text added (${style}).\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        // Remove the half-created empty text box so the page is not left with a placeholder.
        const page = await getPage();
        await page.keyboard.press("Escape").catch(() => undefined);
        await selectedSectionButton(page, /^(eliminar sección|delete section)$/i).catch(() => undefined);
        return fail("add_text", e, SNAP_HINT);
      }
    }
  );

  server.registerTool(
    "gsites_add_image",
    {
      title: "Upload and add an image",
      description: `Upload a local image file (png/jpg/gif/webp) and add it to the open page. ${AT_END}`,
      inputSchema: { file_path: z.string().min(1).describe("Absolute path of an image on this computer") },
      annotations: rw,
    },
    async ({ file_path }) => {
      try {
        if (!fs.existsSync(file_path)) throw new Error(`file not found: ${file_path}`);
        const page = await getPage();
        const before = await beginInsert(page);
        await clickInsertItem(page, /^(images|imágenes)$/i);
        const [fc] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 8000 }),
          page.getByText(/^(upload|subir)$/i).filter({ visible: true }).first().click({ timeout: 8000 }),
        ]);
        await fc.setFiles(file_path);
        await page.waitForTimeout(6000);
        await fixOrder(page, before);
        return ok(`Image added.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        await closeOpenDialog();
        return fail("add_image", e, "Check the file path, then use gsites_screenshot to see the editor.");
      }
    }
  );

  server.registerTool(
    "gsites_add_button",
    {
      title: "Add a link button",
      description: `Insert a button with a label that links to a URL. ${AT_END}`,
      inputSchema: {
        label: z.string().min(1).max(120).describe("Button text, e.g. 'Ver proyectos'"),
        url: z.string().min(1).describe("Link, e.g. https://example.com"),
      },
      annotations: rw,
    },
    async ({ label, url }) => {
      try {
        const page = await getPage();
        const before = await beginInsert(page);
        await clickInsertItem(page, /^(button|botón)$/i);
        const nameBox = page.getByRole("textbox", { name: /^(name|nombre)$/i });
        const linkBox = page.getByRole("textbox", { name: /^(link|enlace)$/i });
        await nameBox.click({ timeout: 8000 });
        await typeText(page, label, 8);
        await linkBox.click({ timeout: 8000 });
        await typeText(page, url, 8);
        if ((await linkBox.inputValue()) !== url) throw new Error("the link field did not accept the URL");
        await dialogButton(page, /^(insert|insertar)$/i);
        await page.waitForTimeout(1500);
        await fixOrder(page, before);
        return ok(`Button '${label}' added.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        await closeOpenDialog();
        return fail("add_button", e, SNAP_HINT);
      }
    }
  );

  server.registerTool(
    "gsites_add_divider",
    {
      title: "Add a divider line",
      description: `Insert a horizontal divider line. ${AT_END}`,
      inputSchema: {},
      annotations: rw,
    },
    async () => {
      try {
        const page = await getPage();
        const before = await beginInsert(page);
        await clickInsertItem(page, /^(divider|divisor)$/i);
        await page.waitForTimeout(1200);
        await fixOrder(page, before);
        return ok(`Divider added.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        return fail("add_divider", e, SNAP_HINT);
      }
    }
  );

  server.registerTool(
    "gsites_add_layout",
    {
      title: "Add a content layout block",
      description: `Insert a ready-made content block (image(s) + caption placeholders). ${AT_END}
Layouts: ${LAYOUTS.join(", ")}.`,
      inputSchema: { layout: z.enum(LAYOUTS) },
      annotations: rw,
    },
    async ({ layout }) => {
      try {
        const page = await getPage();
        const before = await beginInsert(page);
        await openInsertTab(page);
        await page.locator('[aria-label^="Añadir diseño"], [aria-label^="Add layout"]').nth(LAYOUTS.indexOf(layout)).click({ timeout: 8000 });
        await page.waitForTimeout(1500);
        await fixOrder(page, before);
        return ok(`Layout '${layout}' added.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        await closeOpenDialog();
        return fail("add_layout", e, SNAP_HINT);
      }
    }
  );

  server.registerTool(
    "gsites_add_embed",
    {
      title: "Embed a web page or raw HTML",
      description: `Embed external content: either a public 'url' (iframe) or 'html' code (e.g. a custom widget, <iframe>, <style>+<div>). ${AT_END}
Provide exactly one of url / html.`,
      inputSchema: {
        url: z.string().url().optional().describe("Public https URL to embed"),
        html: z.string().optional().describe("Raw HTML/JS/CSS to embed"),
      },
      annotations: rw,
    },
    async ({ url, html }) => {
      try {
        if (!!url === !!html) throw new Error("provide exactly one of 'url' or 'html'");
        const page = await getPage();
        const before = await beginInsert(page);
        await clickInsertItem(page, /^(embed|insertar)$/i);
        if (html) {
          await page.getByText(/^(embed code|insertar código)$/i).first().click({ timeout: 8000 });
          await page.locator("[role=dialog] textarea").filter({ visible: true }).first().fill(html, { timeout: 8000 });
          await dialogButton(page, /^(next|siguiente|insert|insertar)$/i);
        } else {
          await page.locator("[role=dialog] input").filter({ visible: true }).first().fill(url!, { timeout: 8000 });
          await dialogButton(page, /^(insert|insertar)$/i);
        }
        await page.waitForTimeout(2500);
        // Embeds show a second confirmation step in some cases.
        const again = page.getByRole("button", { name: /^(insert|insertar)$/i }).filter({ visible: true });
        if (await again.count()) await again.last().click({ timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(2500);
        await fixOrder(page, before);
        return ok(`Embed added.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        await closeOpenDialog();
        return fail("add_embed", e, SNAP_HINT);
      }
    }
  );

  server.registerTool(
    "gsites_add_youtube",
    {
      title: "Add a YouTube video",
      description: `Embed a YouTube video from a URL or search words. ${AT_END}`,
      inputSchema: { query: z.string().min(2).describe("YouTube URL or search text") },
      annotations: rw,
    },
    async ({ query }) => {
      try {
        const page = await getPage();
        const before = await beginInsert(page);
        await clickInsertItem(page, /^youtube$/i);
        await pickFirstResult(page, query);
        await page.waitForTimeout(3000);
        await fixOrder(page, before);
        return ok(`YouTube video added.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        await closeOpenDialog();
        return fail("add_youtube", e, SNAP_HINT);
      }
    }
  );

  server.registerTool(
    "gsites_add_block",
    {
      title: "Add another Insert-panel block",
      description: `Insert a simple block that needs no input: ${Object.keys(BLOCKS).join(", ")}. For maps, Drive files, calendars, carousels and social icons use their own gsites_add_* tools. ${AT_END}`,
      inputSchema: { block: z.enum(Object.keys(BLOCKS) as [string, ...string[]]) },
      annotations: rw,
    },
    async ({ block }) => {
      try {
        const page = await getPage();
        const before = await beginInsert(page);
        await clickInsertItem(page, BLOCKS[block]);
        await page.waitForTimeout(2000);
        const dlg = await page.evaluate(() => {
          const d = document.querySelector("[role=dialog]") as HTMLElement | null;
          if (!d || !d.getBoundingClientRect().width) return "";
          return [...d.querySelectorAll("input,textarea,button,[role=tab],[role=button]")]
            .filter((e) => (e as HTMLElement).getBoundingClientRect().width)
            .map((e) => `${e.tagName.toLowerCase()}: ${(e.getAttribute("aria-label") || (e as HTMLElement).innerText || "").trim().slice(0, 40)}`)
            .filter((x) => !x.endsWith(": "))
            .join("\n");
        });
        if (!dlg) await fixOrder(page, before);
        return ok(
          dlg ? `'${block}' dialog is open. Controls:\n${dlg}` : `'${block}' added.\n\nPage outline:\n${await outline()}`
        );
      } catch (e) {
        await closeOpenDialog();
        return fail("add_block", e, SNAP_HINT);
      }
    }
  );

  server.registerTool(
    "gsites_list_sections",
    {
      title: "List page sections",
      description: "List the content sections of the open page, top to bottom, with a 1-based index and a preview (text, [image], [divider], [block]). Use these indexes in gsites_move_section / duplicate / delete.",
      inputSchema: {},
      annotations: ro,
    },
    async () => {
      try {
        return ok(await outline());
      } catch (e) {
        return fail("list_sections", e, "Open a site editor page first.");
      }
    }
  );

  server.registerTool(
    "gsites_move_section",
    {
      title: "Move a section",
      description: "Reorder the page: drag section `from` so that it ends up at position `to` (1-based, see gsites_list_sections). Returns the new outline.",
      inputSchema: { from: z.number().int().min(1), to: z.number().int().min(1) },
      annotations: rw,
    },
    async ({ from, to }) => {
      try {
        const page = await getPage();
        await moveSection(page, from, to);
        return ok(`Moved section ${from} to ${to}.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        return fail("move_section", e, "Call gsites_list_sections to check the indexes.");
      }
    }
  );

  server.registerTool(
    "gsites_duplicate_section",
    {
      title: "Duplicate a section",
      description: "Duplicate section `index` (1-based). The copy appears right below it.",
      inputSchema: { index: z.number().int().min(1) },
      annotations: rw,
    },
    async ({ index }) => {
      try {
        const page = await getPage();
        await selectSection(page, index);
        await selectedSectionButton(page, /^(duplicar sección|duplicate section)$/i);
        await page.waitForTimeout(1200);
        return ok(`Section ${index} duplicated.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        return fail("duplicate_section", e, "Call gsites_list_sections to check the index.");
      }
    }
  );

  server.registerTool(
    "gsites_delete_section",
    {
      title: "Delete a section",
      description: "Delete section `index` (1-based) from the page. Destructive (undo with the editor's Ctrl+Z via gsites_press_key). Confirm with the user first.",
      inputSchema: { index: z.number().int().min(1) },
      annotations: del,
    },
    async ({ index }) => {
      try {
        const page = await getPage();
        await selectSection(page, index);
        await selectedSectionButton(page, /^(eliminar sección|delete section)$/i);
        await page.waitForTimeout(1200);
        return ok(`Section ${index} deleted.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        return fail("delete_section", e, "Call gsites_list_sections to check the index.");
      }
    }
  );

  server.registerTool(
    "gsites_set_page_title",
    {
      title: "Set the big page title",
      description: "Replace the large title shown in the page header (default 'Título de la página').",
      inputSchema: { title: z.string().min(1).max(120) },
      annotations: rw,
    },
    async ({ title }) => {
      try {
        const page = await getPage();
        await scrollPageTop(page);
        // The big header title sits in the middle of the header banner.
        await page.mouse.click(568, 255);
        await page.waitForTimeout(500);
        await page.keyboard.press("Control+A");
        await typeText(page, title, 10);
        await page.waitForTimeout(800);
        return ok(`Page title set to '${title}'.`);
      } catch (e) {
        return fail("set_page_title", e, SNAP_HINT);
      }
    }
  );
}
