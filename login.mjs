// One-time Google login helper: opens the MCP's browser profile and waits until you close the window.
import { getPage, getContext } from "./dist/browser.js";

const page = await getPage();
await page.goto("https://sites.google.com/new");
console.log("Inicia sesion en Google en la ventana abierta. Cierra la ventana cuando termines.");
const ctx = await getContext();
await new Promise((resolve) => ctx.on("close", resolve));
console.log("Sesion guardada.");
