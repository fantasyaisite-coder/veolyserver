const { db } = require("./firebase");

let browser = null;
let page = null;
let cdp = null;
let activeWs = null;

async function getOrCreateSession() {
  if (page && !page.isClosed() && cdp) return { page, cdp };
  const puppeteer = require("puppeteer");
  browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_CHROME_PATH || puppeteer.executablePath(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--disable-sync",
      "--disable-default-apps",
      "--disable-extensions",
      "--window-size=1280,900",
    ],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  cdp = await page.target().createCDPSession();
  return { page, cdp };
}

async function injectCookies() {
  const { page: p } = await getOrCreateSession();
  const snap = await db.collection("pool_cookies").where("is_active", "==", true).get();
  if (snap.empty) throw new Error("No active pool cookies");

  const cookies = snap.docs.map((d) => {
    const c = d.data();
    return {
      name: c.cookie_name,
      value: c.cookie_value,
      domain: c.cookie_domain || "labs.google",
      path: c.cookie_path || "/",
      secure: c.secure !== false,
      httpOnly: c.http_only !== false,
      sameSite: (c.same_site || "Lax").toUpperCase(),
      expires: c.expiration_date ? c.expiration_date : undefined,
    };
  });

  // Use raw CDP instead of page.setCookie to avoid __Host- cookie issues
  for (const c of cookies) {
    const params = { name: c.name, value: c.value, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, path: c.path };
    if (c.name.startsWith("__Host-")) {
      params.url = "https://labs.google/";
    } else if (c.domain) {
      params.url = `https://${c.domain}/`;
    } else {
      params.url = "https://labs.google/";
    }
    if (c.expires) params.expires = c.expires;
    await cdp.send("Network.setCookie", params).catch((e) => console.warn("[cookie]", c.name, e.message));
  }
  return cookies.length;
}

async function navigateToFlow() {
  const { page: p } = await getOrCreateSession();
  await p.goto("https://labs.google/fx/tools/flow", { waitUntil: "load", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
}

async function startStream(ws) {
  activeWs = ws;
  const s = await getOrCreateSession();

  // Enable necessary CDP domains
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Network.enable");

  // Send viewport info
  ws.send(JSON.stringify({ type: "viewport", width: 1280, height: 900 }));

  // Start screencast
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 70,
    maxWidth: 1280,
    maxHeight: 900,
    everyNthFrame: 1,
  });

  cdp.on("Page.screencastFrame", (frame) => {
    if (activeWs && activeWs.readyState === 1) {
      activeWs.send(JSON.stringify({ type: "frame", data: frame.data, metadata: frame.metadata }));
    }
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });

  // Handle input from client
  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "click") {
        const scaleX = 1280 / msg.viewWidth;
        const scaleY = 900 / msg.viewHeight;
        const x = Math.round(msg.x * scaleX);
        const y = Math.round(msg.y * scaleY);
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      } else if (msg.type === "mousemove") {
        const scaleX = 1280 / msg.viewWidth;
        const scaleY = 900 / msg.viewHeight;
        const x = Math.round(msg.x * scaleX);
        const y = Math.round(msg.y * scaleY);
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
      } else if (msg.type === "wheel") {
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 0, y: 0, deltaX: msg.deltaX, deltaY: msg.deltaY });
      } else if (msg.type === "key") {
        const type = msg.down ? "keyDown" : "keyUp";
        await cdp.send("Input.dispatchKeyEvent", { type, text: msg.key, key: msg.key, windowsVirtualKeyCode: msg.keyCode || 0 });
      }
    } catch (_) {}
  });

  ws.on("close", () => {
    activeWs = null;
    cdp.removeAllListeners("Page.screencastFrame");
    cdp.send("Page.stopScreencast").catch(() => {});
  });
}

async function close() {
  if (cdp) cdp.send("Page.stopScreencast").catch(() => {});
  if (page && !page.isClosed()) await page.close().catch(() => {});
  if (browser && browser.isConnected()) await browser.close().catch(() => {});
}

module.exports = { getOrCreateSession, injectCookies, navigateToFlow, startStream, close };
