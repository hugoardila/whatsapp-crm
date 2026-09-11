'use strict';

const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, 'data', 'logs');
const defaultPath = path.join(logDir, 'crm-events.log');
const logPath = process.env.EVENT_LOG_PATH
  ? path.resolve(process.env.EVENT_LOG_PATH)
  : defaultPath;
const maxBytes = Number(process.env.EVENT_LOG_MAX_BYTES || 5 * 1024 * 1024);

function ensureDir() {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
}

function rotateIfNeeded() {
  try {
    const st = fs.statSync(logPath);
    if (st.size <= maxBytes) return;
    const bak = `${logPath}.1`;
    try {
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
    } catch (_) {}
    fs.renameSync(logPath, bak);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[eventLog] rotate:', e.message);
  }
}

/**
 * @param {string} category
 * @param {string} action
 * @param {Record<string, unknown>} [data]
 */
function logEvent(category, action, data) {
  const entry = {
    ts: new Date().toISOString(),
    category,
    action,
    ...(data && typeof data === 'object' ? data : {})
  };
  const line = `${JSON.stringify(entry)}\n`;
  try {
    ensureDir();
    rotateIfNeeded();
  } catch (e) {
    console.error('[eventLog] ensureDir:', e.message);
  }
  fs.appendFile(logPath, line, (err) => {
    if (err) console.error('[eventLog] append:', err.message);
  });
  const short = `[crm-events] ${category}/${action}`;
  if (data && typeof data === 'object' && Object.keys(data).length > 0) {
    console.info(short, JSON.stringify(data));
  } else {
    console.info(short);
  }
}

module.exports = { logEvent, logPath };
