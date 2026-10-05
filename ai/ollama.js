/* ==========================================================================
   ai/ollama.js — Ollama transport for the Electron main process.
   Lists models (GET /api/tags, prefers a local model, accepts a
   cloud-tagged one when that is all there is) and generates JSON
   (POST /api/generate, format json, stream false) with an 8 s timeout.
   Every failure is a value, never a throw: the renderer falls back
   to the on-device rules. fetchImpl is injectable for tests.
   ========================================================================== */

'use strict';

var DEFAULT_URL = 'http://127.0.0.1:11434';
var TIMEOUT_MS = 8000;

function baseUrl(override) {
  if (override) return String(override).replace(/\/+$/, '');
  try {
    if (typeof process !== 'undefined' && process.env && process.env.OLLAMA_URL) {
      return String(process.env.OLLAMA_URL).replace(/\/+$/, '');
    }
  } catch (e) { /* plain contexts — fall through to localhost */ }
  return DEFAULT_URL;
}

function fetchImplOf(impl) {
  if (impl) return impl;
  if (typeof fetch === 'function') return fetch;
  throw new Error('ai/ollama: no fetch available');
}

/* POST/GET with a timeout. A hanging model server reads as down. */
async function withTimeout(fetchImpl, url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const ms = timeoutMs === undefined ? TIMEOUT_MS : timeoutMs;
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { ...(opts || {}), signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* Model policy: OLLAMA_MODEL env wins, otherwise a gemma model (cloud-tagged
   gemma4:31b-cloud is fine). Never auto-pick another local model: a big local
   one can freeze the PC. No gemma = null = rules. */
function pickModel(models) {
  if (!Array.isArray(models)) return null;
  const want = process.env.OLLAMA_MODEL;
  for (const m of models) {
    const n = m && m.name;
    if (n && (want ? n === want : /^gemma/i.test(n))) return n;
  }
  return null;
}

async function listModels(opts) {
  opts = opts || {};
  const base = baseUrl(opts.baseUrl);
  let res;
  try {
    res = await withTimeout(fetchImplOf(opts.fetchImpl), base + '/api/tags',
      { method: 'GET' }, opts.timeoutMs);
  } catch (e) {
    return { ok: false, reason: 'down' };
  }
  if (!res || !res.ok) return { ok: false, reason: 'down' };
  try {
    const data = await res.json();
    const models = (data && data.models) || [];
    return { ok: true, models, picked: pickModel(models) };
  } catch (e) {
    return { ok: false, reason: 'bad-json' };
  }
}

async function generate(prompt, opts) {
  opts = opts || {};
  const base = baseUrl(opts.baseUrl);
  const listed = await listModels(opts);
  if (!listed.ok || !listed.picked) return { ok: false, reason: 'no-model' };
  let res;
  try {
    res = await withTimeout(fetchImplOf(opts.fetchImpl), base + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: listed.picked,
        prompt: String(prompt),
        format: 'json',
        stream: false
      })
    }, opts.timeoutMs);
  } catch (e) {
    return { ok: false, reason: 'down' };
  }
  if (!res || !res.ok) return { ok: false, reason: 'down' };
  try {
    const data = await res.json();
    if (!data || typeof data.response !== 'string' || !data.response.trim()) {
      return { ok: false, reason: 'bad-json' };
    }
    return { ok: true, text: data.response, model: listed.picked };
  } catch (e) {
    return { ok: false, reason: 'bad-json' };
  }
}

/* One call for the renderer: tags, pick, generate. */
async function query(prompt, opts) {
  try {
    return await generate(prompt, opts);
  } catch (e) {
    return { ok: false, reason: 'down' };
  }
}

module.exports = {
  DEFAULT_URL,
  TIMEOUT_MS,
  baseUrl,
  pickModel,
  listModels,
  generate,
  query
};
