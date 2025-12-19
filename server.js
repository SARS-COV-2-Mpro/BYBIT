import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

// Required env
const PROXY_TOKEN = (process.env.PROXY_TOKEN || "").trim();

// Upstreams
const BYBIT_MAINNET = "https://api.bybit.com";
const BYBIT_DEMO = "https://api-demo-testnet.bybit.com";

// Keys for each environment (keep secrets only here)
const MAIN_KEY = (process.env.BYBIT_MAINNET_API_KEY || "").trim();
const MAIN_SECRET = (process.env.BYBIT_MAINNET_SECRET || "").trim();
const DEMO_KEY = (process.env.BYBIT_DEMO_API_KEY || "").trim();
const DEMO_SECRET = (process.env.BYBIT_DEMO_SECRET || "").trim();

const RECV_WINDOW = (process.env.BYBIT_RECV_WINDOW || "5000").trim();

function mustAuth(req, res) {
  if (!PROXY_TOKEN) return res.status(500).json({ error: "PROXY_TOKEN not set" });

  const presented = (req.header("X-PROXY-TOKEN") || "").trim();
  if (presented !== PROXY_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  return null;
}

function pickEnv(req) {
  // Choose environment via header or query param.
  // Prefer header: X-BYBIT-ENV: demo | main
  const h = (req.header("X-BYBIT-ENV") || "").trim().toLowerCase();
  const q = (req.query.env || "").toString().trim().toLowerCase();

  const env = (h || q || "demo");
  if (env !== "demo" && env !== "main") throw new Error(`Invalid env "${env}". Use demo|main.`);
  return env;
}

function credsFor(env) {
  if (env === "main") {
    if (!MAIN_KEY || !MAIN_SECRET) throw new Error("Mainnet keys missing in env");
    return { baseUrl: BYBIT_MAINNET, apiKey: MAIN_KEY, secret: MAIN_SECRET };
  }
  if (!DEMO_KEY || !DEMO_SECRET) throw new Error("Demo keys missing in env");
  return { baseUrl: BYBIT_DEMO, apiKey: DEMO_KEY, secret: DEMO_SECRET };
}

function signBybit({ timestamp, apiKey, secret, recvWindow, payload }) {
  const signStr = `${timestamp}${apiKey}${recvWindow}${payload}`;
  return crypto.createHmac("sha256", secret).update(signStr).digest("hex");
}

async function forwardToBybit({ method, url, apiKey, secret, payload, bodyJson }) {
  const timestamp = Date.now().toString();
  const signature = signBybit({
    timestamp,
    apiKey,
    secret,
    recvWindow: RECV_WINDOW,
    payload
  });

  const headers = {
    "X-BAPI-API-KEY": apiKey,
    "X-BAPI-TIMESTAMP": timestamp,
    "X-BAPI-SIGN": signature,
    "X-BAPI-RECV-WINDOW": RECV_WINDOW,
    "Content-Type": "application/json"
  };

  const opts = { method, headers };
  if (method !== "GET") opts.body = bodyJson;

  const r = await fetch(url, opts);
  const text = await r.text();

  // Return status + raw body (Bybit returns JSON; CloudFront returns HTML on blocks)
  return { status: r.status, text };
}

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Universal Bybit proxy:
 *  - GET  /bybit/v5/market/time
 *  - POST /bybit/v5/order/create
 *
 * Use:
 *  - Header: X-BYBIT-ENV: demo|main
 *  - Header: X-PROXY-TOKEN: <token>
 */
app.all("/bybit/*", async (req, res) => {
  const authFail = mustAuth(req, res);
  if (authFail) return;

  try {
    const env = pickEnv(req);
    const { baseUrl, apiKey, secret } = credsFor(env);

    const path = req.originalUrl.replace(/^\/bybit/, ""); // includes query string
    const [pathname, qs = ""] = path.split("?");
    const url = `${baseUrl}${pathname}${qs ? `?${qs}` : ""}`;

    const method = req.method.toUpperCase();

    // Payload rules:
    // - GET: payload = query string (no leading '?')
    // - POST: payload = raw JSON string
    let payload = "";
    let bodyJson = "";

    if (method === "GET") {
      payload = qs || "";
    } else {
      bodyJson = JSON.stringify(req.body ?? {});
      payload = bodyJson;
    }

    const out = await forwardToBybit({ method, url, apiKey, secret, payload, bodyJson });

    // Try to return JSON if possible, else return text
    const ct = out.text.trim().startsWith("{") ? "application/json" : "text/html";
    res.status(out.status).set("Content-Type", ct).send(out.text);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.listen(PORT, () => console.log(`Bybit proxy listening on :${PORT}`));
