/* PandaAI — DWG Loader
   DWG is a closed binary format. Strategy:
   1. Try to convert to DXF in-browser using libredwg WASM (experimental)
   2. Fall back to guided error with conversion instructions
*/
(function() {
'use strict';

// libredwg WASM — experimental browser build
const LIBREDWG_URL = 'https://cdn.jsdelivr.net/npm/libredwg-browser@0.0.3/libredwg.js';

async function load(buf, THREE, defaultMat) {
  window.toast('DWG: attempting conversion via libredwg…', 'nfo', 4000);

  try {
    if (!window.LibreDWG) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = LIBREDWG_URL; s.onload = res;
        s.onerror = () => { res(); }; // don't hard-fail
        document.head.appendChild(s);
      });
    }

    if (window.LibreDWG && window.LibreDWG.dwg2dxf) {
      const arr = new Uint8Array(buf);
      const dxfText = await window.LibreDWG.dwg2dxf(arr);
      if (dxfText) {
        const dxfBuf = new TextEncoder().encode(dxfText).buffer;
        if (!window.__dxfLoader) await window.loadMod('modules/loaders/loader-dxf.js');
        return window.__dxfLoader.load(dxfBuf, THREE, defaultMat);
      }
    }
  } catch(e) {
    console.warn('[loader-dwg] libredwg failed:', e.message);
  }

  // Fallback: show helpful guide
  showDWGGuide();
  return null;
}

function showDWGGuide() {
  window.toast('DWG: libredwg unavailable. Use AutoCAD / DraftSight to export as DXF, then reload.', 'er', 8000);
  const body = document.getElementById('analysis-body');
  if (body) {
    body.innerHTML = `
      <h3>DWG File — Conversion Required</h3>
      <p>DWG is a closed proprietary format (Autodesk). To view in PandaAI:</p>
      <ul>
        <li><strong>AutoCAD:</strong> File → Save As → DXF</li>
        <li><strong>DraftSight (free):</strong> File → Export → DXF</li>
        <li><strong>LibreCAD (free):</strong> File → Export → DXF</li>
        <li><strong>FreeCAD (free):</strong> Import DWG → Export DXF or STEP</li>
        <li><strong>Online:</strong> CloudConvert DWG → DXF (no install)</li>
      </ul>
      <p>Once exported as DXF, drag-drop the .dxf file into PandaAI.</p>
    `;
    document.getElementById('analysis-empty')?.remove();
  }
}

window.__dwgLoader = { load };
console.log('[loader-dwg] Ready');
})();
