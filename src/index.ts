#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getPage, closeBrowser, PROFILE_DIR } from "./browser.js";
import { CHARACTER_LIMIT, ok, fail, SNAP_HINT, rw, ro } from "./util.js";
import { registerContentTools } from "./content-tools.js";
import { registerDriveTools } from "./drive-tools.js";

const server = new McpServer({ name: "google-sites-mcp-server", version: "0.2.0" });

// Escape a string for use inside a double-quoted CSS attribute selector.
const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

server.registerTool(
  "gsites_open",
  {
    title: "Open a Google Sites URL",
    description: `Open a URL in the controlled browser (a visible Chromium with a persistent Google login).
Use 'https://sites.google.com/new' to start a new site, 'https://sites.google.com/' for the site list, or an edit URL like 'https://sites.google.com/u/0/d/<id>/edit'.
First time only: if a Google login page appears, ask the user to sign in manually in the opened window (profile stored at ${PROFILE_DIR}), then call this again.
Returns the final URL and page title.`,
    inputSchema: { url: z.string().url().describe("Full URL, e.g. https://sites.google.com/new") },
    annotations: ro,
  },
  async ({ url }) => {
    try {
      const page = await getPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const final = page.url();
      const login = /accounts\.google\.com/.test(final);
      return ok(
        `URL: ${final}\nTitle: ${await page.title()}${
          login ? "\nNOT SIGNED IN: ask the user to log in in the browser window, then call gsites_open again." : ""
        }`
      );
    } catch (e) {
      return fail("open", e, "Check the URL and your connection.");
    }
  }
);

server.registerTool(
  "gsites_snapshot",
  {
    title: "Snapshot editor state",
    description:
      "Return a compact text snapshot of the current page: URL, title, and the visible buttons/links/textboxes/headings (role + accessible name). Use it to discover exact labels before gsites_click / gsites_type. Cheaper than a screenshot.",
    inputSchema: {},
    annotations: ro,
  },
  async () => {
    try {
      const page = await getPage();
      const items = await page.evaluate(() => {
        const sel =
          "button,a[href],[role=button],[role=tab],[role=menuitem],[role=option],input,textarea,[contenteditable=true],h1,h2,h3";
        const out: string[] = [];
        document.querySelectorAll(sel).forEach((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          const name = (
            el.getAttribute("aria-label") ||
            (el as HTMLElement).innerText ||
            el.getAttribute("placeholder") ||
            ""
          )
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 80);
          if (!name) return;
          out.push(`${el.getAttribute("role") || el.tagName.toLowerCase()}: ${name}`);
        });
        return Array.from(new Set(out));
      });
      return ok(`URL: ${page.url()}\nTitle: ${await page.title()}\n\n${items.join("\n")}`);
    } catch (e) {
      return fail("snapshot", e, "Open a page first with gsites_open.");
    }
  }
);

server.registerTool(
  "gsites_screenshot",
  {
    title: "Screenshot",
    description:
      "Take a PNG screenshot of the current browser page so you can see the editor layout. Use when gsites_snapshot is not enough (e.g. to locate drop zones or verify visual results).",
    inputSchema: {},
    annotations: ro,
  },
  async () => {
    try {
      const page = await getPage();
      const buf = await page.screenshot({ type: "png" });
      return { content: [{ type: "image" as const, data: buf.toString("base64"), mimeType: "image/png" }] };
    } catch (e) {
      return fail("screenshot", e, "Open a page first with gsites_open.");
    }
  }
);

server.registerTool(
  "gsites_click",
  {
    title: "Click an element by visible text",
    description: `Click a button, tab, menu item or link by its visible text or aria-label (case-insensitive substring). Examples: 'Publish', 'Pages', 'Insert', 'Text box', 'Themes'.
If several elements match, 'index' picks which one (0 = first). Clicking 'Publish' really publishes the site, so confirm with the user first.`,
    inputSchema: {
      text: z.string().min(1).describe("Visible text or aria-label, e.g. 'Insert'"),
      index: z.number().int().min(0).default(0).describe("Which match to click when several exist"),
    },
    annotations: rw,
  },
  async ({ text, index }) => {
    try {
      const page = await getPage();
      const t = q(text);
      const loc = page.locator(
        `[aria-label*="${t}" i], button:has-text("${t}"), [role=button]:has-text("${t}"), [role=tab]:has-text("${t}"), [role=menuitem]:has-text("${t}"), a:has-text("${t}")`
      );
      const n = await loc.count();
      if (n === 0) throw new Error(`no element matches '${text}'`);
      const i = Math.min(index, n - 1);
      await loc.nth(i).click({ timeout: 8000 });
      await page.waitForTimeout(800);
      return ok(`Clicked '${text}' (match ${i + 1} of ${n}).`);
    } catch (e) {
      return fail("click", e, SNAP_HINT);
    }
  }
);

