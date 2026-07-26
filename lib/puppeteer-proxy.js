const firebase = require("firebase/compat/app");
require("firebase/compat/firestore");
firebase.initializeApp({
  apiKey: "AIzaSyBdTH24q_cU1TdyLpd1Du4G196zEcB9kbQ",
  authDomain: "vnmediasolution-tk.firebaseapp.com",
  databaseURL: "https://vnmediasolution-tk-default-rtdb.firebaseio.com",
  projectId: "vnmediasolution-tk",
  storageBucket: "vnmediasolution-tk.firebasestorage.app",
  messagingSenderId: "615383281154",
  appId: "1:615383281154:web:0030c2652d67c13352011b",
  measurementId: "G-BQPQZQQ9FR",
});
const db = firebase.firestore();

let puppeteer = null;
try {
  puppeteer = require("puppeteer");
} catch (_) {
  puppeteer = require("puppeteer-core");
}

let browser = null;
let page = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await puppeteer.launch({
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
  return browser;
}

async function getPage() {
  if (page && !page.isClosed()) return page;
  const b = await getBrowser();
  page = await b.newPage();
  return page;
}

async function injectCookies() {
  const p = await getPage();
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

  const cleaned = cookies.map((c) => {
    if (c.name.startsWith("__Host-")) {
      const { domain, ...rest } = c;
      return rest;
    }
    return c;
  });

  await p.setCookie(...cleaned);
  return cleaned.length;
}

async function navigateToFlow() {
  const p = await getPage();
  await p.goto("https://labs.google/fx/tools/flow", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
}

async function getPageContent() {
  const p = await getPage();
  return await p.content();
}

async function proxyRequest(targetUrl) {
  const p = await getPage();
  const result = await p.evaluate(async (url) => {
    const resp = await fetch(url, { credentials: "include" });
    const ct = resp.headers.get("content-type") || "";
    const isText = ct.startsWith("text/") || ct.includes("json") || ct.includes("javascript") || ct.includes("xml") || ct.includes("html");
    const headers = {};
    resp.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    let body;
    let isBase64 = false;
    if (isText) {
      body = await resp.text();
    } else {
      const blob = await resp.blob();
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      body = btoa(bin);
      isBase64 = true;
    }
    return { status: resp.status, body, headers, isBase64 };
  }, targetUrl);
  return result;
}

async function takeScreenshot() {
  const p = await getPage();
  return await p.screenshot({ type: "png", fullPage: false });
}

async function close() {
  if (page && !page.isClosed()) await page.close().catch(() => {});
  if (browser && browser.isConnected()) await browser.close().catch(() => {});
}

module.exports = { getBrowser, getPage, injectCookies, navigateToFlow, getPageContent, proxyRequest, takeScreenshot, close };
