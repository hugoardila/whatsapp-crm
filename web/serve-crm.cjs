'use strict';

/**
 * Sirve el CRM compilado (dist/) y reenvía /api, /webhook y /socket.io al Node (PM2).
 * Sin esto, /api/* cae en el fallback SPA (index.html) y el ping “no responde” o parece 401/HTML.
 *
 * Variables:
 *   CRM_PORT              puerto del panel (default 8988)
 *   CRM_API_PROXY_TARGET  origen del backend (default http://127.0.0.1:3001)
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = Number(process.env.CRM_PORT || 8988);
const API_TARGET = process.env.CRM_API_PROXY_TARGET || 'http://127.0.0.1:3001';
const dist = path.join(__dirname, 'dist');

const app = express();

app.use(
  createProxyMiddleware(['/api', '/webhook', '/socket.io'], {
    target: API_TARGET,
    changeOrigin: true,
    ws: true
  })
);

app.use(express.static(dist));

app.use((_req, res) => {
  res.sendFile(path.join(dist, 'index.html'));
});

const server = http.createServer(app);

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[TecnoXpert CRM] Express 0.0.0.0:${PORT} → ${dist} | proxy → ${API_TARGET}`
  );
});
