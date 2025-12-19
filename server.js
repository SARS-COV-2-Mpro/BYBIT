// server.js
import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

// Upstreams
const BYBIT_MAINNET = "https://api.bybit.com";
// Updated testnet URL
const BYBIT_TESTNET = "https://api-demo.bybit.com";

// Keys for each environment (still from env vars)
const MAIN_KEY = (process.env.BYBIT_MAINNET_API_KEY || "").trim();
const MAIN_SECRET = (process.env.BYBIT_MAINNET_SECRET || "").trim();
const TESTNET_KEY = (process.env.BYBIT_DEMO_API_KEY || "").trim();
const TESTNET_SECRET = (process.env.BYBIT_DEMO_SECRET || "").trim();

const RECV_WINDOW = (process.env.BYBIT_RECV_WINDOW || "5000").trim();

// No proxy token – always allow
function mustAuth(req, res) {
  return null;
}

function credsFor(env) {
  if (env === "mainnet") {
    if (!MAIN_KEY || !MAIN_SECRET) throw new Error("Mainnet keys missing in env");
    return { baseUrl: BYBIT_MAINNET, apiKey: MAIN_KEY, secret: MAIN_SECRET };
  }
  if (!TESTNET_KEY || !TESTNET_SECRET) throw new Error("Testnet keys missing in env");
  return { baseUrl: BYBIT_TESTNET, apiKey: TESTNET_KEY, secret: TESTNET_SECRET };
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

  return { status: r.status, text };
}

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Mainnet proxy:
 *  - GET  /mainnet/v5/market/time
 *  - POST /mainnet/v5/order/create
 */
app.all("/mainnet/*", async (req, res) => {
  const authFail = mustAuth(req, res);
  if (authFail) return;

  try {
    const { baseUrl, apiKey, secret } = credsFor("mainnet");

    const path = req.originalUrl.replace(/^\/mainnet/, "");
    const [pathname, qs = ""] = path.split("?");
    const url = `${baseUrl}${pathname}${qs ? `?${qs}` : ""}`;

    const method = req.method.toUpperCase();

    let payload = "";
    let bodyJson = "";

    if (method === "GET") {
      payload = qs || "";
    } else {
      bodyJson = JSON.stringify(req.body ?? {});
      payload = bodyJson;
    }

    const out = await forwardToBybit({ method, url, apiKey, secret, payload, bodyJson });

    const ct = out.text.trim().startsWith("{") ? "application/json" : "text/html";
    res.status(out.status).set("Content-Type", ct).send(out.text);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/**
 * Testnet proxy:
 *  - GET  /testnet/v5/market/time
 *  - POST /testnet/v5/order/create
 */
app.all("/testnet/*", async (req, res) => {
  const authFail = mustAuth(req, res);
  if (authFail) return;

  try {
    const { baseUrl, apiKey, secret } = credsFor("testnet");

    const path = req.originalUrl.replace(/^\/testnet/, "");
    const [pathname, qs = ""] = path.split("?");
    const url = `${baseUrl}${pathname}${qs ? `?${qs}` : ""}`;

    const method = req.method.toUpperCase();

    let payload = "";
    let bodyJson = "";

    if (method === "GET") {
      payload = qs || "";
    } else {
      bodyJson = JSON.stringify(req.body ?? {});
      payload = bodyJson;
    }

    const out = await forwardToBybit({ method, url, apiKey, secret, payload, bodyJson });

    const ct = out.text.trim().startsWith("{") ? "application/json" : "text/html";
    res.status(out.status).set("Content-Type", ct).send(out.text);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.listen(PORT, () => console.log(`Bybit proxy listening on :${PORT}`));
