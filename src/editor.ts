import type { Page } from "playwright";

// Helpers that drive the Google Sites editor. Labels are matched in Spanish and English.
// Sites inserts new content right AFTER the currently selected section (at the top if nothing is selected).

export const STYLES = {
  normal: "docstext-heading-0",
  title: "docstext-heading-1",
  heading: "docstext-heading-2",
  subtitle: "docstext-heading-3",
  small: "docstext-heading-small-text",
} as const;
export type TextStyle = keyof typeof STYLES;

export const ALIGN = { left: "left", center: "center", right: "right", justify: "justify" } as const;

export const LAYOUTS = [
  "image_caption",
  "two_columns",
  "three_images",
  "three_columns",
  "two_columns_side_captions",
  "four_columns",
] as const;
export type Layout = (typeof LAYOUTS)[number];

export const BLOCKS: Record<string, RegExp> = {
  collapsible_group: /^(grupo que se puede ocultar|collapsible group)$/i,
  table_of_contents: /^(índice|table of contents)$/i,
  spacer: /^(separador|spacer)$/i,
  placeholder: /^(marcador de posición|placeholder)$/i,
};

export const DRIVE_KINDS: Record<string, RegExp> = {
  docs: /^(documentos|docs)$/i,
  slides: /^(presentaciones|slides)$/i,
  sheets: /^(hojas de cálculo|sheets)$/i,
  forms: /^(formularios|forms)$/i,
  charts: /^(gráficos|charts)$/i,
  calendar: /^calendar$/i,
};

export interface SectionInfo {
  index: number; // 1-based, header excluded
  top: number;
  bottom: number;
  left: number;
  right: number;
  preview: string;
  id: string; // stable data-id of the <section>; never changes when the content of a block changes
}

export async function openInsertTab(page: Page): Promise<void> {
  const tab = page.getByRole("tab", { name: /^(insert|insertar)$/i });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click({ timeout: 8000 });
}

/** Content sections of the current page, top to bottom (the page header is excluded). */
export async function listSections(page: Page): Promise<SectionInfo[]> {
  const read = () =>
    page.evaluate(() => {
      // Sections are sibling <section> elements; the selected one changes its aria-label, so match by structure.
      const first = document.querySelector('section[aria-label^="Sección"], section[aria-label^="Section"]');
      const els = (first ? [...(first.parentElement as HTMLElement).children].filter((c) => c.tagName === "SECTION") : []) as HTMLElement[];
      return els
        .map((e) => {
          const r = e.getBoundingClientRect();
          // Preview from a clone without editor chrome (toolbars, menus, buttons).
          const clone = e.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('button, [role=toolbar], [role=option], [role=listbox], [role=menu], [role=menuitem], [aria-label*="ección"], [aria-label*="ection"]').forEach((n) => n.remove());
          let kind = (clone.innerText || "").split("\n").map((t) => t.trim()).filter(Boolean).join(" | ").replace(/(Haz clic para editar el texto|Click to edit text|Lato|Negrita|Texto normal).*$/s, "").trim().slice(0, 60);
          if (e.querySelector("img") && /(Recortar imagen|Crop image|Anular recorte)/i.test(kind)) kind = "";
          kind = kind.replace(/(Eliminar sección|Delete section)/gi, "").replace(/^[| ]+|[| ]+$/g, "");
          if (!kind) {
            kind = e.querySelector("img") ? "[image]" : e.querySelector("iframe") ? "[embed]" : e.querySelector("hr") ? "[divider]" : "[block]";
          }
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height, kind, id: e.getAttribute("data-id") ?? "" };
        })
        .filter((x) => x.w > 0 && x.h > 0)
        .sort((x, y) => x.top - y.top);
    });
  // The DOM updates asynchronously after an edit: read until two reads agree.
  let prev = await read();
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(500);
    const cur = await read();
    if (cur.length === prev.length && cur.every((c, j) => c.kind === prev[j].kind)) {
      prev = cur;
      break;
    }
    prev = cur;
  }
  // The first element is the page header.
  return prev.slice(1).map((s, i) => ({ index: i + 1, top: s.top, bottom: s.bottom, left: s.left, right: s.right, preview: s.kind, id: s.id }));
}

