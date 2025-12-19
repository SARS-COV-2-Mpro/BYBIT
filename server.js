// server.js
import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.text({ type: "*/*", limit: "1mb" }));

const PORT = process.env.PORT || 3000;

// Upstreams
const BYBIT_MAINNET = "https://api.bybit.com";
const BYBIT_TESTNET = "https://api-demo-testnet.bybit.com";

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Universal proxy handler - forwards ALL headers and body
 */
async function proxyToBybit(req, res, baseUrl, prefix) {
  try {
    // Build target URL
    const path = req.originalUrl.replace(new RegExp(`^/${prefix}`), "");
    const url = `${baseUrl}${path}`;

    const method = req.method.toUpperCase();

    // Forward ALL relevant headers
    const headers = {};

    // Bybit auth headers (case-insensitive lookup)
    const headersToCopy = [
      'x-bapi-api-key',
      'x-bapi-timestamp',
      'x-bapi-sign',
      'x-bapi-recv-window',
      'content-type',
      'accept',
      'accept-language',
      'cache-control'
    ];

    for (const h of headersToCopy) {
      const value = req.headers[h] || req.headers[h.toUpperCase()] || req.get(h);
      if (value) {
        // Convert to proper Bybit header format
        if (h === 'x-bapi-api-key') headers['X-BAPI-API-KEY'] = value;
        else if (h === 'x-bapi-timestamp') headers['X-BAPI-TIMESTAMP'] = value;
        else if (h === 'x-bapi-sign') headers['X-BAPI-SIGN'] = value;
        else if (h === 'x-bapi-recv-window') headers['X-BAPI-RECV-WINDOW'] = value;
        else headers[h] = value;
      }
    }

    // Always set content-type for POST
    if (!headers['content-type'] && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    // User-Agent to avoid blocks
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    // Build request options
    const opts = { method, headers };

    // Forward body for non-GET requests
    if (method !== 'GET' && method !== 'HEAD') {
      if (typeof req.body === 'object') {
        opts.body = JSON.stringify(req.body);
      } else if (req.body) {
        opts.body = req.body;
      }
    }

    // Make request to Bybit
    const response = await fetch(url, opts);
    const text = await response.text();

    // Forward response back
    const contentType = text.trim().startsWith("{") ? "application/json" : "text/html";
    res.status(response.status).set("Content-Type", contentType).send(text);

  } catch (e) {
    console.error(`[proxy] Error:`, e?.message || e);
    res.status(500).json({ error: e?.message || String(e) });
  }
}

/**
 * Mainnet proxy: /mainnet/*
 */
app.all("/mainnet/*", (req, res) => proxyToBybit(req, res, BYBIT_MAINNET, "mainnet"));

/**
 * Testnet proxy: /testnet/*
 */
app.all("/testnet/*", (req, res) => proxyToBybit(req, res, BYBIT_TESTNET, "testnet"));

app.listen(PORT, () => console.log(`Bybit proxy listening on :${PORT}`));
