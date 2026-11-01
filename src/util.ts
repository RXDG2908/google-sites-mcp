import type { Page } from "playwright";

export const CHARACTER_LIMIT = 25000;

export const ok = (text: string) => ({
  content: [
    {
      type: "text" as const,
      text: text.length > CHARACTER_LIMIT ? text.slice(0, CHARACTER_LIMIT) + "\n...[truncated]" : text,
    },
  ],
});

export const fail = (action: string, e: unknown, hint: string) => ({
  isError: true,
  content: [
    {
      type: "text" as const,
      text: `Error during ${action}: ${e instanceof Error ? (process.env.GSITES_DEBUG ? e.message : e.message.split("\n")[0]) : String(e)}. ${hint}`,
    },
  ],
});

export const SNAP_HINT =
  "Call gsites_snapshot or gsites_screenshot to see the current editor state, then retry with an exact label.";

export const rw = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
export const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
export const del = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

/**
 * Type text into the focused editor box.
 * The Sites editor silently drops characters that are not on the basic keyboard (accents, n-tilde, inverted marks, dashes)
 * when they arrive through keyboard.type(). Plain ASCII still types normally; anything else is pasted from the clipboard.
 */
export async function typeText(page: Page, text: string, delay = 8): Promise<void> {
  const needsPaste = [...text].some((c) => c.charCodeAt(0) > 126);
  if (!needsPaste) {
    await page.keyboard.type(text, { delay });
    return;
  }
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  await page.waitForTimeout(400);
}
