/* ═══════════════════════════════════════════════
   PandaAI 🐼 — AI Router Module
   Routes: chat → 8B | analysis → 70B | voice → Whisper
   Reads charmap.json for persona system prompts.
   Manages session history and context.
   Exposes: window.__pandaAI
═══════════════════════════════════════════════ */

(function() {
'use strict';

const GROQ_URL   = 'https://api.groq.com/openai/v1';
let _groqKey = null;
let _charmap = null;
let _persona = 'architecture';
let _history = [];          // { role, content }[]
let _recording = false;
let _mediaRecorder = null;
let _audioChunks = [];
const MAX_HISTORY = 40;     // keep last 40 turns in context

// Models (from charmap)
const MODELS = {
  chat:    'llama-3.1-8b-instant',
  analysis:'llama-3.3-70b-versatile',
  voice:   'whisper-large-v3',
  summary: 'llama-3.1-8b-instant'
};

// ── Init ─────────────────────────────────────
async function init({ groqKey, persona }) {
  _groqKey = groqKey || sessionStorage.getItem('panda_groq') || '';
  _persona = persona || 'architecture';

  // Load charmap
  try {
    const res = await fetch('./charmap.json');
    _charmap = await res.json();
    // Override models from charmap if present
    if (_charmap.app?.model_routing) {
      Object.assign(MODELS, _charmap.app.model_routing);
    }
  } catch(e) {
    console.warn('[ai] charmap.json load failed:', e.message);
  }

  // Welcome message
  const aiStatus = _groqKey
    ? `🐼 PandaAI ready in ${_persona === 'architecture' ? '🏛️ Architecture' : '🛋️ Interior'} mode. Load a file or ask me anything.`
    : `🐼 PandaAI loaded. ⚠️ No Groq key — AI features disabled. Add your key in ⚙️ Settings → Groq API Key.`;
  appendMsg('assistant', aiStatus);
  console.log('[ai] Module ready — persona:', _persona);
}

// ── Set persona ───────────────────────────────
function setPersona(p) {
  _persona = p;
  // Add persona-change message to context
  _history.push({
    role: 'system',
    content: `User has switched to ${p === 'architecture' ? 'Architecture' : 'Interior Design'} mode.`
  });
  appendMsg('assistant', `Switched to ${p === 'architecture' ? '🏛️ Architecture' : '🛋️ Interior'} mode.`);
}

// ── Get current system prompt from charmap ────
function getSystemPrompt(model) {
  if (!_charmap) {
    return model === '70b'
      ? 'You are PandaAI, an expert architectural and interior design AI assistant.'
      : 'You are PandaAI, a helpful design AI assistant.';
  }
  const p = _charmap.personas?.[_persona];
  if (!p) return 'You are PandaAI, a helpful design AI assistant.';
  return p.system_prompt + '\n\nOutput format: ' + (p.output_format || 'clear markdown');
}

// ── Chat (8B) ─────────────────────────────────
async function chat(userMessage) {
  if (!_groqKey) {
    appendMsg('user', userMessage);
    appendMsg('assistant', '⚠️ No Groq API key set. Go to ⚙️ Settings → Groq API Key and add yours (free at console.groq.com).');
    return;
  }

  appendMsg('user', userMessage);
  showTyping(true);
  updateModelPill('8b');

  // Add context about currently loaded file if any
  let contextNote = '';
  if (window.__pandaRenderer?.hasFile) {
    const summary = window.__pandaRenderer.getSceneSummary();
    if (summary) {
      contextNote = `\n\n[Context: User has loaded "${summary.filename}" (${summary.format}) — ${summary.vertices.toLocaleString()} vertices, ${summary.faces.toLocaleString()} faces, dimensions ${summary.dimensions.x}×${summary.dimensions.y}×${summary.dimensions.z}]`;
    }
  }

  _history.push({ role: 'user', content: userMessage + contextNote });
  if (_history.length > MAX_HISTORY) _history.splice(0, _history.length - MAX_HISTORY);

  try {
    const reply = await callGroq(MODELS.chat, getSystemPrompt('8b'), _history);
    _history.push({ role: 'assistant', content: reply });
    showTyping(false);
    appendMsg('assistant', reply);
    logToSession('user', userMessage);
    logToSession('assistant', reply);
  } catch(e) {
    showTyping(false);
    appendMsg('assistant', `Error: ${e.message}`);
    toast('Groq error: ' + e.message, 'er', 5000);
  }
}

// ── Analysis prompt (70B) — called by analysis.js
async function analyseFile(sceneSummary, ifcMeta) {
  if (!_groqKey) throw new Error('Groq API key not set');
  updateModelPill('70b');

  const p = _charmap?.personas?.[_persona];
  const sections = p?.analysis_sections || ['Overview', 'Observations', 'Flags', 'Recommendations'];
  const focusAreas = p?.focus_areas?.join(', ') || 'spatial and structural qualities';

  let prompt = `Analyse this 3D model/drawing:\n\n`;
  prompt += `File: ${sceneSummary.filename} (${sceneSummary.format})\n`;
  prompt += `Geometry: ${sceneSummary.vertices.toLocaleString()} vertices, ${sceneSummary.faces.toLocaleString()} faces, ${sceneSummary.meshes} mesh(es)\n`;
  prompt += `Dimensions: ${sceneSummary.dimensions.x} × ${sceneSummary.dimensions.y} × ${sceneSummary.dimensions.z} units\n`;
  prompt += `Aspect ratios: XY=${sceneSummary.aspectRatio.xy}, XZ=${sceneSummary.aspectRatio.xz}\n`;
  if (sceneSummary.materials?.length) prompt += `Named materials: ${sceneSummary.materials.join(', ')}\n`;
  if (ifcMeta) {
    prompt += `\nBIM Data: `;
    prompt += Object.entries(ifcMeta).map(([t,n]) => `${t.replace('IFC','')}: ${n}`).join(', ') + '\n';
  }
  prompt += `\nFocus on: ${focusAreas}.\n`;
  prompt += `Provide structured analysis with these sections: ${sections.join(', ')}.\n`;
  prompt += `Use ${p?.tone || 'professional'} tone. Flag issues clearly with severity indicators.`;

  const messages = [{ role: 'user', content: prompt }];
  const reply = await callGroq(MODELS.analysis, getSystemPrompt('70b'), messages);
  logToSession('analysis', reply);
  return reply;
}

// ── Voice (Whisper) ───────────────────────────
async function startVoice() {
  if (_recording) { stopVoice(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _audioChunks = [];
    _mediaRecorder = new MediaRecorder(stream);
    _mediaRecorder.ondataavailable = e => _audioChunks.push(e.data);
    _mediaRecorder.onstop = processVoice;
    _mediaRecorder.start();
    _recording = true;
    document.getElementById('btn-mic').classList.add('rec');
    toast('Recording… click mic to stop', 'nfo', 30000);
  } catch(e) {
    toast('Microphone access denied: ' + e.message, 'er');
  }
}

function stopVoice() {
  if (_mediaRecorder && _recording) {
    _mediaRecorder.stop();
    _mediaRecorder.stream.getTracks().forEach(t => t.stop());
    _recording = false;
    document.getElementById('btn-mic').classList.remove('rec');
  }
}

async function processVoice() {
  if (!_audioChunks.length) return;
  toast('Transcribing…', 'nfo', 4000);
  const blob = new Blob(_audioChunks, { type: 'audio/webm' });
  const formData = new FormData();
  formData.append('file', blob, 'audio.webm');
  formData.append('model', MODELS.voice);
  formData.append('response_format', 'json');

  try {
    const res = await fetch(`${GROQ_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${_groqKey}` },
      body: formData
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const transcript = data.text?.trim();
    if (transcript) {
      document.getElementById('chat-in').value = transcript;
      document.getElementById('btn-send').disabled = false;
      document.getElementById('chat-in').dispatchEvent(new Event('input'));
      toast('Transcribed: "' + transcript.substring(0,50) + (transcript.length>50?'…':'"'), 'ok', 4000);
    }
  } catch(e) {
    toast('Transcription error: ' + e.message, 'er', 5000);
  }
}

// ── Analysis refinement chat (70B, report in context) ──
async function analyseFileChat(reportContext, userMessage) {
  if (!_groqKey) throw new Error('Groq API key not set');
  updateModelPill('70b');
  const sysPrompt = getSystemPrompt('70b') +
    '\n\nYou are discussing an analysis report. Respond to the user\'s follow-up question or refinement request about the report.\n\nREPORT CONTEXT:\n' + reportContext;
  const messages = [{ role: 'user', content: userMessage }];
  const reply = await callGroq(MODELS.analysis, sysPrompt, messages);
  logToSession('user', userMessage);
  logToSession('assistant', reply);
  return reply;
}

// ── Generate session summary ──────────────────
async function generateSummary() {
  if (!_groqKey || _history.length < 2) return null;
  const messages = [
    ...(_history.slice(-10)),
    { role: 'user', content: 'In 3-5 sentences, summarise what was discussed and any key design decisions or findings in this session.' }
  ];
  try {
    return await callGroq(MODELS.summary, 'You are a concise session summariser.', messages);
  } catch(e) { return null; }
}

// ── Groq API call ─────────────────────────────
async function callGroq(model, systemPrompt, messages) {
  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role === 'analysis' ? 'assistant' : m.role, content: m.content }))
    ],
    temperature: 0.7,
    max_tokens: model.includes('70b') ? 4096 : 2048,
    stream: false
  };

  const res = await fetch(`${GROQ_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${_groqKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message || 'Groq API error ' + res.status);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── UI helpers ────────────────────────────────
function appendMsg(role, content) {
  const msgs = document.getElementById('chat-msgs');
  if (!msgs) return;

  const empty = document.getElementById('chat-empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : role === 'assistant' ? 'ai' : 'sys');
  div.textContent = content;

  if (role !== 'system') {
    const time = document.createElement('div');
    time.className = 'msg-time';
    time.textContent = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    div.appendChild(time);
  }

  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function showTyping(show) {
  const msgs = document.getElementById('chat-msgs');
  if (!msgs) return;
  const existing = msgs.querySelector('.typing');
  if (show && !existing) {
    const t = document.createElement('div');
    t.className = 'typing';
    t.innerHTML = '<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>';
    msgs.appendChild(t);
    msgs.scrollTop = msgs.scrollHeight;
  } else if (!show && existing) {
    existing.remove();
  }
}

function updateModelPill(model) {
  const p8 = document.getElementById('pill-8b');
  const p70 = document.getElementById('pill-70b');
  if (p8) p8.classList.toggle('a70', model === '8b' ? false : false);
  if (p70) p70.classList.toggle('a70', model === '70b');
}

function toast(msg, type, ms) {
  if (window.toast) window.toast(msg, type, ms);
}

// ── Session logging ───────────────────────────
const _sessionLog = [];

// Patterns that must never appear in logs
const _REDACT = [
  /ghp_[A-Za-z0-9]{36}/g,           // GitHub classic PAT
  /github_pat_[A-Za-z0-9_]{82}/g,   // GitHub fine-grained PAT
  /gsk_[A-Za-z0-9]{52}/g,           // Groq API key
  /gsk_[A-Za-z0-9]{48}/g,           // Groq key (shorter variant)
  /Bearer\s+[A-Za-z0-9._\-]{20,}/g, // Authorization headers
  /token\s+[A-Za-z0-9._\-]{20,}/gi, // Token prefix
];

function redact(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const rx of _REDACT) out = out.replace(rx, '[REDACTED]');
  return out;
}

function logToSession(role, content) {
  _sessionLog.push({ role, content: redact(content), ts: new Date().toISOString() });
  if (window.__pandaSync && _sessionLog.length % 10 === 0) flushSession();
}

async function flushSession() {
  if (!_sessionLog.length) return;
  try {
    const week = getWeek();
    const path = `sessions/active-${week}.json`;
    let existing = {};
    try {
      const r = await window.__pandaSync.readEncrypted(path);
      existing = r.data || {};
    } catch(e) { /* new session */ }
    existing.messages = [...(existing.messages || []), ..._sessionLog];
    existing.persona = _persona;
    existing.updated = new Date().toISOString();
    window.__pandaSync.queue(path, existing, existing._sha);
    _sessionLog.length = 0;
  } catch(e) { console.warn('[ai] Session flush failed:', e.message); }
}

function getWeek() {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2,'0')}`;
}

// Flush session on page unload
window.addEventListener('beforeunload', () => flushSession());

// ── Export ───────────────────────────────────
window.__pandaAI = {
  init,
  setPersona,
  chat,
  analyseFile,
  analyseFileChat,
  startVoice,
  stopVoice,
  generateSummary,
  flushSession,
  appendMsg,
  get history() { return _history; },
  get persona() { return _persona; }
};

console.log('[ai] Module loaded');
})();
