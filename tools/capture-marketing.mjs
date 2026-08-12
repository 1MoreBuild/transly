import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const sourcePath = "/marketing/chrome-web-store/article-bilingual.html";
const outputs = [
  { deviceScaleFactor: 1, name: "transly-article-bilingual-1280x800.png" },
  { deviceScaleFactor: 2, name: "transly-article-bilingual-2560x1600.png" }
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root)) throw new Error("Path outside repository");
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const browser = await chromium.launch();

try {
  for (const output of outputs) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: output.deviceScaleFactor
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}${sourcePath}`, { waitUntil: "networkidle" });
    await page.screenshot({
      path: join(root, "marketing/chrome-web-store", output.name),
      animations: "disabled"
    });
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
