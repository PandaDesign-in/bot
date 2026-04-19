/* ═══════════════════════════════════════════════
   PandaAI 🐼 — Analysis Module
   Drives the bottom analysis panel.
   Uses 70B model with charmap persona.
   Saves reports encrypted to GitHub /reports/
   Exposes: window.__pandaAnalysis
═══════════════════════════════════════════════ */

(function() {
'use strict';

let _lastReport = null;
let _lastMeta = null;

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

  const body = document.getElementById('analysis-body');
  const btnAnalyse = document.getElementById('btn-analyse');
  const btnSave = document.getElementById('btn-save-rep');

  btnAnalyse.disabled = true;
  btnAnalyse.textContent = '⏳ Analysing…';
  body.innerHTML = renderSkeleton();

  const sceneSummary = window.__pandaRenderer.getSceneSummary();
  const ifcMeta = window.__ifcMeta || null;

  try {
    const report = await window.__pandaAI.analyseFile(sceneSummary, ifcMeta);
    _lastReport = report;
    _lastMeta = sceneSummary;

    body.innerHTML = renderMarkdown(report);
    btnSave.disabled = false;
    window.toast('Analysis complete', 'ok', 2000);

    // Also add a summary to chat
    window.__pandaAI.appendMsg('assistant',
      `📊 Analysis complete for "${sceneSummary.filename}". See the analysis panel below for the full report.`
    );
  } catch(e) {
    body.innerHTML = `<div class="aempty">Analysis failed: ${esc(e.message)}</div>`;
    window.toast('Analysis error: ' + e.message, 'er', 5000);
  }

  btnAnalyse.disabled = false;
  btnAnalyse.textContent = 'Analyse File';
}

// ── Save report to GitHub /reports/ ──────────
async function save() {
  if (!_lastReport || !_lastMeta) { window.toast('No report to save', 'nfo'); return; }
  if (!window.__pandaSync) { window.toast('Sync not ready', 'nfo'); return; }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const persona = window.__pandaAI?.persona || 'architecture';
  const filename = `${_lastMeta.filename}_${persona}_${ts}`;
  const path = `reports/${filename}.json`;

  const reportObj = {
    filename: _lastMeta.filename,
    format: _lastMeta.format,
    persona,
    generated: new Date().toISOString(),
    sceneSummary: _lastMeta,
    report: _lastReport
  };

  try {
    await window.__pandaSync.writeEncrypted(path, reportObj, null,
      `[PandaAI] save report: ${_lastMeta.filename}`
    );
    window.toast(`Report saved to vault: ${filename}`, 'ok', 4000);
  } catch(e) {
    window.toast('Save failed: ' + e.message, 'er', 5000);
  }
}

// ── Markdown renderer (simple, no deps) ──────
function renderMarkdown(md) {
  if (!md) return '';
  let html = esc(md);

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h3>$1</h3>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Flag icons — colour them
  html = html.replace(/⚠️/g, '<span class="fw">⚠️</span>');
  html = html.replace(/🔴/g, '<span class="fe">🔴</span>');
  html = html.replace(/✅/g, '<span class="fo">✅</span>');
  html = html.replace(/🎨/g, '<span style="color:var(--int)">🎨</span>');
  html = html.replace(/🔄/g, '<span style="color:var(--acc)">🔄</span>');

  // Lists
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

  // Numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Paragraphs (double newline → p)
  html = html.split(/\n{2,}/).map(block => {
    if (block.startsWith('<h') || block.startsWith('<ul') || block.startsWith('<li')) return block;
    return `<p>${block.replace(/\n/g, ' ')}</p>`;
  }).join('\n');

  return html;
}

// ── Loading skeleton ──────────────────────────
function renderSkeleton() {
  return `
    <div style="display:flex;flex-direction:column;gap:8px;padding:4px 0">
      ${['40%','80%','60%','90%','70%','50%','85%'].map(w =>
        `<div style="height:10px;width:${w};background:var(--bg3);border-radius:4px;animation:blink 1s infinite"></div>`
      ).join('')}
    </div>
  `;
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Export ───────────────────────────────────
window.__pandaAnalysis = { init, run, save };
console.log('[analysis] Module loaded');
})();
