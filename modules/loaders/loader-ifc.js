/* PandaAI — IFC Loader (BIM / Industry Foundation Classes)
   Uses web-ifc IIFE build directly — no web-ifc-three needed.
   Loads all geometry with material colors from the IFC model. */
(function() {
'use strict';

const IIFE_URL = 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.57/web-ifc-api-iife.js';
const WASM_DIR = 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.57/';

let _ifcAPI = null;

async function ensureAPI() {
  if (_ifcAPI) return _ifcAPI;
  // Load IIFE — exposes window.WebIFC
  if (!window.WebIFC) {
    await new Promise((res, rej) => {
      if (document.querySelector(`script[src="${IIFE_URL}"]`)) { res(); return; }
      const s = document.createElement('script');
      s.src = IIFE_URL; s.onload = res;
      s.onerror = () => rej(new Error('Failed to load web-ifc IIFE from CDN'));
      document.head.appendChild(s);
    });
  }
  if (!window.WebIFC) throw new Error('WebIFC not exposed after IIFE load');
  const api = new window.WebIFC.IfcAPI();
  api.SetWasmPath(WASM_DIR);
  await api.Init();
  _ifcAPI = api;
  return api;
}

async function load(buf, THREE, scene) {
  window.toast('Loading IFC (BIM) — initialising WebIFC…', 'nfo', 8000);

  const api = await ensureAPI();

  const modelID = api.OpenModel(new Uint8Array(buf), {
    COORDINATE_TO_ORIGIN: true,
    USE_FAST_BOOLS: true
  });

  window.toast('IFC: reading geometry…', 'nfo', 5000);

  const group = new THREE.Group();
  const allMeshes = api.LoadAllGeometry(modelID);

  for (let i = 0; i < allMeshes.size(); i++) {
    const mesh = allMeshes.get(i);
    const geoms = mesh.geometries;

    for (let j = 0; j < geoms.size(); j++) {
      try {
        const gd   = geoms.get(j);
        const geom = api.GetGeometry(modelID, gd.geometryExpressID);

        const rawVerts   = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const rawIndices = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());

        if (!rawVerts.length || !rawIndices.length) { geom.delete(); continue; }

        // Vertex layout: x,y,z, nx,ny,nz (stride 6)
        const nVerts = rawVerts.length / 6;
        const pos    = new Float32Array(nVerts * 3);
        const norm   = new Float32Array(nVerts * 3);
        for (let k = 0; k < nVerts; k++) {
          pos[k*3]   = rawVerts[k*6];
          pos[k*3+1] = rawVerts[k*6+1];
          pos[k*3+2] = rawVerts[k*6+2];
          norm[k*3]  = rawVerts[k*6+3];
          norm[k*3+1]= rawVerts[k*6+4];
          norm[k*3+2]= rawVerts[k*6+5];
        }

        const bGeo = new THREE.BufferGeometry();
        bGeo.setAttribute('position', new THREE.BufferAttribute(pos,  3));
        bGeo.setAttribute('normal',   new THREE.BufferAttribute(norm, 3));
        bGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(rawIndices), 1));
        bGeo.applyMatrix4(new THREE.Matrix4().fromArray(gd.flatTransformation));

        const c   = gd.color;
        const mat = new THREE.MeshPhongMaterial({
          color:      new THREE.Color(c.x, c.y, c.z),
          opacity:    c.w,
          transparent: c.w < 0.99,
          side:       THREE.DoubleSide,
          depthWrite: c.w >= 0.99,
          shininess:  30
        });
        group.add(new THREE.Mesh(bGeo, mat));
        geom.delete();
      } catch (_) { /* skip bad geometry */ }
    }
    mesh.delete();
  }
  allMeshes.delete();
  api.CloseModel(modelID);

  window.toast(`IFC loaded — ${group.children.length} elements`, 'ok', 3000);

  // Extract BIM metadata for analysis panel
  extractMeta(api, modelID - 1 < 0 ? 0 : modelID).catch(() => {});

  return group;
}

async function extractMeta(api, modelID) {
  try {
    const TYPES = {
      'Walls':    api.IFCWALL,    'Slabs':     api.IFCSLAB,
      'Columns':  api.IFCCOLUMN, 'Beams':      api.IFCBEAM,
      'Doors':    api.IFCDOOR,   'Windows':    api.IFCWINDOW,
      'Spaces':   api.IFCSPACE,  'Storeys':    api.IFCBUILDINGSTOREY,
      'Roofs':    api.IFCROOF,   'Stairs':     api.IFCSTAIR,
    };
    const summary = {};
    for (const [name, typeID] of Object.entries(TYPES)) {
      if (!typeID) continue;
      const ids = await api.GetLineIDsWithType(modelID, typeID);
      if (ids && ids.size() > 0) summary[name] = ids.size();
    }
    if (Object.keys(summary).length) {
      const line = Object.entries(summary).map(([k,v]) => `${k}: ${v}`).join(' · ');
      window.toast('BIM: ' + line, 'nfo', 8000);
      window.__ifcMeta = summary;
    }
  } catch (_) { /* metadata is optional */ }
}

window.__ifcLoader = { load };
console.log('[loader-ifc] Ready');
})();
