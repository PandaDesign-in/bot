/* ═══════════════════════════════════════════════
   PandaAI 🐼 — GitHub Sync Module
   GitHub REST API as encrypted vault backend.
   Exposes: window.__pandaSync
   All content is AES-256-GCM encrypted before commit.
   GitHub PAT stored in sessionStorage only.
═══════════════════════════════════════════════ */

(function() {
'use strict';

const API = 'https://api.github.com';
let _pat  = null;
let _repo = null;   // 'owner/repo'
let _branch = 'main';
let _dirty = false; // pending flush
let _flushTimer = null;
const FLUSH_INTERVAL = 60000; // 60 seconds

// Pending writes: path → { content (base64), sha (if update) }
const _queue = new Map();

const GROQ_CONFIG_PATH = 'config/groq.enc';

// ── Init ─────────────────────────────────────
// PAT is the only credential — it authenticates GitHub AND was used
// by crypto.js as the PBKDF2 passphrase to derive the AES key.
// Groq key is saved encrypted in the vault on first run, retrieved on all subsequent ones.
async function init({ pat, repo, groqKey }) {
  _pat  = pat;
  _repo = repo;

  sessionStorage.setItem('panda_pat',  pat);

  // Verify GitHub access
  try {
    const me = await _api('GET', `repos/${repo}`);
    console.log('[sync] Vault repo:', me.full_name);
    setSyncStatus('ok', 'Connected');
  } catch(e) {
    setSyncStatus('err', 'Vault error');
    throw new Error('GitHub access failed — check your PAT and repo name. ' + e.message);
  }

  // Load or save Groq key from/to vault
  const resolvedGroq = await resolveGroqKey(groqKey);
  if (resolvedGroq) {
    sessionStorage.setItem('panda_groq', resolvedGroq);
  } else {
    setSyncStatus('err', 'No Groq key');
    throw new Error('No Groq API key found. Enter it in the unlock screen.');
  }

  // Start auto-flush timer
  _flushTimer = setInterval(() => { if (_dirty) flush(); }, FLUSH_INTERVAL);
  console.log('[sync] Ready — Groq key resolved, auto-flush every 60s');
}

// ── Groq key: load from vault or save if provided ──
async function resolveGroqKey(providedKey) {
  // If user provided a key this session, save it to vault and return it
  if (providedKey && providedKey.startsWith('gsk_')) {
    await saveGroqKey(providedKey);
    return providedKey;
  }
  // Try to load from vault
  try {
    const { data } = await readEncrypted(GROQ_CONFIG_PATH);
    if (data?.groqKey) return data.groqKey;
  } catch(e) {
    if (!e.message.includes('404')) console.warn('[sync] Groq key vault read:', e.message);
  }
  return null;
}

async function saveGroqKey(key) {
  const sha = await getSha(GROQ_CONFIG_PATH);
  await writeEncrypted(GROQ_CONFIG_PATH, { groqKey: key }, sha, '[PandaAI] save groq config');
  sessionStorage.setItem('panda_groq', key);
  console.log('[sync] Groq key saved to vault');
}

// ── GitHub API wrapper ────────────────────────
async function _api(method, path, body) {
  const url = `${API}/${path}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${_pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(`GitHub ${method} ${path}: ${err.message || res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Read a file from repo ─────────────────────
// Returns { content (decoded string), sha }
async function readFile(path) {
  const data = await _api('GET', `repos/${_repo}/contents/${path}?ref=${_branch}`);
  const content = atob(data.content.replace(/\n/g,''));
  return { content, sha: data.sha };
}

// ── Read and decrypt a file ───────────────────
async function readEncrypted(path) {
  const { content, sha } = await readFile(path);
  const payload = JSON.parse(content);
  const plain = await window.__pandaCrypto.decryptJSON(payload);
  return { data: plain, sha };
}

// ── Write a file to repo (creates or updates) ─
// content: string (will be base64-encoded for GitHub API)
async function writeFile(path, content, sha, message) {
  const body = {
    message: message || `[PandaAI] ${path}`,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: _branch
  };
  if (sha) body.sha = sha; // required for updates
  return _api('PUT', `repos/${_repo}/contents/${path}`, body);
}

// ── Write encrypted JSON to repo ─────────────
async function writeEncrypted(path, data, sha, message) {
  const payload = await window.__pandaCrypto.encryptJSON(data);
  const json = JSON.stringify(payload);
  return writeFile(path, json, sha, message);
}

// ── Write binary file encrypted ───────────────
async function writeBinaryEncrypted(path, arrayBuffer, sha, message) {
  const payload = await window.__pandaCrypto.encryptBinary(arrayBuffer);
  const json = JSON.stringify(payload);
  return writeFile(path, json, sha, message);
}

// ── Queue a write (batched flush) ─────────────
function queue(path, data, sha) {
  _queue.set(path, { data, sha });
  _dirty = true;
  setSyncStatus('busy', 'Pending sync…');
}

// ── Flush: commit all queued writes ───────────
async function flush(force) {
  if (!_dirty && !force) return;
  if (_queue.size === 0) { _dirty = false; return; }
  setSyncStatus('busy', 'Syncing…');
  const errors = [];
  for (const [path, { data, sha }] of _queue) {
    try {
      const result = await writeEncrypted(path, data, sha, `[PandaAI] vault update`);
      // Update sha for next write
      if (result && result.content) {
        _queue.get(path).sha = result.content.sha;
      }
    } catch(e) {
      console.error('[sync] Write failed:', path, e.message);
      errors.push(path);
    }
  }
  // Remove successfully written items
  for (const [path] of _queue) {
    if (!errors.includes(path)) _queue.delete(path);
  }
  if (errors.length === 0) {
    _dirty = false;
    setSyncStatus('ok', 'Synced ' + new Date().toLocaleTimeString());
    if (window.toast) window.toast('Vault synced', 'ok', 2000);
  } else {
    setSyncStatus('err', 'Sync partial');
    if (window.toast) window.toast('Some files failed to sync — will retry', 'er', 4000);
  }
}

// ── List files in a folder ────────────────────
async function listDir(path) {
  try {
    const items = await _api('GET', `repos/${_repo}/contents/${path}?ref=${_branch}`);
    return Array.isArray(items) ? items : [];
  } catch(e) {
    if (e.message.includes('404')) return [];
    throw e;
  }
}

// ── Delete a file ─────────────────────────────
async function deleteFile(path, sha, message) {
  return _api('DELETE', `repos/${_repo}/contents/${path}`, {
    message: message || `[PandaAI] delete ${path}`,
    sha,
    branch: _branch
  });
}

// ── Get SHA of a file (for updates) ──────────
async function getSha(path) {
  try {
    const data = await _api('GET', `repos/${_repo}/contents/${path}?ref=${_branch}`);
    return data.sha;
  } catch(e) {
    if (e.message.includes('404')) return null;
    throw e;
  }
}

// ── UI sync status helper ─────────────────────
function setSyncStatus(state, label) {
  if (window.setSyncStatus) window.setSyncStatus(state, label);
}

// ── Cleanup ───────────────────────────────────
function destroy() {
  if (_flushTimer) clearInterval(_flushTimer);
  _pat = null;
  _repo = null;
  _queue.clear();
  _dirty = false;
}

// ── Export ───────────────────────────────────
window.__pandaSync = {
  init,
  readFile,
  readEncrypted,
  writeFile,
  writeEncrypted,
  writeBinaryEncrypted,
  saveGroqKey,
  queue,
  flush,
  listDir,
  deleteFile,
  getSha,
  destroy,
  get repo() { return _repo; },
  get dirty() { return _dirty; }
};

console.log('[sync] Module loaded');
})();
