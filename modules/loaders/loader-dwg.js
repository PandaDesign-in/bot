/* PandaAI — DWG Loader
   DWG is Autodesk's closed proprietary binary format.
   There is no reliable open-source browser parser for it.
   Strategy: show a clear conversion guide and offer to analyse the metadata. */
(function() {
'use strict';

async function load(buf, THREE, defaultMat) {
  // Verify it is actually a DWG file (magic bytes: "AC" version string)
  const header = new TextDecoder().decode(new Uint8Array(buf, 0, 6));
  const isDWG  = header.startsWith('AC');
  const ver    = isDWG ? header.trim() : '?';

  const verMap = {
    'AC1015': 'AutoCAD 2000',   'AC1018': 'AutoCAD 2004',
    'AC1021': 'AutoCAD 2007',   'AC1024': 'AutoCAD 2010',
    'AC1027': 'AutoCAD 2013',   'AC1032': 'AutoCAD 2018+',
  };
  const verName = verMap[ver] || ('DWG ' + ver);

  // Show guide in analysis panel
  const body = document.getElementById('analysis-body');
  if (body) {
    const empty = document.getElementById('analysis-empty');
    if (empty) empty.remove();
    body.innerHTML = `
      <h3>DWG File Detected — ${verName}</h3>
      <p><strong>DWG is a closed Autodesk binary format.</strong> No browser can parse it directly.
      Export to DXF or another open format, then drag-drop back into PandaAI.</p>
      <h3>How to export</h3>
      <ul>
        <li><strong>AutoCAD / AutoCAD LT</strong> — Save As → DXF (or STEP for 3D solids)</li>
        <li><strong>DraftSight (free)</strong> — File → Save As → DXF</li>
        <li><strong>LibreCAD (free)</strong> — File → Export → DXF</li>
        <li><strong>FreeCAD (free)</strong> — Import DWG → File → Export → STEP or OBJ</li>
        <li><strong>ODA File Converter (free)</strong> — Batch convert DWG ↔ DXF offline</li>
        <li><strong>CloudConvert online</strong> — DWG → DXF (no install needed)</li>
      </ul>
      <p style="color:var(--t2);font-size:11px">DXF is the open exchange format for the same data — PandaAI renders it fully.</p>
    `;
  }

  window.toast(`DWG (${verName}) — export to DXF to visualise. See guide below.`, 'nfo', 8000);
  return null; // renderer will show fallback state
}

window.__dwgLoader = { load };
console.log('[loader-dwg] Ready');
})();
