import { chromium, BrowserContext, Page } from "playwright";
import path from "node:path";
import os from "node:os";

// Persistent profile: log in to Google once, the session is reused afterwards.
export const PROFILE_DIR =
  process.env.GSITES_PROFILE_DIR ?? path.join(os.homedir(), ".google-sites-mcp-profile");

let context: BrowserContext | null = null;

export async function getContext(): Promise<BrowserContext> {
  if (context) return context;
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: process.env.GSITES_HEADLESS === "1",
    // Installed Edge by default: Playwright's bundled chrome.exe can be blocked by antivirus.
    // Set GSITES_CHANNEL=chrome for Chrome, or GSITES_CHANNEL= (empty) for bundled Chromium.
    channel: (process.env.GSITES_CHANNEL ?? "msedge") || undefined,
    viewport: { width: 1400, height: 900 },
    // Google blocks sign-in from automation-flagged browsers
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  });
  // typeText() pastes through the clipboard, so the Sites origin needs clipboard permissions.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://sites.google.com" }).catch(() => undefined);
  context.on("close", () => {
    context = null;
  });
  return context;
}

export async function getPage(): Promise<Page> {
  const ctx = await getContext();
  const pages = ctx.pages();
  // Popups (e.g. "open in a new window" links) must not steal focus from the editor tab.
  const sites = [...pages].reverse().find((pg) => !pg.isClosed() && /sites\.google\.com/.test(pg.url()));
  if (sites) return sites;
  const open = pages.filter((pg) => !pg.isClosed());
  return open.length ? open[open.length - 1] : await ctx.newPage();
}

export async function closeBrowser(): Promise<void> {
  if (context) await context.close();
  context = null;
}
