'use strict';

const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const s = String(process.env.ADVISOR_JWT_SECRET || '').trim();
  return s || null;
}

function signAdvisorToken(advisorId) {
  const secret = getJwtSecret();
  if (!secret) {
    const err = new Error('ADVISOR_JWT_SECRET no configurado');
    err.code = 'NO_SECRET';
    throw err;
  }
  return jwt.sign({ aid: Number(advisorId) }, secret, { expiresIn: '12h' });
}

function verifyAdvisorToken(token) {
  const secret = getJwtSecret();
  if (!secret || !token) return null;
  try {
    const p = jwt.verify(String(token), secret);
    const aid = Number(p?.aid);
    if (!Number.isFinite(aid) || aid < 1) return null;
    return aid;
  } catch {
    return null;
  }
}

module.exports = { signAdvisorToken, verifyAdvisorToken, getJwtSecret };
