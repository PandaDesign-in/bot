/* ═══════════════════════════════════════════════
   PandaAI 🐼 — Analysis Module
   Bottom analysis panel + refinement chat.
   Uses 70B model with charmap persona.
   Saves reports encrypted to GitHub /reports/
   Exposes: window.__pandaAnalysis
═══════════════════════════════════════════════ */

(function() {
'use strict';

let _lastReport = null;
let _lastMeta   = null;

// ── Init ─────────────────────────────────────
function init() {
  console.log('[analysis] Module ready');
}

// ── Run analysis ─────────────────────────────
async function run() {
  if (!window.__pandaRenderer?.hasFile) {
    window.toast('Load a file first', 'nfo'); return;
  }
  if (!window.__pandaAI) {
    window.toast('AI not ready', 'nfo'); return;
  }

  const body       = document.getElementById('analysis-body');
  const btnAnalyse = document.getElementById('btn-analyse');
  const btnSave    = document.getElementById('btn-save-rep');
  const achatSend  = document.getElementById('achat-send');

  btnAnalyse.disabled = true;
  btnAnalyse.textContent = '⏳ Analysing…';
  body.innerHTML = renderSkeleton();

  const sceneSummary = window.__pandaRenderer.getSceneSummary();
  const ifcMeta = window.__ifcMeta || null;

  try {
    const report = await window.__pandaAI.analyseFile(sceneSummary, ifcMeta);
    _lastReport = report;
    _lastMeta   = sceneSummary;

    body.innerHTML = renderMarkdown(report);
    btnSave.disabled = false;
    // Enable analysis chat now that we have a report
    if (achatSend) achatSend.disabled = !document.getElementById('achat-in')?.value.trim();
    window.toast('Analysis complete', 'ok', 2000);

    // Add summary to main chat
    window.__pandaAI.appendMsg('assistant',
      `📊 Analysis complete for "${sceneSummary.filename}". See the analysis panel below for the full report.`
    );

    // Reset analysis chat history
    const achatMsgs = document.getElementById('achat-msgs');
    if (achatMsgs) {
      achatMsgs.innerHTML = '';
      const hint = document.createElement('div');
      hint.className = 'achat-empty';
      hint.id = 'achat-empty';
      hint.innerHTML = `<div>Report ready</div><div>Ask to refine, focus on a specific area, or re-analyse differently</div>`;
      achatMsgs.appendChild(hint);
    }
  } catch(e) {
    body.innerHTML = `<div class="aempty">Analysis failed: ${esc(e.message)}</div>`;
    window.toast('Analysis error: ' + e.message, 'er', 5000);
  }

  btnAnalyse.disabled = false;
  btnAnalyse.textContent = 'Analyse File';
}

// ── Analysis refinement chat ─────────────────
async function chatRefine(userMessage) {
  if (!_lastReport) {
    window.toast('Run analysis first', 'nfo'); return;
  }
  if (!window.__pandaAI) {
    window.toast('AI not ready', 'nfo'); return;
  }

  const msgs     = document.getElementById('achat-msgs');
  const achatIn  = document.getElementById('achat-in');
  const achatSend = document.getElementById('achat-send');
  if (!msgs) return;

  const empty = document.getElementById('achat-empty');
  if (empty) empty.remove();

  // Add user bubble
  const userEl = document.createElement('div');
  userEl.className = 'acmsg user';
  userEl.textContent = userMessage;
  msgs.appendChild(userEl);
  msgs.scrollTop = msgs.scrollHeight;

  // Typing indicator
  const typing = document.createElement('div');
  typing.className = 'acmsg ai';
  typing.innerHTML = '<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>';
  msgs.appendChild(typing);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const context = `File: ${_lastMeta?.filename} (${_lastMeta?.format})\n\nFull analysis:\n${_lastReport}`;
    const reply = await window.__pandaAI.analyseFileChat(context, userMessage);
    typing.innerHTML = renderMarkdown(reply);
    typing.className = 'acmsg ai';
  } catch(e) {
    typing.textContent = '⚠️ Error: ' + e.message;
    window.toast('Refinement error: ' + e.message, 'er', 5000);
  }

  msgs.scrollTop = msgs.scrollHeight;
  // Re-enable send
  if (achatSend) achatSend.disabled = !achatIn?.value.trim();
}

// ── Save report to GitHub /reports/ ──────────
async function save() {
  if (!_lastReport || !_lastMeta) { window.toast('No report to save', 'nfo'); return; }
  if (!window.__pandaSync) { window.toast('Sync not ready', 'nfo'); return; }

  const ts      = new Date().toISOString().replace(/[:.]/g, '-');
  const persona = window.__pandaAI?.persona || 'architecture';
  const fname   = `${_lastMeta.filename}_${persona}_${ts}`;
  const path    = `reports/${fname}.json`;

  const reportObj = {
    filename: _lastMeta.filename, format: _lastMeta.format,
    persona, generated: new Date().toISOString(),
    sceneSummary: _lastMeta, report: _lastReport
  };

  try {
    await window.__pandaSync.writeEncrypted(path, reportObj, null, `[PandaAI] save report: ${_lastMeta.filename}`);
    window.toast(`Report saved: ${fname}`, 'ok', 4000);
  } catch(e) {
    window.toast('Save failed: ' + e.message, 'er', 5000);
  }
}

// ── Simple markdown renderer ──────────────────
function renderMarkdown(md) {
  if (!md) return '';
  let html = esc(md);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm,  '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm,   '<h3>$1</h3>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g,     '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g,     '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g,     '<code>$1</code>');
  html = html.replace(/⚠️/g, '<span class="fw">⚠️</span>');
  html = html.replace(/🔴/g, '<span class="fe">🔴</span>');
  html = html.replace(/✅/g, '<span class="fo">✅</span>');
  html = html.replace(/🎨/g, '<span style="color:var(--int)">🎨</span>');
  html = html.replace(/🔄/g, '<span style="color:var(--acc)">🔄</span>');
  html = html.replace(/^[-*] (.+)$/gm,    '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
  html = html.replace(/^\d+\. (.+)$/gm,   '<li>$1</li>');
  html = html.split(/\n{2,}/).map(block => {
    if (block.startsWith('<h') || block.startsWith('<ul') || block.startsWith('<li')) return block;
    return `<p>${block.replace(/\n/g, ' ')}</p>`;
  }).join('\n');
  return html;
}

function renderSkeleton() {
  return `<div style="display:flex;flex-direction:column;gap:8px;padding:4px 0">
    ${['40%','80%','60%','90%','70%','50%','85%'].map(w =>
      `<div style="height:10px;width:${w};background:var(--bg3);border-radius:4px;animation:blink 1s infinite"></div>`
    ).join('')}
  </div>`;
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Export ───────────────────────────────────
window.__pandaAnalysis = { init, run, save, chatRefine };
console.log('[analysis] Module loaded');
})();
