const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const { db } = require("./lib/firebase");
const streamer = require("./lib/streamer");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ── WebSocket for Chrome viewport streaming ────────────────
const wss = new WebSocketServer({ server, path: "/ws-stream" });

wss.on("connection", async (ws) => {
  try {
    await streamer.injectCookies();
    await streamer.navigateToFlow();
    await streamer.startStream(ws);
  } catch (err) {
    ws.send(JSON.stringify({ type: "error", message: err.message }));
    ws.close();
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
    const { syncAll, syncUncodee, syncFlowbunny } = require("./lib/sync");
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
    const cookies = snap.docs.map((d) => ({
      id: d.id, name: d.data().cookie_name, domain: d.data().cookie_domain,
      source: d.data().source || "?", synced_at: d.data().synced_at,
    }));
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
    const cookieSnap = await db.collection("pool_cookies").where("is_active", "==", true).get();
    res.json({ ok: true, pool_count: cookieSnap.size, uptime: process.uptime() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── Page routes ────────────────────────────────────────────
app.get("/stream", (req, res) => res.sendFile(path.join(__dirname, "public", "stream.html")));
app.get("/flow", (req, res) => res.redirect("/stream"));

// Catch-all SPA fallback for admin panel
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`\n  🚀 Flow Remote Server`);
  console.log(`  🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`  🖥  Flow Remote: http://localhost:${PORT}/stream\n`);
});
