import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { getPage, getContext } from "./browser.js";
import { ok, fail, rw, typeText } from "./util.js";
import { clickInsertItem, listSections, selectSection, waitForPicker } from "./editor.js";
import { beginInsert, closeOpenDialog, fixOrder, outline } from "./content-tools.js";
import { insertPoint } from "./state.js";

// ---------------------------------------------------------------- resize helpers
type Frame = { x1: number; x2: number; y1: number; y2: number };

/**
 * Frame of the selected block, from its blue resize handles (16x16 round divs).
 * The top handles hide under the floating toolbar, so the top edge is derived from the middle handles when needed.
 */
async function frameOf(page: Page): Promise<Frame | null> {
  const h = (await page.evaluate(() =>
    [...document.querySelectorAll("div")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return Math.round(r.width) === 16 && Math.round(r.height) === 16 && r.x > 0 && r.x < 1140 && r.y > 60;
      })
      .map((e) => {
        const r = e.getBoundingClientRect();
        return [r.x + 8, r.y + 8];
      }),
  )) as number[][];
  if (h.length < 3) return null;
  const xs = h.map((p) => p[0]);
  const yBottom = Math.max(...h.map((p) => p[1]));
  const upper = h.filter((p) => p[1] < yBottom - 10).map((p) => p[1]);
  let y1 = yBottom - 150;
  if (upper.length) y1 = Math.min(...upper) < Math.max(...upper) - 10 ? Math.min(...upper) : 2 * Math.max(...upper) - yBottom;
  return { x1: Math.min(...xs), x2: Math.max(...xs), y1, y2: yBottom };
}

async function drag(page: Page, fx: number, fy: number, tx: number, ty: number): Promise<void> {
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move((fx + tx) / 2, (fy + ty) / 2, { steps: 10 });
  await page.mouse.move(tx, ty, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(1800);
}

/** Natural width/height of the image inside a section (read from its background image), or null. */
async function naturalAspect(page: Page, top: number, bottom: number): Promise<number | null> {
  return page.evaluate(
    ({ top, bottom }) => {
      const el = [...document.querySelectorAll("*")].find((e) => {
        const r = e.getBoundingClientRect();
        return getComputedStyle(e).backgroundImage.includes("sites-images-rt") && r.top >= top - 5 && r.bottom <= bottom + 5 && r.width > 50;
      });
      if (!el) return null;
      const m = getComputedStyle(el).backgroundImage.match(/url\("?([^")]+)"?\)/);
      if (!m) return null;
      return new Promise<number | null>((res) => {
        const im = new Image();
        im.onload = () => res(im.naturalWidth / im.naturalHeight);
        im.onerror = () => res(null);
        im.src = m[1];
      });
    },
    { top, bottom },
  );
}

