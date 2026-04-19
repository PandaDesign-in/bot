/* PandaAI — STEP/IGES/SAT Loader (OpenCASCADE WASM) */
(function() {
'use strict';

const OCCT_URL = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.14/dist/occt-import-js.js';
const OCCT_WASM = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.14/dist/occt-import-js.wasm';

let _occt = null;

async function initOCCT() {
  if (_occt) return _occt;
  if (!window.occtimportjs) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = OCCT_URL; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  _occt = await window.occtimportjs({ locateFile: () => OCCT_WASM });
  return _occt;
}

async function load(buf, THREE, defaultMat) {
  window.toast('Loading STEP/IGES (OpenCASCADE WASM)…', 'nfo', 5000);
  const occt = await initOCCT();

  const arr = new Uint8Array(buf);
  const result = occt.ReadStepFile(arr, null);

  if (!result.success) {
    const r2 = occt.ReadIgesFile(arr, null);
    if (!r2.success) throw new Error('STEP/IGES parse failed');
    return buildFromOCCT(r2, THREE, defaultMat);
  }
  return buildFromOCCT(result, THREE, defaultMat);
}

function buildFromOCCT(result, THREE, defaultMat) {
  const group = new THREE.Group();
  for (const mesh of result.meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.attributes.position.array), 3));
    if (mesh.attributes.normal) {
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(mesh.attributes.normal.array), 3));
    }
    if (mesh.index) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.index.array), 1));

    const mat = defaultMat ? defaultMat() : new THREE.MeshPhongMaterial({ color: 0x888888, side: THREE.DoubleSide });
    if (mesh.color) mat.color.set(mesh.color[0], mesh.color[1], mesh.color[2]);
    const m = new THREE.Mesh(geo, mat);
    m.name = mesh.name || '';
    group.add(m);
  }
  return group;
}

window.__stepLoader = { load };
console.log('[loader-step] Ready');
})();
