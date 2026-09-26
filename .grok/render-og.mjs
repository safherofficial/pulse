import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.goto(pathToFileURL("/workspace/.grok/og-card.html").href);
await page.evaluate(() => document.fonts.ready);
const metrics = await page.evaluate(() => {
  const h1 = document.querySelector("h1");
  const tag = document.querySelector(".tag");
  const lock = document.querySelector(".lockup");
  const hr = h1.getBoundingClientRect();
  const tr = tag.getBoundingClientRect();
  const lr = lock.getBoundingClientRect();
  const cs = getComputedStyle(h1);
  return {
    font: cs.fontFamily,
    title: { x: hr.x, y: hr.y, w: hr.width, h: hr.height, text: h1.textContent },
    tag: { x: tr.x, y: tr.y, w: tr.width, h: tr.height, text: tag.textContent },
    lock: { x: lr.x, y: lr.y, w: lr.width, h: lr.height },
  };
});
console.log(JSON.stringify(metrics, null, 2));
await page.screenshot({ path: "/workspace/.grok/og-raw.png", type: "png" });

const icon = await browser.newPage({
  viewport: { width: 64, height: 64 },
  deviceScaleFactor: 1,
});
await icon.setContent(
  `<style>html,body{margin:0;background:#111}</style>` +
    `<img src="${pathToFileURL("/workspace/.grok/favicon.svg.tmp").href}" width="64" height="64">`,
  { waitUntil: "networkidle" },
);
await icon.screenshot({ path: "/workspace/.grok/favicon-64.png", type: "png" });

const tiny = await browser.newPage({
  viewport: { width: 16, height: 16 },
  deviceScaleFactor: 4,
});
await tiny.setContent(
  `<style>html,body{margin:0;background:#111}</style>` +
    `<img src="${pathToFileURL("/workspace/.grok/favicon.svg.tmp").href}" width="16" height="16">`,
  { waitUntil: "networkidle" },
);
await tiny.screenshot({ path: "/workspace/.grok/favicon-16.png", type: "png" });

await browser.close();
