const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

  await page.goto("http://localhost:3000/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Model Connections", { timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "screenshot-dashboard.png", fullPage: false });

  const names = await page.locator("text=/Claude Opus 5|GPT-5\\.6 Sol|Kimi K3/").allInnerTexts();
  console.log(JSON.stringify({ names, errors }, null, 2));
  await browser.close();
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
