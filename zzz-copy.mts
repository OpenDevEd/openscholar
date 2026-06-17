import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const page = await (await b.newContext({ viewport: { width: 820, height: 1300 }, deviceScaleFactor: 2 })).newPage();
await page.goto("http://localhost:3000/settings/ai", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/copy.png", fullPage: true });
await b.close(); console.log("ok");
