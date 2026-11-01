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
