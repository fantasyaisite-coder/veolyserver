const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const { db } = require("./lib/firebase");
const { syncAll, syncUncodee, syncFlowbunny, getSettings } = require("./lib/sync");
const pptr = require("./lib/puppeteer-proxy");

// ── Flow proxy routes ──────────────────────────────────────
app.get("/flow", async (req, res) => {
  try {
    const count = await pptr.injectCookies();
    await pptr.navigateToFlow();
    const html = await pptr.getPageContent();
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    res.status(500).send(`<h2>Flow error</h2><pre>${err.message}</pre>`);
  }
});

app.get(["/_next/*", "/assets/*", "/s/*"], async (req, res) => {
  try {
    const result = await pptr.proxyRequest(`https://labs.google${req.path}`);
    for (const [k, v] of Object.entries(result.headers)) {
      if (!["content-encoding", "transfer-encoding", "content-length", "set-cookie"].includes(k.toLowerCase())) {
        res.set(k, v);
      }
    }
    res.status(result.status);
    if (result.body) {
      if (result.isBase64) res.send(Buffer.from(result.body, "base64"));
      else res.send(result.body);
    } else res.end();
  } catch (err) {
    res.status(502).send("Proxy error");
  }
});

// ── Admin API routes ──────────────────────────────────────
app.post("/api/login", async (req, res) => {
  try {
    const { password } = req.body;
    const snap = await db.collection("admin_settings").doc("config").get();
    const cfg = snap.data() || {};
    const valid = cfg.server_password || "HNM@3322k";
    if (password === valid) return res.json({ ok: true });
    res.json({ ok: false, error: "Wrong password" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/settings", async (req, res) => {
  try {
    const snap = await db.collection("admin_settings").doc("config").get();
    const cfg = snap.data() || {};
    // Never expose password
    const { server_password, ...safe } = cfg;
    res.json({ ok: true, settings: safe });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/settings", async (req, res) => {
  try {
    const allowed = [
      "server_password", "target_url", "uncodee_email", "uncodee_password",
      "flowbunny_email", "flowbunny_password", "flowbunny_device_id", "default_cookie_source",
    ];
    const update = {};
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) update[k] = v;
    }
    await db.collection("admin_settings").doc("config").set(update, { merge: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/sync", async (req, res) => {
  try {
    const source = req.body.source || "all";
    let result;
    if (source === "uncodee") result = await syncUncodee();
    else if (source === "flowbunny") result = await syncFlowbunny();
    else result = await syncAll();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/cookies", async (req, res) => {
  try {
    const snap = await db.collection("pool_cookies").where("is_active", "==", true).get();
    const cookies = snap.docs.map((d) => {
      const c = d.data();
      return {
        id: d.id,
        name: c.cookie_name,
        domain: c.cookie_domain,
        source: c.source || "?",
        active: c.is_active,
        synced_at: c.synced_at,
      };
    });
    res.json({ ok: true, count: snap.size, cookies });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/logs", async (req, res) => {
  try {
    const snap = await db.collection("sync_logs").orderBy("at", "desc").limit(50).get();
    const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ ok: true, logs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/status", async (req, res) => {
  try {
    const b = await pptr.getBrowser();
    const version = await b.version();
    const cookieSnap = await db.collection("pool_cookies").where("is_active", "==", true).get();
    res.json({ ok: true, chrome: version, pid: b.process().pid, pool_count: cookieSnap.size });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/launch", async (req, res) => {
  try {
    const mode = req.body.mode || "html";
    const count = await pptr.injectCookies();
    await pptr.navigateToFlow();
    if (mode === "screenshot") {
      const buf = await pptr.takeScreenshot();
      res.json({ ok: true, count, screenshot: buf.toString("base64") });
    } else {
      const html = await pptr.getPageContent();
      res.json({ ok: true, count, html });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Admin panel — catch-all SPA fallback
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n  🚀 Flow Control Server`);
  console.log(`  🌐 http://localhost:${PORT}`);
  console.log(`  🎯 Flow proxy: http://localhost:${PORT}/flow\n`);
});