export function registerExtraTools(server: McpServer): void {
  // ------------------------------------------------------------ insert point
  server.registerTool(
    "gsites_set_insert_point",
    {
      title: "Choose where the next blocks are inserted",
      description:
        "EXPERIMENTAL - in a live test, after=0 placed the first block in the wrong spot and was slow (every move hops one position at a time); verify with gsites_list_sections after use. " +
        "By default every gsites_add_* tool appends at the END of the page. Call this with after=N to insert right after section N (0 = very top of the page); " +
        "the point then advances by itself, so a sequence of add_* calls stays in order. after=-1 restores 'append at the end'. " +
        "Use it to put a table of contents or an intro at the top without dragging blocks around (dragging is slow on long pages).",
      inputSchema: { after: z.number().int().min(-1).describe("Section number to insert after (0 = top); -1 = append at the end") },
      annotations: rw,
    },
    async ({ after }) => {
      insertPoint.after = after < 0 ? null : after;
      return ok(after < 0 ? "Insert point reset: new content goes at the end of the page." : `Insert point set: new content goes after section ${after} and advances automatically.`);
    },
  );

  // ------------------------------------------------------------ resize
  server.registerTool(
    "gsites_resize_block",
    {
      title: "Resize an image or embed",
      description:
        "Resize the image/embed section `index` by dragging its corner handle. Images inserted by gsites_add_image arrive small (about 283 px); " +
        "pass width (px; the content column is about 898 px wide) and the height follows the image's own proportions. " +
        "For embeds/videos pass `aspect` (width/height, e.g. 1.7778) or `height`. Never stretches: the height is always adjusted to the width that the editor actually accepted.",
      inputSchema: {
        index: z.number().int().min(1).describe("1-based section index (see gsites_list_sections)"),
        width: z.number().min(100).max(1000).describe("Target width in px (max about 898 for a full-width image)"),
        height: z.number().min(40).max(1500).optional(),
        aspect: z.number().min(0.2).max(6).optional(),
      },
      annotations: rw,
    },
    async ({ index, width, height, aspect }) => {
      try {
        const page = await getPage();
        await selectSection(page, index);
        let s = (await listSections(page))[index - 1];
        if (Math.abs(s.top - 105) > 6) {
          await page.mouse.move(600, 450);
          await page.mouse.wheel(0, s.top - 105);
          await page.waitForTimeout(900);
          s = (await listSections(page))[index - 1];
        }
        const ratio = aspect ?? (height ? width / height : await naturalAspect(page, s.top, s.bottom));
        if (!ratio) throw new Error("could not read the image proportions; pass `aspect` or `height`");
        await page.mouse.click(s.left + 150, s.top + Math.min(70, (s.bottom - s.top) / 2));
        await page.waitForTimeout(1200);
        let f = await frameOf(page);
        if (!f) throw new Error("no resize handles found: is section " + index + " an image or embed?");
        await drag(page, f.x2, f.y2, f.x1 + width, f.y1 + width / ratio);
        f = await frameOf(page);
        if (f) {
          const wantH = (f.x2 - f.x1) / ratio;
          if (Math.abs(f.y2 - f.y1 - wantH) > 3) {
            await drag(page, (f.x1 + f.x2) / 2, f.y2, (f.x1 + f.x2) / 2, f.y1 + wantH);
            f = await frameOf(page);
          }
        }
        await page.keyboard.press("Escape");
        return ok(f ? `Section ${index} is now ${Math.round(f.x2 - f.x1)} x ${Math.round(f.y2 - f.y1)} px.` : `Section ${index} resized (could not re-measure).`);
      } catch (e) {
        return fail("resize_block", e, "Use gsites_screenshot to check the block is selectable.");
      }
    },
  );

  // ------------------------------------------------------------ Drive
  server.registerTool(
    "gsites_upload_to_drive",
    {
      title: "Upload a local file to Google Drive",
      description:
        "Upload a local file (video, PDF, zip...) to 'My Drive' through the Drive web UI, in a separate tab so the editor is untouched. " +
        "It does NOT change sharing. Afterwards embed it with gsites_add_drive_file.",
      inputSchema: { file_path: z.string().min(1).describe("Absolute path of the file") },
      annotations: rw,
    },
    async ({ file_path }) => {
      let tab: Page | null = null;
      try {
        if (!fs.existsSync(file_path)) throw new Error(`file not found: ${file_path}`);
        tab = await (await getContext()).newPage();
        await tab.goto("https://drive.google.com/drive/my-drive");
        await tab.waitForTimeout(5000);
        await tab.getByRole("button", { name: /^(nuevo|new)$/i }).first().click({ timeout: 10000 });
        await tab.waitForTimeout(1200);
        const [fc] = await Promise.all([
          tab.waitForEvent("filechooser", { timeout: 10000 }),
          tab.getByRole("menuitem", { name: /(subir archivo|subida de archivos|file upload)/i }).first().click({ timeout: 10000 }),
        ]);
        await fc.setFiles(file_path);
        let done = false;
        for (let i = 0; i < 90 && !done; i++) {
          await tab.waitForTimeout(2000);
          done = await tab.getByText(/(subida completada|upload complete)/i).first().isVisible().catch(() => false);
        }
        if (!done) throw new Error("upload did not report completion within 3 minutes");
        return ok(`Uploaded ${path.basename(file_path)} to My Drive (private; sharing unchanged).`);
      } catch (e) {
        return fail("upload_to_drive", e, "Check you are signed in to Google Drive in the controlled browser.");
      } finally {
        await tab?.close().catch(() => undefined);
      }
    },
  );

  server.registerTool(
    "gsites_add_drive_file",
    {
      title: "Embed any file from My Drive (video, PDF...)",
      description:
        "Insert any Drive file by name through the generic Insert > Drive picker (the typed variants only cover Docs/Slides/Sheets/Forms/Charts/Calendar). " +
        "Sites then asks whether to share the file with the site's audience: by default this tool answers 'No compartir' (does not change sharing). " +
        "Pass share='link_viewer' ONLY when the user explicitly agreed to make the file viewable by anyone with the link.",
      inputSchema: {
        query: z.string().min(2).describe("Part of the file name"),
        share: z.enum(["none", "link_viewer"]).default("none"),
      },
      annotations: rw,
    },
    async ({ query, share }) => {
      try {
        const page = await getPage();
        const before = await beginInsert(page);
        await clickInsertItem(page, /^drive$/i);
        const picker = await waitForPicker(page);
        await picker.getByRole("button", { name: /^(buscar|search)$/i }).first().click({ timeout: 6000 }).catch(() => undefined);
        await page.waitForTimeout(600);
        await typeText(page, query, 15);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(3500);
        await picker.locator("[role=option], [role=checkbox], [data-id]").first().click({ timeout: 8000 });
        await page.waitForTimeout(600);
        await picker.locator("button, [role=button]").filter({ hasText: /^\s*(insertar|insert)/i }).first().click({ timeout: 8000 });
        await page.waitForTimeout(3000);
        const answer = share === "link_viewer" ? /^(compartir|share)$/i : /^(no compartir|don.t share)$/i;
        await page.getByRole("button", { name: answer }).filter({ visible: true }).first().click({ timeout: 6000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        await fixOrder(page, before);
        return ok(`Drive file matching '${query}' added (sharing: ${share}).\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        await closeOpenDialog();
        return fail("add_drive_file", e, "Upload it first with gsites_upload_to_drive; check the name; use gsites_screenshot to inspect the picker.");
      }
    },
  );

  // ------------------------------------------------------------ navigation by name
  server.registerTool(
    "gsites_open_site",
    {
      title: "Open one of your sites in the editor by its name",
      description: "Go to the Sites home and open the site whose name contains `name`. Returns the editor URL. Avoids copying site ids by hand (they are easy to mistype).",
      inputSchema: { name: z.string().min(1) },
      annotations: rw,
    },
    async ({ name }) => {
      try {
        const page = await getPage();
        await page.goto("https://sites.google.com/u/0/");
        await page.waitForTimeout(3000);
        await page.getByText(name).filter({ visible: true }).first().click({ timeout: 8000 });
        await page.waitForTimeout(5000);
        return ok(`Opened: ${page.url()}\nTitle: ${await page.title()}`);
      } catch (e) {
        return fail("open_site", e, "Check the site name on the Sites home (gsites_open https://sites.google.com/u/0/ + gsites_snapshot).");
      }
    },
  );

  server.registerTool(
    "gsites_open_page",
    {
      title: "Open a page of the open site by its name",
      description: "In the open site's editor, use the Pages panel (expanding collapsed groups) and open the page named exactly `name`. Returns the editor URL of that page.",
      inputSchema: { name: z.string().min(1) },
      annotations: rw,
    },
    async ({ name }) => {
      try {
        const page = await getPage();
        await page.getByRole("tab", { name: /^(páginas|pages)$/i }).first().click({ timeout: 6000 });
        await page.waitForTimeout(800);
        for (let i = 0; i < 6; i++) {
          const toggle = page.getByRole("button", { name: /^(mostrar|show)/i }).filter({ visible: true }).first();
          if (!(await toggle.isVisible().catch(() => false))) break;
          await toggle.click({ timeout: 3000 }).catch(() => undefined);
          await page.waitForTimeout(500);
        }
        await page.getByText(name, { exact: true }).filter({ visible: true }).first().click({ timeout: 8000 });
        await page.waitForTimeout(4000);
        return ok(`Opened page '${name}': ${page.url()}`);
      } catch (e) {
        return fail("open_page", e, "Open the site first (gsites_open_site) and check the page name in the Pages panel.");
      }
    },
  );
}
