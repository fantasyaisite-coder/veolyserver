const { db } = require("./firebase");
const puppeteer = require("puppeteer");

async function launchFlow() {
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_CHROME_PATH || puppeteer.executablePath(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--disable-sync",
      "--disable-default-apps",
      "--disable-extensions",
    ],
  });

  try {
    const page = await browser.newPage();
    const cdp = await page.target().createCDPSession();

    // Inject cookies via raw CDP (avoids Puppeteer's __Host- cookie bug)
    const snap = await db.collection("pool_cookies").where("is_active", "==", true).get();
    if (snap.empty) throw new Error("No active pool cookies in Firestore");

    for (const d of snap.docs) {
      const c = d.data();
      const params = {
        name: c.cookie_name,
        value: c.cookie_value,
        secure: c.secure !== false,
        httpOnly: c.http_only !== false,
        sameSite: (c.same_site || "Lax").toUpperCase(),
        path: c.cookie_path || "/",
      };
      if (c.cookie_domain) params.domain = c.cookie_domain;
      if (c.expiration_date) params.expires = c.expiration_date;
      if (c.cookie_name.startsWith("__Host-")) {
        delete params.domain;
        params.url = "https://labs.google/";
      }
      await cdp.send("Network.setCookie", params).catch((e) => console.warn("[cookie]", c.cookie_name, e.message));
    }

    // Navigate — wait for page resources, then let JS render
    await page.goto("https://labs.google/fx/tools/flow", {
      waitUntil: "load",
      timeout: 90000,
    });

    // Let JS execute and render the page fully
    await page.evaluate(() => new Promise((r) => setTimeout(r, 4000)));

    // Get fully rendered HTML
    const html = await page.content();

    await browser.close();
    return { ok: true, html, count: snap.size };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

module.exports = { launchFlow };