server.registerTool(
  "gsites_type",
  {
    title: "Type text",
    description:
      "Type text into the currently focused field/box, or first click a field by label. Use 'target' (placeholder or aria-label, e.g. 'Site title', 'Page title') to focus a field; omit it to type into whatever is focused. 'press_enter' sends Enter afterwards.",
    inputSchema: {
      text: z.string().describe("Text to type"),
      target: z.string().optional().describe("Placeholder/aria-label of the field to focus first"),
      clear_first: z.boolean().default(false).describe("Select all and replace existing content"),
      press_enter: z.boolean().default(false),
    },
    annotations: rw,
  },
  async ({ text, target, clear_first, press_enter }) => {
    try {
      const page = await getPage();
      if (target) {
        const t = q(target);
        await page.locator(`[aria-label*="${t}" i], [placeholder*="${t}" i]`).first().click({ timeout: 8000 });
      }
      if (clear_first) await page.keyboard.press("Control+A");
      await page.keyboard.type(text, { delay: 15 });
      if (press_enter) await page.keyboard.press("Enter");
      return ok(`Typed ${text.length} chars${target ? ` into '${target}'` : ""}.`);
    } catch (e) {
      return fail("type", e, SNAP_HINT);
    }
  }
);

server.registerTool(
  "gsites_press_key",
  {
    title: "Press a key",
    description: "Press a keyboard key or combo in the browser (Playwright syntax): 'Enter', 'Escape', 'Tab', 'Control+Z', 'Control+B'.",
    inputSchema: { key: z.string().min(1) },
    annotations: rw,
  },
  async ({ key }) => {
    try {
      await (await getPage()).keyboard.press(key);
      return ok(`Pressed ${key}.`);
    } catch (e) {
      return fail("press_key", e, "Use Playwright key names such as 'Enter' or 'Control+A'.");
    }
  }
);

server.registerTool(
  "gsites_create_site",
  {
    title: "Create a new blank Google Site",
    description:
      "Workflow: open the new-site page, start a blank site and set its name. Returns the editor URL. Creates a new draft site in the user's Drive (not published). Requires being signed in (see gsites_open).",
    inputSchema: { title: z.string().min(1).max(100).describe("Site name, e.g. 'My portfolio'") },
    annotations: rw,
  },
  async ({ title }) => {
    try {
      const page = await getPage();
      await page.goto("https://sites.google.com/new", { waitUntil: "domcontentloaded" });
      if (/accounts\.google\.com/.test(page.url())) throw new Error("not signed in");
      await page.waitForTimeout(2500);
      await page.getByRole("option", { name: /blank|en blanco/i }).first().click({ timeout: 10000 });
      await page.waitForTimeout(4000);
      const t = page
        .locator(
          'input[aria-label*="site name" i], input[aria-label*="nombre del sitio" i], [aria-label*="site title" i], [aria-label*="título del sitio" i]'
        )
        .first();
      await t.fill(title, { timeout: 10000 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1500);
      if ((await t.inputValue()) !== title) throw new Error(`site name is '${await t.inputValue()}', expected '${title}'`);
      return ok(`Site '${title}' created as draft. Editor URL: ${page.url()}`);
    } catch (e) {
      return fail(
        "create_site",
        e,
        "If not signed in, use gsites_open and ask the user to log in. Otherwise inspect with gsites_screenshot and drive manually with gsites_click/gsites_type."
      );
    }
  }
);

server.registerTool(
  "gsites_add_page",
  {
    title: "Add a page to the open site",
    description:
      "Workflow: in the open Sites editor, open the Pages panel and add a new page with the given name. Requires an editor tab open (gsites_create_site, or gsites_open with an /edit URL).",
    inputSchema: { name: z.string().min(1).max(100).describe("Page name, e.g. 'Proyectos'") },
    annotations: rw,
  },
  async ({ name }) => {
    try {
      const page = await getPage();
      await page.getByRole("tab", { name: /^(pages|páginas)$/i }).click({ timeout: 8000 });
      await page.waitForTimeout(600);
      const newPage = page.getByRole("button", { name: /new page|nueva página/i }).first();
      await newPage.click({ timeout: 8000 });
      // Scope to the "New page" popup: nearest ancestor of the Done button that contains an input.
      const done = page.getByRole("button", { name: /^(done|hecho)$/i });
      // The "+" button first expands on hover; click again if the popup did not open.
      if (!(await done.waitFor({ timeout: 3000 }).then(() => true, () => false))) {
        await newPage.click({ timeout: 8000 });
        await done.waitFor({ timeout: 8000 });
      }
      await done.locator("xpath=ancestor::*[.//input][1]").locator("input").first().fill(name, { timeout: 8000 });
      await done.click({ timeout: 8000 });
      await page.waitForTimeout(1500);
      const listed = await page.getByText(name, { exact: true }).count();
      if (!listed) throw new Error(`page '${name}' did not appear in the Pages list`);
      return ok(`Page '${name}' added.`);
    } catch (e) {
      return fail("add_page", e, SNAP_HINT);
    }
  }
);

server.registerTool(
  "gsites_get_text",
  {
    title: "Read visible text of the page",
    description: `Return the visible text of the current page/editor (truncated at ${CHARACTER_LIMIT} chars). Use to verify content after edits.`,
    inputSchema: {},
    annotations: ro,
  },
  async () => {
    try {
      const page = await getPage();
      return ok(await page.evaluate(() => document.body.innerText));
    } catch (e) {
      return fail("get_text", e, "Open a page first with gsites_open.");
    }
  }
);

server.registerTool(
  "gsites_close_browser",
  {
    title: "Close the browser",
    description: "Close the controlled browser. The Google login stays saved in the profile for next time.",
    inputSchema: {},
    annotations: ro,
  },
  async () => {
    await closeBrowser();
    return ok("Browser closed.");
  }
);

registerContentTools(server);
registerDriveTools(server);

process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});

await server.connect(new StdioServerTransport());
console.error("google-sites-mcp-server running on stdio");
