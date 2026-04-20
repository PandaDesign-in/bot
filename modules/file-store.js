/* ═══════════════════════════════════════════════
   PandaAI 🐼 — File Store Module
   Virtual encrypted file vault.
   Raw bytes stored in IndexedDB (no GitHub size limit).
   File index (metadata) stored encrypted in GitHub /files/index.json.
   Exposes: window.__pandaFiles
═══════════════════════════════════════════════ */

(function() {
'use strict';

// In-memory index: id → { id, name, ext, folder, size, sha, hash, added, ... }
let _index = {};
let _indexSha = null;
const INDEX_PATH = 'files/index.json';

// ── IndexedDB for raw file bytes ──────────────
const IDB_NAME  = 'panda_vault';
const IDB_VER   = 1;
const IDB_STORE = 'files';
let _db = null;

async function openDB() {
  if (_db) return _db;
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess  = e => { _db = e.target.result; res(_db); };
    req.onerror    = () => rej(req.error);
  });
}

async function idbPut(id, buf) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(buf, id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

async function idbGet(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => res(req.result || null);
    req.onerror   = () => rej(req.error);
  });
}

async function idbDelete(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

// ── Format detection map ──────────────────────
const FORMAT_MAP = {
  // ── Group A: Three.js native 3D ──────────────
  stl:   { group:'A', label:'STL',    icon:'🧊', loader:'native' },
  obj:   { group:'A', label:'OBJ',    icon:'🧊', loader:'native' },
  mtl:   { group:'A', label:'MTL',    icon:'🎨', loader:'native' },
  gltf:  { group:'A', label:'GLTF',   icon:'🌐', loader:'native' },
  glb:   { group:'A', label:'GLB',    icon:'🌐', loader:'native' },
  fbx:   { group:'A', label:'FBX',    icon:'🧊', loader:'native' },
  dae:   { group:'A', label:'DAE',    icon:'🧊', loader:'native' },
  '3ds': { group:'A', label:'3DS',    icon:'🧊', loader:'native' },
  ply:   { group:'A', label:'PLY',    icon:'🧊', loader:'native' },
  pcd:   { group:'A', label:'PCD',    icon:'☁️', loader:'native' },
  wrl:   { group:'A', label:'VRML',   icon:'🌐', loader:'native' },
  vrml:  { group:'A', label:'VRML',   icon:'🌐', loader:'native' },
  vtk:   { group:'A', label:'VTK',    icon:'🧊', loader:'native' },
  off:   { group:'A', label:'OFF',    icon:'🧊', loader:'native' },  // inline OFF parser
  '3mf': { group:'A', label:'3MF',    icon:'🖨️', loader:'native' },
  amf:   { group:'A', label:'AMF',    icon:'🖨️', loader:'native' },
  usdz:  { group:'A', label:'USDZ',   icon:'📦', loader:'native' },
  usd:   { group:'A', label:'USD',    icon:'📦', loader:'native' },
  // ── Group B: WASM / specialised parsers ──────
  dxf:    { group:'B', label:'DXF',     icon:'📐', loader:'dxf'   },
  dxb:    { group:'B', label:'DXF-B',   icon:'📐', loader:'dxf',  hint:'DXF binary — may render as DXF' },
  ifc:    { group:'B', label:'IFC',     icon:'🏗️', loader:'ifc'   },
  ifczip: { group:'B', label:'IFC',     icon:'🏗️', loader:'ifc'   },
  ifcxml: { group:'B', label:'IFC-XML', icon:'🏗️', loader:'ifc'   },
  step:   { group:'B', label:'STEP',    icon:'⚙️', loader:'step'  },
  stp:    { group:'B', label:'STEP',    icon:'⚙️', loader:'step'  },
  p21:    { group:'B', label:'STEP',    icon:'⚙️', loader:'step'  },
  iges:   { group:'B', label:'IGES',    icon:'⚙️', loader:'step'  },
  igs:    { group:'B', label:'IGES',    icon:'⚙️', loader:'step'  },
  sat:    { group:'B', label:'SAT',     icon:'⚙️', loader:'step'  },
  sab:    { group:'B', label:'SAB',     icon:'⚙️', loader:'step'  },
  dwg:    { group:'B', label:'DWG',     icon:'📐', loader:'dwg'   },
  '3dm':  { group:'B', label:'3DM',     icon:'🦏', loader:'3dm'   },
  // ── Group C: Point clouds ─────────────────────
  e57:   { group:'C', label:'E57',    icon:'☁️', loader:'cloud' },
  las:   { group:'C', label:'LAS',    icon:'☁️', loader:'cloud' },
  laz:   { group:'C', label:'LAZ',    icon:'☁️', loader:'cloud' },
  xyz:   { group:'C', label:'XYZ',    icon:'☁️', loader:'cloud' },
  pts:   { group:'C', label:'PTS',    icon:'☁️', loader:'cloud' },
  ptx:   { group:'C', label:'PTX',    icon:'☁️', loader:'cloud' },
  // ── Group D: Proprietary (fallback + guide) ───
  // Autodesk
  rvt:   { group:'D', label:'RVT',    icon:'🏢', loader:'fallback', hint:'Export to IFC from Revit (File → Export → IFC)' },
  rfa:   { group:'D', label:'RFA',    icon:'🏢', loader:'fallback', hint:'Export family to IFC or GLTF from Revit' },
  rvz:   { group:'D', label:'RVZ',    icon:'🏢', loader:'fallback', hint:'Revit zip — extract and export to IFC' },
  nwd:   { group:'D', label:'NWD',    icon:'🔍', loader:'fallback', hint:'Export to IFC from Navisworks' },
  nwc:   { group:'D', label:'NWC',    icon:'🔍', loader:'fallback', hint:'Navisworks cache — export to IFC' },
  dwf:   { group:'D', label:'DWF',    icon:'📐', loader:'fallback', hint:'Design Web Format — export to DXF/DWG from AutoCAD' },
  dwfx:  { group:'D', label:'DWFx',   icon:'📐', loader:'fallback', hint:'Export to DXF/DWG from AutoCAD' },
  ipt:   { group:'D', label:'IPT',    icon:'⚙️', loader:'fallback', hint:'Autodesk Inventor part — export to STEP' },
  iam:   { group:'D', label:'IAM',    icon:'⚙️', loader:'fallback', hint:'Autodesk Inventor assembly — export to STEP' },
  idw:   { group:'D', label:'IDW',    icon:'📐', loader:'fallback', hint:'Autodesk Inventor drawing — export to DXF' },
  f3d:   { group:'D', label:'F3D',    icon:'⚙️', loader:'fallback', hint:'Export to STEP from Fusion 360 (File → Export)' },
  f3z:   { group:'D', label:'F3Z',    icon:'⚙️', loader:'fallback', hint:'Fusion 360 archive — export to STEP' },
  // SolidWorks
  sldprt:{ group:'D', label:'SLDPRT', icon:'⚙️', loader:'fallback', hint:'Export to STEP from SolidWorks' },
  sldasm:{ group:'D', label:'SLDASM', icon:'⚙️', loader:'fallback', hint:'Export to STEP from SolidWorks' },
  slddrw:{ group:'D', label:'SLDDRW', icon:'📐', loader:'fallback', hint:'SolidWorks drawing — export to DXF' },
  // PTC / Parametric
  prt:   { group:'D', label:'PRT',    icon:'⚙️', loader:'fallback', hint:'Creo/NX part — export to STEP' },
  asm:   { group:'D', label:'ASM',    icon:'⚙️', loader:'fallback', hint:'Creo/NX assembly — export to STEP' },
  // Solid Edge (Siemens)
  par:   { group:'D', label:'PAR',    icon:'⚙️', loader:'fallback', hint:'Solid Edge part — export to STEP' },
  psm:   { group:'D', label:'PSM',    icon:'⚙️', loader:'fallback', hint:'Solid Edge sheet metal — export to STEP' },
  // CATIA (Dassault)
  catpart:    { group:'D', label:'CATPart',    icon:'✈️', loader:'fallback', hint:'CATIA part — export to STEP/IGES' },
  catproduct: { group:'D', label:'CATProduct', icon:'✈️', loader:'fallback', hint:'CATIA product — export to STEP/IGES' },
  cgr:        { group:'D', label:'CGR',        icon:'✈️', loader:'fallback', hint:'CATIA Graphical Rep — export to STEP' },
  // JT (Siemens/PLM)
  jt:    { group:'D', label:'JT',     icon:'⚙️', loader:'fallback', hint:'JT Open — export to STEP from NX/SolidWorks' },
  // Bentley
  dgn:   { group:'D', label:'DGN',    icon:'🏗️', loader:'fallback', hint:'MicroStation — export to DXF/DWG via ODA or MicroStation' },
  // SketchUp
  skp:   { group:'D', label:'SKP',    icon:'🏠', loader:'fallback', hint:'Export to GLTF or DAE from SketchUp' },
  // Blender / DCC
  blend: { group:'D', label:'BLEND',  icon:'🍊', loader:'fallback', hint:'Export to GLTF from Blender (File → Export → GLTF 2.0)' },
  // 3ds Max / Maya
  max:   { group:'D', label:'MAX',    icon:'🏗️', loader:'fallback', hint:'Export to FBX or OBJ from 3ds Max' },
  ma:    { group:'D', label:'MA',     icon:'🎬', loader:'fallback', hint:'Export to FBX or OBJ from Maya' },
  mb:    { group:'D', label:'MB',     icon:'🎬', loader:'fallback', hint:'Export to FBX or OBJ from Maya' },
  // Cinema 4D / ZBrush / LightWave
  c4d:   { group:'D', label:'C4D',    icon:'🎬', loader:'fallback', hint:'Export to FBX/OBJ from Cinema 4D' },
  ztl:   { group:'D', label:'ZTL',    icon:'🗿', loader:'fallback', hint:'Export to OBJ from ZBrush' },
  x3d:   { group:'D', label:'X3D',    icon:'🌐', loader:'fallback', hint:'Export to GLTF or OBJ (X3D removed from Three.js r152)' },
  lwo:   { group:'D', label:'LWO',    icon:'🧊', loader:'fallback', hint:'Export to FBX or OBJ from LightWave' },
  // Open-source tools
  fcstd: { group:'D', label:'FCStd',  icon:'⚙️', loader:'fallback', hint:'Export to STEP or OBJ from FreeCAD' },
  scad:  { group:'D', label:'SCAD',   icon:'⚙️', loader:'fallback', hint:'OpenSCAD — render and export to STL/OBJ' },
  // BIM collaboration
  smc:   { group:'D', label:'SMC',    icon:'🔍', loader:'fallback', hint:'Solibri — export to IFC for viewing' },
  // ── Group E: Geospatial & urban ───────────────
  kml:        { group:'E', label:'KML',       icon:'🌍', loader:'geo' },
  kmz:        { group:'E', label:'KMZ',       icon:'🌍', loader:'geo' },
  geojson:    { group:'E', label:'GeoJSON',   icon:'🌍', loader:'geo' },
  json:       { group:'E', label:'GeoJSON',   icon:'🌍', loader:'geo' },  // may be GeoJSON
  dem:        { group:'E', label:'DEM',       icon:'⛰️', loader:'geo' },
  asc:        { group:'E', label:'DEM/ASC',   icon:'⛰️', loader:'geo' },
  gml:        { group:'E', label:'CityGML',   icon:'🌍', loader:'geo' },
  cityjson:   { group:'E', label:'CityJSON',  icon:'🌍', loader:'geo' },
  gpx:        { group:'E', label:'GPX',       icon:'🗺️', loader:'geo' },
  osm:        { group:'E', label:'OSM',       icon:'🌍', loader:'geo' },
  shp:        { group:'E', label:'Shapefile', icon:'🗺️', loader:'geo' },
  geotiff:    { group:'E', label:'GeoTIFF',   icon:'🛰️', loader:'2d'  },
  // ── Group F: 2D images / documents ───────────
  png:   { group:'F', label:'PNG',    icon:'🖼️', loader:'2d'     },
  jpg:   { group:'F', label:'JPG',    icon:'🖼️', loader:'2d'     },
  jpeg:  { group:'F', label:'JPG',    icon:'🖼️', loader:'2d'     },
  gif:   { group:'F', label:'GIF',    icon:'🖼️', loader:'2d'     },
  bmp:   { group:'F', label:'BMP',    icon:'🖼️', loader:'2d'     },
  webp:  { group:'F', label:'WebP',   icon:'🖼️', loader:'2d'     },
  tiff:  { group:'F', label:'TIFF',   icon:'🖼️', loader:'2d'     },
  tif:   { group:'F', label:'TIFF',   icon:'🖼️', loader:'2d'     },
  heic:  { group:'F', label:'HEIC',   icon:'🖼️', loader:'2d'     },
  heif:  { group:'F', label:'HEIF',   icon:'🖼️', loader:'2d'     },
  avif:  { group:'F', label:'AVIF',   icon:'🖼️', loader:'2d'     },
  svg:   { group:'F', label:'SVG',    icon:'📐', loader:'2d-svg' },
  eps:   { group:'F', label:'EPS',    icon:'📐', loader:'2d-svg' },  // attempt as SVG
  ai:    { group:'F', label:'AI',     icon:'📐', loader:'2d-svg' },  // Adobe Illustrator (SVG-compatible)
  pdf:   { group:'F', label:'PDF',    icon:'📄', loader:'2d-pdf' },
  // ── Group G: Fabrication / toolpaths ─────────
  gcode: { group:'G', label:'G-code', icon:'🔧', loader:'gcode' },
  gc:    { group:'G', label:'G-code', icon:'🔧', loader:'gcode' },
  nc:    { group:'G', label:'G-code', icon:'🔧', loader:'gcode' },
  cnc:   { group:'G', label:'G-code', icon:'🔧', loader:'gcode' },
  tap:   { group:'G', label:'G-code', icon:'🔧', loader:'gcode' },
  ngc:   { group:'G', label:'G-code', icon:'🔧', loader:'gcode' },
  // ── Group H: Voxel / game ─────────────────────
  vox:   { group:'H', label:'VOX',    icon:'🎮', loader:'vox' },
};

function getFormat(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return FORMAT_MAP[ext] || { group:'?', label: ext.toUpperCase(), icon:'📄', loader:'unknown' };
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ── Init ─────────────────────────────────────
async function init() {
  await openDB();   // warm up IndexedDB connection
  await loadIndex();
  renderTree();
  console.log('[files] Module ready —', Object.keys(_index).length, 'files in vault');
}

// ── Load index from GitHub ────────────────────
async function loadIndex() {
  try {
    const { data, sha } = await window.__pandaSync.readEncrypted(INDEX_PATH);
    _index = data || {};
    _indexSha = sha;
  } catch(e) {
    if (e.message && e.message.includes('404')) {
      _index = {};
      _indexSha = null;
    } else {
      console.warn('[files] Index load failed:', e.message);
    }
  }
}

// ── Save index to GitHub ──────────────────────
async function saveIndex() {
  try {
    const result = await window.__pandaSync.writeEncrypted(
      INDEX_PATH, _index, _indexSha, '[PandaAI] file index update'
    );
    if (result?.content) _indexSha = result.content.sha;
  } catch(e) {
    console.warn('[files] Index save failed:', e.message);
    window.toast('Index sync failed — file saved locally', 'nfo', 3000);
  }
}

// ── Read file with progress for large files ───
function readFileWithProgress(file) {
  return new Promise((res, rej) => {
    const LARGE = 30 * 1024 * 1024; // 30 MB threshold
    if (file.size > LARGE) {
      window.setLoadProgress(0, `Reading ${fmtSize(file.size)}…`);
      // Bring loading overlay back (it was hidden after boot)
      const lo = document.getElementById('loading');
      if (lo) { lo.style.display = 'flex'; lo.classList.remove('hide'); }
    }
    const reader = new FileReader();
    reader.onprogress = e => {
      if (file.size > LARGE && e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        window.setLoadProgress(pct, `Reading ${fmtSize(file.size)}: ${pct}%`);
      }
    };
    reader.onload = e => {
      if (file.size > LARGE) window.hideLoading();
      res(e.target.result);
    };
    reader.onerror = () => rej(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// ── Add files (drag-drop or picker) ──────────
async function add(fileList) {
  for (const file of fileList) {
    const id  = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const fmt = getFormat(file.name);

    if (fmt.loader === 'fallback') {
      window.toast(`${fmt.label} is proprietary — ${fmt.hint}`, 'nfo', 6000);
      // Still index it so user can see it in the tree
    }

    const buf  = await readFileWithProgress(file);
    const hash = await window.__pandaCrypto.sha256(buf);

    // Deduplicate by hash
    const existing = Object.values(_index).find(f => f.hash === hash);
    if (existing) {
      window.toast(`"${file.name}" already in vault`, 'nfo', 2500);
      continue;
    }

    // ── Store in IndexedDB (primary, no size limits) ──
    try {
      await idbPut(id, buf);
    } catch(e) {
      window.toast(`Local save failed: ${e.message}`, 'er'); continue;
    }

    // ── Try GitHub backup (optional — silently skips if file too large) ──
    if (fmt.loader !== 'fallback' && fmt.loader !== 'unknown') {
      window.__pandaSync.writeBinaryEncrypted(
        `files/${id}.enc`, buf, null, `[PandaAI] add ${file.name}`
      ).catch(e => console.warn('[files] GitHub backup skipped for', file.name, '—', e.message));
    }

    _index[id] = {
      id, name: file.name,
      ext: file.name.split('.').pop().toLowerCase(),
      folder: 'root', size: file.size, fmtSize: fmtSize(file.size),
      hash, fmt: fmt.label, icon: fmt.icon, loader: fmt.loader,
      group: fmt.group, added: new Date().toISOString()
    };

    await saveIndex();
    renderTree();
    window.toast(`Added: ${file.name}`, 'ok', 2000);

    // Auto-open renderable files
    if (fmt.loader !== 'fallback' && fmt.loader !== 'unknown') {
      openInViewer(id, buf);
    }
  }
}

// ── Open file in viewer ───────────────────────
async function openInViewer(id, bufOverride) {
  const meta = _index[id];
  if (!meta) return;
  if (!window.__pandaRenderer) await window.loadMod('modules/renderer.js');

  let buf = bufOverride;

  if (!buf) {
    // 1. Try IndexedDB (fast, local)
    buf = await idbGet(id);

    if (!buf) {
      // 2. Fall back to GitHub vault
      try {
        window.toast('Fetching from vault…', 'nfo', 3000);
        const result = await window.__pandaSync.readBinaryEncrypted(`files/${id}.enc`);
        buf = result.data;
        // Cache locally for next time
        await idbPut(id, buf);
      } catch(e) {
        window.toast('Could not load file: ' + e.message, 'er'); return;
      }
    }
  }

  // Mark active in tree
  document.querySelectorAll('.titem').forEach(el => el.classList.remove('open'));
  const el = document.querySelector(`.titem[data-id="${id}"]`);
  if (el) el.classList.add('open');

  window.__pandaRenderer.load(meta, buf);
  document.getElementById('btn-analyse').disabled = false;
}

// ── Context-menu actions ──────────────────────
async function action(act, id) {
  if (act === 'open') { openInViewer(id); return; }

  if (act === 'analyse') {
    openInViewer(id);
    setTimeout(() => window.__pandaAnalysis?.run(), 1500);
    return;
  }

  if (act === 'rename') {
    const meta = _index[id];
    const newName = prompt('Rename file:', meta.name);
    if (newName?.trim() && newName !== meta.name) {
      _index[id].name = newName.trim();
      await saveIndex(); renderTree();
    }
    return;
  }

  if (act === 'folder') {
    const folders = [...new Set(Object.values(_index).map(f => f.folder))];
    const f = prompt('Move to folder:\n' + folders.join(', '), _index[id]?.folder || 'root');
    if (f?.trim()) { _index[id].folder = f.trim(); await saveIndex(); renderTree(); }
    return;
  }

  if (act === 'delete') {
    const meta = _index[id];
    if (!confirm(`Delete "${meta.name}" from vault?`)) return;
    // Remove from IndexedDB
    await idbDelete(id).catch(e => console.warn('[files] IDB delete:', e.message));
    // Remove from GitHub (best effort)
    window.__pandaSync.getSha(`files/${id}.enc`)
      .then(sha => sha && window.__pandaSync.deleteFile(`files/${id}.enc`, sha, `[PandaAI] delete ${meta.name}`))
      .catch(e => console.warn('[files] GitHub delete:', e.message));
    delete _index[id];
    await saveIndex(); renderTree();
    window.toast(`Deleted: ${meta.name}`, 'ok', 2000);
    return;
  }
}

// ── Create folder (virtual) ───────────────────
async function newFolder() {
  const name = prompt('New folder name:');
  if (name?.trim()) window.toast(`Folder "${name.trim()}" created`, 'ok', 2000);
}

// ── Render file tree ──────────────────────────
function renderTree() {
  const tree  = document.getElementById('file-tree');
  const empty = document.getElementById('tree-empty');
  const files = Object.values(_index);

  if (files.length === 0) {
    tree.innerHTML = '';
    if (empty) tree.appendChild(empty);
    document.getElementById('viewer-drop')?.classList.remove('has-file');
    return;
  }

  // Group by folder
  const folders = {};
  files.forEach(f => {
    const folder = f.folder || 'root';
    (folders[folder] = folders[folder] || []).push(f);
  });

  tree.innerHTML = '';
  for (const [folder, items] of Object.entries(folders)) {
    if (folder !== 'root') {
      const fEl = document.createElement('div');
      fEl.className = 'titem folder';
      fEl.innerHTML = `<span class="ti">📁</span><span class="tn">${esc(folder)}</span>`;
      tree.appendChild(fEl);
    }
    items.sort((a, b) => a.name.localeCompare(b.name)).forEach(f => {
      const el = document.createElement('div');
      el.className = 'titem' + (folder !== 'root' ? ' indent' : '');
      el.setAttribute('data-id', f.id);
      el.innerHTML = `
        <span class="ti">${f.icon}</span>
        <span class="tn" title="${esc(f.name)}">${esc(f.name)}</span>
        <span class="tx">${esc(f.ext)}</span>
      `;
      el.addEventListener('click', () => openInViewer(f.id));
      el.addEventListener('contextmenu', e => window.showCtxMenu(e, f.id));
      tree.appendChild(el);
    });
  }
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Export ───────────────────────────────────
window.__pandaFiles = {
  init, add, openInViewer, action, newFolder, renderTree, getFormat,
  get index() { return _index; }
};

document.getElementById('btn-new-folder')?.addEventListener('click', newFolder);
console.log('[files] Module loaded');
})();