/** Scroll the page canvas so that the given viewport y of an element ends at `target`. */
async function scrollCanvasBy(page: Page, delta: number): Promise<void> {
  await page.evaluate((d) => {
    let best: HTMLElement | null = null;
    for (const e of document.querySelectorAll("*")) {
      const el = e as HTMLElement;
      if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 300 && (!best || el.scrollHeight > best.scrollHeight)) best = el;
    }
    if (best) best.scrollTop += d;
  }, delta);
  await page.waitForTimeout(400);
}

async function scrollToSection(page: Page, index: number): Promise<SectionInfo> {
  let list = await listSections(page);
  if (index < 1 || index > list.length) throw new Error(`section ${index} does not exist (page has ${list.length} content sections)`);
  const s = list[index - 1];
  if (s.top < 140 || s.bottom > 840) {
    await scrollCanvasBy(page, s.top - 260);
    list = await listSections(page);
  }
  return list[index - 1];
}

/** Click a blank spot of the section so it becomes the selected one. */
export async function selectSection(page: Page, index: number): Promise<SectionInfo> {
  const s = await scrollToSection(page, index);
  await page.mouse.click(s.right - 15, (s.top + s.bottom) / 2);
  await page.waitForTimeout(500);
  return s;
}

export async function selectLastSection(page: Page): Promise<void> {
  const list = await listSections(page);
  if (list.length) await selectSection(page, list.length);
}

export async function selectedSectionButton(page: Page, name: RegExp): Promise<void> {
  await page.getByRole("button", { name }).filter({ visible: true }).first().click({ timeout: 6000 });
}

/** Drag one section past its neighbour; both stay on screen. */
async function hopSection(page: Page, from: number, up: boolean): Promise<void> {
  // Keep the drop target away from the canvas edges: dragging near them makes Sites auto-scroll and overshoot.
  const nb0 = (await listSections(page))[up ? from - 2 : from];
  await scrollCanvasBy(page, up ? nb0.top - 240 : nb0.bottom - 640);
  const src = await selectSection(page, from);
  const neighbour = (await listSections(page))[up ? from - 2 : from];
  const y0 = (src.top + src.bottom) / 2;
  const y1 = Math.min(Math.max(up ? neighbour.top + 12 : neighbour.bottom - 12, 100), 860);
  if (process.env.GSITES_DEBUG) console.error(`hop ${from} ${up ? "up" : "down"}: src ${Math.round(src.top)}-${Math.round(src.bottom)} neighbour ${Math.round(neighbour.top)}-${Math.round(neighbour.bottom)} y0=${Math.round(y0)} y1=${Math.round(y1)}`);
  const m = page.mouse;
  await m.move(70, y0);
  await m.down();
  const step = y1 > y0 ? 12 : -12;
  for (let y = y0; step > 0 ? y < y1 : y > y1; y += step) {
    await m.move(70, y, { steps: 2 });
    await page.waitForTimeout(25);
  }
  await m.move(70, y1, { steps: 3 });
  await page.waitForTimeout(250);
  await m.up();
  await page.waitForTimeout(1200);
}

export async function moveSection(page: Page, from: number, to: number): Promise<void> {
  const total = (await listSections(page)).length;
  if (from < 1 || from > total || to < 1 || to > total) throw new Error(`positions must be within 1..${total}`);
  let pos = from;
  while (pos !== to) {
    const up = to < pos;
    await hopSection(page, pos, up);
    pos += up ? -1 : 1;
  }
}

