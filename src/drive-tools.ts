import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs";
import { getPage } from "./browser.js";
import { ok, fail, SNAP_HINT, rw } from "./util.js";
import { DRIVE_KINDS, clickInsertItem, dialogButton, pickFirstResult } from "./editor.js";
import { AT_END, beginInsert, closeOpenDialog, fixOrder, outline } from "./content-tools.js";

export function registerDriveTools(server: McpServer): void {
  server.registerTool(
    "gsites_publish",
    {
      title: "Publish the open site",
      description: "Publish the site open in the editor. 'address' is the last part of the web address (letters, numbers, hyphens); omit it to accept Google's suggestion. Visibility is whatever the site is already set to (for a Workspace account the default is the whole organization, not the public internet). This makes the site visible to others, so ONLY call it after the user has confirmed.",
      inputSchema: { address: z.string().regex(/^[a-z0-9-]+$/).optional().describe("e.g. 'mi-portafolio'") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address }) => {
      try {
        const page = await getPage();
        await page.getByRole("button", { name: /^(publish|publicar)$/i }).first().click({ timeout: 8000 });
        const field = page.locator("[role=dialog] input").filter({ visible: true }).first();
        await field.waitFor({ timeout: 8000 });
        if (address) await field.fill(address, { timeout: 6000 });
        const chosen = await field.inputValue();
        const audience = (await page.locator("[role=dialog]").filter({ visible: true }).first().innerText().catch(() => "")).replace(/\s+/g, " ");
        await page.getByText(/^(publish|publicar)$/i).filter({ visible: true }).last().click({ timeout: 8000 });
        await page.waitForTimeout(5000);
        return ok(`Published at address '${chosen}'. Dialog said: ${audience.slice(0, 200)}
URL: ${page.url()}`);
      } catch (e) {
        await closeOpenDialog();
        return fail("publish", e, SNAP_HINT);
      }
    }
  );

  server.registerTool(
    "gsites_unpublish",
    {
      title: "Unpublish the open site",
      description: "Stop publishing the site open in the editor (menu next to Publish > Unpublish). The draft stays in Drive. Confirm with the user first.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const page = await getPage();
        const publish = page.getByRole("button", { name: /^(publish|publicar)$/i }).first();
        const box = await publish.boundingBox();
        if (!box) throw new Error("the Publish button is not visible");
        // The drop-down arrow is the small half of the split button, right next to it.
        await page.mouse.click(box.x + box.width + 14, box.y + box.height / 2);
        const item = page.getByRole("menuitem", { name: /^(dejar de publicar|unpublish)$/i }).filter({ visible: true }).first();
        await item.hover({ timeout: 6000 });
        await page.waitForTimeout(400);
        await item.click({ timeout: 6000, delay: 120 });
        // Confirmation dialog: "This site will no longer be public" -> Got it.
        await page.getByText(/^(entendido|got it|ok|aceptar)$/i).filter({ visible: true }).last().click({ timeout: 8000 });
        await page.waitForTimeout(3000);
        // Verify: a published site has "Unpublish" in the menu next to the Publish button.
        const box2 = await page.getByRole("button", { name: /^(publish|publicar)$/i }).first().boundingBox();
        if (box2) await page.mouse.click(box2.x + box2.width + 14, box2.y + box2.height / 2);
        await page.waitForTimeout(800);
        const stillPublished = await page.getByText(/^(dejar de publicar|unpublish)$/i).filter({ visible: true }).count();
        await page.keyboard.press("Escape");
        if (stillPublished) throw new Error("the site still shows as published");
        return ok("Site unpublished.");
      } catch (e) {
        await closeOpenDialog();
        return fail("unpublish", e, SNAP_HINT);
      }
    }
  );

  server.registerTool(
    "gsites_add_map",
    {
      title: "Add a Google Map",
      description: `Embed a Google Map for a place or address, e.g. 'Plaza Mayor, Madrid'. ${AT_END}`,
      inputSchema: { place: z.string().min(2).describe("Place name or address to search on Google Maps") },
      annotations: rw,
    },
    async ({ place }) => {
      try {
        const page = await getPage();
        const before = await beginInsert(page);
        await clickInsertItem(page, /^(map|mapa)$/i);
        const box = page.getByPlaceholder(/buscar en google maps|search google maps/i);
        await box.fill(place, { timeout: 10000 });
        await box.press("Enter");
        await page.waitForTimeout(3000);
        await page.getByRole("button", { name: /^(seleccionar|select)$/i }).filter({ visible: true }).last().click({ timeout: 8000 });
        await page.waitForTimeout(2500);
        await fixOrder(page, before);
        return ok(`Map for '${place}' added.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        await closeOpenDialog();
        return fail("add_map", e, SNAP_HINT);
      }
    }
  );

  server.registerTool(
    "gsites_add_drive_item",
    {
      title: "Embed a Google Drive file or calendar",
      description: `Embed a file from the user's Google Drive: kind = ${Object.keys(DRIVE_KINDS).join(" | ")}. 'query' searches the Drive (for calendar it filters the user's calendars) and the FIRST result is inserted, so use a specific query. ${AT_END}`,
      inputSchema: {
        kind: z.enum(Object.keys(DRIVE_KINDS) as [string, ...string[]]),
        query: z.string().min(2).describe("Search text, e.g. the file name"),
      },
      annotations: rw,
    },
    async ({ kind, query }) => {
      try {
        const page = await getPage();
        const before = await beginInsert(page);
        await clickInsertItem(page, DRIVE_KINDS[kind]);
        await pickFirstResult(page, query);
        await page.waitForTimeout(3000);
        await fixOrder(page, before);
        return ok(`${kind} item for '${query}' added.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        await closeOpenDialog();
        return fail("add_drive_item", e, "Check the query matches a file or calendar you own; use gsites_screenshot to inspect.");
      }
    }
  );

  server.registerTool(
    "gsites_add_carousel",
    {
      title: "Add an image carousel",
      description: `Create an image carousel from local image files (2 or more recommended). ${AT_END}`,
      inputSchema: { file_paths: z.array(z.string().min(1)).min(1).max(12).describe("Absolute paths of images") },
      annotations: rw,
    },
    async ({ file_paths }) => {
      try {
        for (const f of file_paths) if (!fs.existsSync(f)) throw new Error(`file not found: ${f}`);
        const page = await getPage();
        const before = await beginInsert(page);
        await clickInsertItem(page, /^(image carousel|carrusel de imágenes)$/i);
        await page.getByRole("button", { name: /^(add image|añadir imagen)$/i }).filter({ visible: true }).first().click({ timeout: 8000 });
        // "Add image" opens an Upload / Select menu, like the main Images block.
        await page.waitForTimeout(900);
        const [fc] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 8000 }),
          page.getByText(/^(upload image|subir imagen)$/i).filter({ visible: true }).first().click({ timeout: 8000 }),
        ]);
        await fc.setFiles(file_paths);
        await page.waitForTimeout(5000);
        await dialogButton(page, /^(insert|insertar)$/i);
        await page.waitForTimeout(2500);
        await fixOrder(page, before);
        return ok(`Carousel with ${file_paths.length} image(s) added.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        await closeOpenDialog();
        return fail("add_carousel", e, SNAP_HINT);
      }
    }
  );

  server.registerTool(
    "gsites_add_social_links",
    {
      title: "Add social media icon links",
      description: `Add a row of social icons. Each URL becomes one icon (Sites picks the icon from the domain: instagram.com, linkedin.com, github.com, youtube.com...). ${AT_END}`,
      inputSchema: { urls: z.array(z.string().url()).min(1).max(8) },
      annotations: rw,
    },
    async ({ urls }) => {
      try {
        const page = await getPage();
        const before = await beginInsert(page);
        await clickInsertItem(page, /^(social links|enlaces a redes sociales)$/i);
        const inputs = page.locator("[role=dialog] input").filter({ visible: true });
        await inputs.first().waitFor({ timeout: 8000 });
        while ((await inputs.count()) < urls.length) {
          await page.getByRole("button", { name: /^(add link|añadir enlace)$/i }).click({ timeout: 6000 });
          await page.waitForTimeout(300);
        }
        for (let i = 0; i < urls.length; i++) await inputs.nth(i).fill(urls[i], { timeout: 6000 });
        // Default rows left empty are removed, otherwise Sites rejects them.
        for (let i = (await inputs.count()) - 1; i >= urls.length; i--) {
          await page.getByRole("button", { name: /^(delete link|eliminar enlace)$/i }).nth(i).click({ timeout: 6000 });
        }
        await dialogButton(page, /^(insert|insertar)$/i);
        await page.waitForTimeout(2000);
        await fixOrder(page, before);
        return ok(`${urls.length} social link(s) added.\n\nPage outline:\n${await outline()}`);
      } catch (e) {
        await closeOpenDialog();
        return fail("add_social_links", e, SNAP_HINT);
      }
    }
  );
}
