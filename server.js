const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pptr = require("./lib/puppeteer-proxy");

app.get("/flow", async (req, res) => {
  try {
    const count = await pptr.injectCookies();
    console.log(`[flow] ${count} cookies injected`);
    await pptr.navigateToFlow();
    const html = await pptr.getPageContent();
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("[flow]", err.stack || err.message);
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
    console.error("[proxy]", req.path, err.message);
    res.status(502).send("Proxy error");
  }
});

app.get("/status", async (req, res) => {
  try {
    const b = await pptr.getBrowser();
    const version = await b.version();
    res.json({ ok: true, version, pid: b.process().pid });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/launch", async (req, res) => {
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

app.get("/", (req, res) => res.redirect("/flow"));

app.listen(PORT, () => {
  console.log(`\n  🚀 Puppeteer Flow Server`);
  console.log(`  🌐 http://localhost:${PORT}/flow\n`);
});
