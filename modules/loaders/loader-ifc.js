/* PandaAI — IFC Loader (Industry Foundation Classes / BIM) */
(function() {
'use strict';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.51/web-ifc.wasm';
const API_URL  = 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.51/web-ifc-api.js';
const LDR_URL  = 'https://cdn.jsdelivr.net/npm/web-ifc-three@0.0.126/IFCLoader.js';

async function loadScript(url, globalCheck) {
  if (globalCheck && window[globalCheck]) return;
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${url}"]`)) { res(); return; }
    const s = document.createElement('script');
    s.src = url; s.onload = res; s.onerror = () => rej(new Error('Failed: ' + url));
    document.head.appendChild(s);
  });
}

async function load(buf, THREE, scene) {
  window.toast('Loading IFC (BIM) — this may take a moment…', 'nfo', 5000);

  await loadScript(API_URL, 'WebIFC');
  await loadScript(LDR_URL);

  const { IFCLoader } = window;
  if (!IFCLoader) throw new Error('IFCLoader not available');

  const loader = new IFCLoader();
  await loader.ifcManager.setWasmPath(WASM_URL.replace('web-ifc.wasm', ''));

  return new Promise((res, rej) => {
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    loader.load(url, model => {
      URL.revokeObjectURL(url);
      window.toast('IFC loaded — extracting building data…', 'nfo', 3000);
      // Extract metadata
      extractIFCMeta(loader, model);
      res(model);
    }, undefined, rej);
  });
}

async function extractIFCMeta(loader, model) {
  try {
    const mgr = loader.ifcManager;
    const allTypes = ['IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE', 'IFCWALL', 'IFCCOLUMN', 'IFCBEAM', 'IFCSLAB'];
    const summary = {};
    for (const type of allTypes) {
      const ids = await mgr.getAllItemsOfType(model.modelID, mgr.getEntityName(type) || 0, false);
      if (ids && ids.length) summary[type] = ids.length;
    }
    const lines = Object.entries(summary).map(([t, n]) => `${t.replace('IFC','')}: ${n}`);
    if (lines.length) window.toast('BIM: ' + lines.join(' · '), 'nfo', 6000);
    window.__ifcMeta = summary;
  } catch(e) { /* metadata optional */ }
}

window.__ifcLoader = { load };
console.log('[loader-ifc] Ready');
})();
