/* ═══════════════════════════════════════════════
   PandaAI 🐼 — Crypto Module
   AES-256-GCM encryption + PBKDF2 key derivation
   Exposes: window.__pandaCrypto
   All operations async, all keys in memory only.
═══════════════════════════════════════════════ */

(function() {
'use strict';

const ENC  = 'AES-GCM';
const HASH = 'SHA-256';
const ITER = 310000;   // PBKDF2 iterations (NIST 2023 recommendation)
const KEY_LEN = 256;
const IV_LEN  = 12;    // 96-bit IV for GCM
const SALT_LEN = 32;

let _key = null;       // CryptoKey — derived from passphrase
let _ready = false;

// ── Key derivation ───────────────────────────
async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, hash: HASH, iterations: ITER },
    base,
    { name: ENC, length: KEY_LEN },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── Encode/decode helpers ────────────────────
function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  // Loop instead of spread — spread causes stack overflow on large buffers
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}
function fromB64(str) {
  const bin = atob(str);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function u8(buf) { return new Uint8Array(buf); }

// ── Encrypt ──────────────────────────────────
// Returns: { ct, iv, salt } — all base64 strings
// If no salt provided, creates a new one (first-time)
async function encrypt(plaintext, saltB64) {
  if (!_key) throw new Error('Crypto not initialised');
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const enc = new TextEncoder();
  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const ct = await crypto.subtle.encrypt({ name: ENC, iv }, _key, data);
  return {
    ct:   toB64(ct),
    iv:   toB64(iv.buffer),
    salt: saltB64 // included for reference (salt baked into key derivation)
  };
}

// ── Decrypt ──────────────────────────────────
// Takes { ct, iv } — both base64 strings
// Returns plaintext string
async function decrypt(payload) {
  if (!_key) throw new Error('Crypto not initialised');
  const { ct, iv } = payload;
  const plain = await crypto.subtle.decrypt(
    { name: ENC, iv: u8(fromB64(iv)) },
    _key,
    u8(fromB64(ct))
  );
  return new TextDecoder().decode(plain);
}

// ── Encrypt binary (for file blobs) ──────────
// Takes ArrayBuffer, returns { ct, iv } base64
async function encryptBinary(arrayBuffer) {
  if (!_key) throw new Error('Crypto not initialised');
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt({ name: ENC, iv }, _key, arrayBuffer);
  return { ct: toB64(ct), iv: toB64(iv.buffer) };
}

// ── Decrypt binary ────────────────────────────
// Returns ArrayBuffer
async function decryptBinary(payload) {
  if (!_key) throw new Error('Crypto not initialised');
  const { ct, iv } = payload;
  return crypto.subtle.decrypt(
    { name: ENC, iv: u8(fromB64(iv)) },
    _key,
    u8(fromB64(ct))
  );
}

// ── Encrypt JSON object ───────────────────────
async function encryptJSON(obj) {
  return encrypt(JSON.stringify(obj));
}

// ── Decrypt to JSON ───────────────────────────
async function decryptJSON(payload) {
  const str = await decrypt(payload);
  return JSON.parse(str);
}

// ── Hash (for integrity / file dedup) ────────
// Returns hex string
async function sha256(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest(HASH, buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Generate a random salt ────────────────────
function newSalt() {
  return toB64(crypto.getRandomValues(new Uint8Array(SALT_LEN)).buffer);
}

// ── Init ─────────────────────────────────────
// Called once per session with the user's passphrase.
// Salt is stored in GitHub (public metadata) — safe because:
// the salt only slows down brute-force, the passphrase is the secret.
async function init(passphrase) {
  if (!passphrase || passphrase.length < 6) {
    throw new Error('Passphrase too short (minimum 6 characters)');
  }

  // Store passphrase in sessionStorage for same-session tab reopens
  sessionStorage.setItem('panda_pass', passphrase);

  // Load or create salt from localStorage (salt is not secret)
  let saltB64 = localStorage.getItem('panda_salt');
  if (!saltB64) {
    saltB64 = newSalt();
    localStorage.setItem('panda_salt', saltB64);
  }

  const salt = u8(fromB64(saltB64)).buffer;
  _key = await deriveKey(passphrase, salt);
  _ready = true;
  console.log('[crypto] Key derived — ready');
  return saltB64;
}

// ── Re-init with existing salt (tab refresh) ──
async function reinit(passphrase, saltB64) {
  const salt = u8(fromB64(saltB64)).buffer;
  _key = await deriveKey(passphrase, salt);
  _ready = true;
}

// ── Lock (clear key from memory) ─────────────
function lock() {
  _key = null;
  _ready = false;
  sessionStorage.removeItem('panda_pass');
  console.log('[crypto] Locked — key cleared');
}

// ── Export ───────────────────────────────────
window.__pandaCrypto = {
  init,
  reinit,
  lock,
  encrypt,
  decrypt,
  encryptBinary,
  decryptBinary,
  encryptJSON,
  decryptJSON,
  sha256,
  newSalt,
  toB64,
  fromB64,
  get ready() { return _ready; }
};

console.log('[crypto] Module loaded');
})();
