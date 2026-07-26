const express = require("express");
const path = require("path");
const { db } = require("./lib/firebase");
const { launchFlow } = require("./lib/flow");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/flow", async (req, res) => {
  try {
    const result = await launchFlow();
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(result.html);
  } catch (err) {
    res.status(500).send(`<h2>Flow error</h2><pre>${err.message}</pre>`);
  }
});

// ── Admin API ──────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { password } = req.body;
  const snap = await db.collection("admin_settings").doc("config").get();
  const cfg = snap.data() || {};
  res.json({ ok: password === (cfg.server_password || "HNM@3322k") });
});

app.get("/api/settings", async (req, res) => {
  const snap = await db.collection("admin_settings").doc("config").get();
  const { server_password, ...safe } = snap.data() || {};
  res.json({ ok: true, settings: safe });
});

app.post("/api/settings", async (req, res) => {
  const allowed = ["server_password", "target_url", "uncodee_email", "uncodee_password", "flowbunny_email", "flowbunny_password", "flowbunny_device_id", "default_cookie_source"];
  const update = {};
  for (const [k, v] of Object.entries(req.body)) if (allowed.includes(k)) update[k] = v;
  await db.collection("admin_settings").doc("config").set(update, { merge: true });
  res.json({ ok: true });
});

app.post("/api/sync", async (req, res) => {
  const { syncAll, syncUncodee, syncFlowbunny } = require("./lib/sync");
  const source = req.body.source || "all";
  res.json(source === "uncodee" ? await syncUncodee() : source === "flowbunny" ? await syncFlowbunny() : await syncAll());
});

app.get("/api/cookies", async (req, res) => {
  const snap = await db.collection("pool_cookies").where("is_active", "==", true).get();
  res.json({ ok: true, count: snap.size, cookies: snap.docs.map(d => ({ id: d.id, name: d.data().cookie_name, domain: d.data().cookie_domain, source: d.data().source || "?", synced_at: d.data().synced_at })) });
});

app.get("/api/logs", async (req, res) => {
  const snap = await db.collection("sync_logs").orderBy("at", "desc").limit(50).get();
  res.json({ ok: true, logs: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

app.get("/api/status", async (req, res) => {
  const c = await db.collection("pool_cookies").where("is_active", "==", true).get();
  res.json({ ok: true, pool_count: c.size, uptime: process.uptime() });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n  🚀 Flow Server — http://localhost:${PORT}/flow\n`);
});
