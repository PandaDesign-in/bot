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

// ── Math-er: analyse selected mesh ───────────
async function analyseMesh(meshData) {
  if (!window.__pandaAI) { window.toast('AI not ready', 'nfo'); return; }

  const body     = document.getElementById('analysis-body');
  const btnSave  = document.getElementById('btn-save-rep');
  const btnPrint = document.getElementById('btn-print-rep');

  // Auto-expand analysis panel to show report
  const panel = document.getElementById('panel-analysis');
  const split  = document.getElementById('analysis-split');
  split.classList.remove('focus-chat');
  split.classList.add('focus-report');
  document.getElementById('btn-focus-report').textContent = '⤡';
  if (!panel.classList.contains('pan-max')) {
    panel.classList.add('pan-max');
    document.getElementById('btn-pan-max').textContent = '⤡';
    document.getElementById('btn-pan-max').title = 'Restore panel';
  }

  body.innerHTML = renderSkeleton();
  btnSave.disabled = true; btnPrint.disabled = true;
  window.toast(`🧮 Math-er: analysing "${meshData.name}"…`, 'nfo', 90000);

  try {
    const report = await window.__pandaAI.analyseMeshMath(meshData);
    _lastReport = report;
    _lastMeta   = {
      filename: meshData.name,
      format:   'Mesh Component',
      vertices: meshData.vertices,
      faces:    meshData.faces,
      dimensions: meshData.dimensions,
      meshes: 1
    };
    body.innerHTML = renderMarkdown(report);
    btnSave.disabled = false; btnPrint.disabled = false;
    window.toast('🧮 Math-er analysis complete', 'ok', 2500);
    window.__pandaAI.appendMsg('assistant',
      `🧮 Math-er: analysis of "${meshData.name}" complete — see analysis panel.`);
  } catch(e) {
    body.innerHTML = `<div class="aempty">🧮 Math-er failed: ${esc(e.message)}</div>`;
    window.toast('Math-er error: ' + e.message, 'er', 5000);
  }
}

// ── Print / PDF report ────────────────────────
function printReport() {
  if (!_lastReport || !_lastMeta) { window.toast('No report to print', 'nfo'); return; }
  const persona  = window.__pandaAI?.persona || 'architecture';
  const generated = new Date().toLocaleString();
  const dims = _lastMeta.dimensions
    ? `${_lastMeta.dimensions.x} × ${_lastMeta.dimensions.y} × ${_lastMeta.dimensions.z}`
    : '—';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>PandaAI Report — ${esc(_lastMeta.filename)}</title>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;max-width:820px;margin:36px auto;color:#1a1a1a;font-size:13.5px;line-height:1.75}
  h1{font-size:21px;border-bottom:2px solid #1a6fd4;padding-bottom:8px;margin-bottom:6px}
  h3{font-size:13.5px;color:#1a6fd4;margin:14px 0 5px;font-weight:700}
  .meta{color:#666;font-size:11.5px;margin-bottom:22px;line-height:1.7}
  p{margin-bottom:5px}ul{padding-left:18px;margin-bottom:5px}li{margin-bottom:2px}
  code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:12px}
  strong{color:#111}.fw{color:#d97706}.fe{color:#dc2626}.fo{color:#16a34a}
  @media print{body{margin:16px}button{display:none}}
  .print-btn{margin-top:18px;padding:7px 18px;background:#1a6fd4;color:#fff;border:none;border-radius:5px;font-size:13px;cursor:pointer}
</style>
</head>
<body>
<h1>🐼 PandaAI Analysis Report</h1>
<div class="meta">
  <strong>File:</strong> ${esc(_lastMeta.filename)} &nbsp;·&nbsp;
  <strong>Format:</strong> ${esc(_lastMeta.format || '—')} &nbsp;·&nbsp;
  <strong>Persona:</strong> ${esc(persona)}<br>
  <strong>Geometry:</strong> ${(_lastMeta.vertices||0).toLocaleString()} verts &nbsp;·&nbsp;
  ${(_lastMeta.faces||0).toLocaleString()} faces &nbsp;·&nbsp;
  ${(_lastMeta.meshes||0)} meshes &nbsp;·&nbsp; ${dims}<br>
  <strong>Generated:</strong> ${esc(generated)}
</div>
${renderMarkdown(_lastReport)}
<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
</body>
</html>`;
  const w = window.open('', '_blank', 'width=920,height=720,menubar=no,toolbar=no');
  if (!w) { window.toast('Pop-up blocked — allow pop-ups for this site', 'er', 5000); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
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
window.__pandaAnalysis = { init, run, save, chatRefine, printReport, analyseMesh };
console.log('[analysis] Module loaded');
})();