export async function setTextStyle(page: Page, style: TextStyle): Promise<void> {
  if (style === "normal") return;
  const option = page.locator(`[role=option][data-value="${STYLES[style]}"]`).filter({ visible: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(500);
    if (!(await option.count())) {
      await page.locator('[role=option][data-value="docstext-heading-0"]').filter({ visible: true }).first().click({ timeout: 6000 });
      await page.waitForTimeout(500);
    }
    if (await option.count()) {
      await option.first().click({ timeout: 6000 });
      await page.waitForTimeout(400);
      return;
    }
  }
  throw new Error(`could not open the text style menu for '${style}'`);
}

export async function setAlign(page: Page, align: keyof typeof ALIGN): Promise<void> {
  if (align === "left") return;
  await page.locator('[data-value="docstext-paragraph-alignment-left"]').filter({ visible: true }).first().click({ timeout: 6000 });
  await page.waitForTimeout(400);
  await page.locator(`[data-value="docstext-paragraph-alignment-${align}"]`).filter({ visible: true }).first().click({ timeout: 6000 });
  await page.waitForTimeout(400);
}

export async function scrollPageTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const e of document.querySelectorAll("*")) if (e.scrollTop > 0) e.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
}

export async function clickInsertItem(page: Page, name: RegExp): Promise<void> {
  await openInsertTab(page);
  const item = page.getByRole("menuitem", { name }).first();
  await item.scrollIntoViewIfNeeded().catch(() => undefined);
  await item.click({ timeout: 8000 });
}

export async function dialogButton(page: Page, name: RegExp): Promise<void> {
  await page.getByRole("button", { name }).filter({ visible: true }).last().click({ timeout: 8000 });
}

/** Identity of each section: preview plus rounded height (enough to tell old from new sections). */
export async function signature(page: Page): Promise<string[]> {
  // Identify sections by their stable data-id. Comparing previews breaks on blocks whose text changes by itself
  // (e.g. the table of contents lists every heading), which made the old reorder logic drag them to the end.
  return (await listSections(page)).map((s) => s.id || `${s.preview}|${Math.round(s.bottom - s.top)}`);
}

/**
 * After an insertion, make sure the new section(s) sit at the end of the page. Sites inserts after the
 * selected section, and the selection can miss, so compare against the signature taken before inserting.
 */
export async function moveNewSectionsToEnd(page: Page, before: string[]): Promise<void> {
  const after = await signature(page);
  const known = new Set(before);
  const fresh = after.map((id, i) => (known.has(id) ? -1 : i)).filter((i) => i >= 0);
  if (!fresh.length) return;
  const added = fresh.length;
  if (fresh.every((p, k) => p === after.length - added + k)) return; // already at the end
  for (let j = 0; j < added; j++) await moveSection(page, fresh[0] + 1, after.length);
}

/** Put the section(s) created since `before` right after section `target` (0 = top). Returns how many were added. */
export async function placeNewSectionsAt(page: Page, before: string[], target: number): Promise<number> {
  const after = await signature(page);
  const known = new Set(before);
  const fresh = after.map((id, i) => (known.has(id) ? -1 : i)).filter((i) => i >= 0);
  if (!fresh.length) return 0;
  if (fresh[0] !== target) await moveSection(page, fresh[0] + 1, target + 1);
  return fresh.length;
}

/** Wait for the Google picker iframe (YouTube, Drive files, Calendar) that Sites opens in docs.google.com/picker. */
export async function waitForPicker(page: Page): Promise<import("playwright").Frame> {
  // Old picker iframes can linger in the page: use the one that is actually showing a search box or results.
  for (let i = 0; i < 30; i++) {
    for (const f of page.frames().filter((fr) => /docs\.google\.com\/picker/.test(fr.url()) && !fr.isDetached())) {
      const shown = await f.locator("input[placeholder], [role=option], [role=checkbox]").filter({ visible: true }).count().catch(() => 0);
      if (shown) return f;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("the Google picker did not open");
}

/** Search inside the picker (if a query is given), pick the first result and press its Insert button. */
export async function pickFirstResult(page: Page, query?: string): Promise<void> {
  const picker = await waitForPicker(page);
  if (query) {
    const box = picker.locator("input[placeholder]").filter({ visible: true }).first();
    await box.fill(query, { timeout: 10000 });
    await box.press("Enter");
  }
  // Drive/YouTube results are options; calendars are checkboxes.
  const option = picker.locator("[role=option], [role=checkbox]").first();
  await option.waitFor({ timeout: 12000 });
  await option.click({ timeout: 8000 });
  await picker.locator("button", { hasText: /^\s*(insertar|insert|seleccionar|select)/i }).first().click({ timeout: 8000 });
}
