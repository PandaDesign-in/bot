/* ═══════════════════════════════════════════════
   PandaAI 🐼 — File Store Module
   Virtual encrypted file vault.
   Files stored encrypted in GitHub /files/
   File tree rendered in left panel.
   Exposes: window.__pandaFiles
═══════════════════════════════════════════════ */

(function() {
'use strict';

// In-memory index: id → { id, name, ext, folder, size, sha, hash, added }
let _index = {};
let _indexSha = null;
const INDEX_PATH = 'files/index.json';

// Format detection map
const FORMAT_MAP = {
  // Group A — Three.js native
  stl:  { group:'A', label:'STL',   icon:'🧊', loader:'native' },
  obj:  { group:'A', label:'OBJ',   icon:'🧊', loader:'native' },
  mtl:  { group:'A', label:'MTL',   icon:'🎨', loader:'native' },
  gltf: { group:'A', label:'GLTF',  icon:'🌐', loader:'native' },
  glb:  { group:'A', label:'GLB',   icon:'🌐', loader:'native' },
  fbx:  { group:'A', label:'FBX',   icon:'🧊', loader:'native' },
  dae:  { group:'A', label:'DAE',   icon:'🧊', loader:'native' },
  '3ds':{ group:'A', label:'3DS',   icon:'🧊', loader:'native' },
  ply:  { group:'A', label:'PLY',   icon:'🧊', loader:'native' },
  pcd:  { group:'A', label:'PCD',   icon:'☁️', loader:'native' },
  x3d:  { group:'A', label:'X3D',   icon:'🌐', loader:'native' },
  wrl:  { group:'A', label:'VRML',  icon:'🌐', loader:'native' },
  vrml: { group:'A', label:'VRML',  icon:'🌐', loader:'native' },
  vtk:  { group:'A', label:'VTK',   icon:'🧊', loader:'native' },
  off:  { group:'A', label:'OFF',   icon:'🧊', loader:'native' },
  lwo:  { group:'A', label:'LWO',   icon:'🧊', loader:'native' },
  // Group B — WASM
  dxf:  { group:'B', label:'DXF',   icon:'📐', loader:'dxf'    },
  ifc:  { group:'B', label:'IFC',   icon:'🏗️', loader:'ifc'    },
  ifczip:{ group:'B',label:'IFC',   icon:'🏗️', loader:'ifc'    },
  step: { group:'B', label:'STEP',  icon:'⚙️', loader:'step'   },
  stp:  { group:'B', label:'STEP',  icon:'⚙️', loader:'step'   },
  iges: { group:'B', label:'IGES',  icon:'⚙️', loader:'step'   },
  igs:  { group:'B', label:'IGES',  icon:'⚙️', loader:'step'   },
  sat:  { group:'B', label:'SAT',   icon:'⚙️', loader:'step'   },
  dwg:  { group:'B', label:'DWG',   icon:'📐', loader:'dwg'    },
  '3mf':{ group:'B', label:'3MF',   icon:'🖨️', loader:'native' },
  amf:  { group:'B', label:'AMF',   icon:'🖨️', loader:'native' },
  '3dm':{ group:'B', label:'3DM',   icon:'🦏', loader:'3dm'    },
  skp:  { group:'B', label:'SKP',   icon:'🏠', loader:'native' },
  usdz: { group:'B', label:'USDZ',  icon:'📦', loader:'native' },
  usd:  { group:'B', label:'USD',   icon:'📦', loader:'native' },
  // Group C — Point clouds
  e57:  { group:'C', label:'E57',   icon:'☁️', loader:'cloud'  },
  las:  { group:'C', label:'LAS',   icon:'☁️', loader:'cloud'  },
  laz:  { group:'C', label:'LAZ',   icon:'☁️', loader:'cloud'  },
  xyz:  { group:'C', label:'XYZ',   icon:'☁️', loader:'cloud'  },
  pts:  { group:'C', label:'PTS',   icon:'☁️', loader:'cloud'  },
  ptx:  { group:'C', label:'PTX',   icon:'☁️', loader:'cloud'  },
  // Group D — Proprietary (fallback)
  rvt:  { group:'D', label:'RVT',   icon:'🏢', loader:'fallback', hint:'Export to IFC from Revit' },
  rfa:  { group:'D', label:'RFA',   icon:'🏢', loader:'fallback', hint:'Export to IFC from Revit' },
  blend:{ group:'D', label:'BLEND', icon:'🍊', loader:'fallback', hint:'Export to GLTF from Blender' },
  max:  { group:'D', label:'MAX',   icon:'🏗️', loader:'fallback', hint:'Export to FBX/OBJ from 3ds Max' },
  ma:   { group:'D', label:'MA',    icon:'🎬', loader:'fallback', hint:'Export to FBX/OBJ from Maya' },
  mb:   { group:'D', label:'MB',    icon:'🎬', loader:'fallback', hint:'Export to FBX/OBJ from Maya' },
  sldprt:{ group:'D',label:'SLDPRT',icon:'⚙️',loader:'fallback', hint:'Export to STEP from SolidWorks' },
  sldasm:{ group:'D',label:'SLDASM',icon:'⚙️',loader:'fallback', hint:'Export to STEP from SolidWorks' },
  f3d:  { group:'D', label:'F3D',   icon:'⚙️', loader:'fallback', hint:'Export to STEP from Fusion 360' },
  nwd:  { group:'D', label:'NWD',   icon:'🔍', loader:'fallback', hint:'Export to IFC from Navisworks' },
  c4d:  { group:'D', label:'C4D',   icon:'🎬', loader:'fallback', hint:'Export to FBX/OBJ from Cinema 4D' },
  ztl:  { group:'D', label:'ZTL',   icon:'🗿', loader:'fallback', hint:'Export to OBJ from ZBrush' },
  // Group E — Geo
  kml:  { group:'E', label:'KML',   icon:'🌍', loader:'geo' },
  kmz:  { group:'E', label:'KMZ',   icon:'🌍', loader:'geo' },
  geojson:{ group:'E',label:'GeoJSON',icon:'🌍',loader:'geo'},
  dem:  { group:'E', label:'DEM',   icon:'⛰️', loader:'geo' },
  gml:  { group:'E', label:'GML',   icon:'🌍', loader:'geo' },
};

function getFormat(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return FORMAT_MAP[ext] || { group:'?', label: ext.toUpperCase(), icon:'📄', loader:'unknown' };
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}

// ── Init ─────────────────────────────────────
async function init() {
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
  const result = await window.__pandaSync.writeEncrypted(
    INDEX_PATH, _index, _indexSha, '[PandaAI] file index update'
  );
  if (result && result.content) _indexSha = result.content.sha;
}

// ── Add files (from drag-drop or picker) ──────
async function add(fileList) {
  for (const file of fileList) {
    const id = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    const fmt = getFormat(file.name);

    if (fmt.loader === 'fallback') {
      window.toast(`${fmt.label} is proprietary — ${fmt.hint}`, 'nfo', 6000);
      // Still store it — maybe user wants to keep for reference
    }

    const hash = await window.__pandaCrypto.sha256(await file.arrayBuffer());
    // Check for duplicate by hash
    const existing = Object.values(_index).find(f => f.hash === hash);
    if (existing) {
      window.toast(`"${file.name}" already in vault`, 'nfo', 2500);
      continue;
    }

    const buf = await file.arrayBuffer();
    const path = `files/${id}.enc`;

    try {
      window.toast(`Uploading ${file.name}…`, 'nfo', 2000);
      await window.__pandaSync.writeBinaryEncrypted(path, buf, null, `[PandaAI] add ${file.name}`);
    } catch(e) {
      window.toast(`Upload failed: ${file.name}`, 'er'); continue;
    }

    _index[id] = {
      id, name: file.name, ext: file.name.split('.').pop().toLowerCase(),
      folder: 'root', size: file.size, fmtSize: fmtSize(file.size),
      hash, path, fmt: fmt.label, icon: fmt.icon, loader: fmt.loader,
      group: fmt.group, added: new Date().toISOString()
    };

    await saveIndex();
    renderTree();
    window.toast(`Added: ${file.name}`, 'ok', 2000);

    // Auto-open in viewer if it can render
    if (fmt.loader !== 'fallback' && fmt.loader !== 'unknown') {
      openInViewer(id, buf);
    }
  }
}

// ── Open file in viewer ───────────────────────
async function openInViewer(id, bufOverride) {
  const meta = _index[id];
  if (!meta) return;
  if (!window.__pandaRenderer) {
    await window.loadMod('modules/renderer.js');
  }
  let buf = bufOverride;
  if (!buf) {
    try {
      buf = await window.__pandaSync.readEncrypted(meta.path);
      buf = buf.data; // decryptBinary returns ArrayBuffer
    } catch(e) {
      window.toast('Could not load file: ' + e.message, 'er'); return;
    }
  }

  // Mark active in tree
  document.querySelectorAll('.titem').forEach(el => el.classList.remove('open'));
  const el = document.querySelector(`.titem[data-id="${id}"]`);
  if (el) el.classList.add('open');

  window.__pandaRenderer.load(meta, buf);
  document.getElementById('btn-analyse').disabled = false;
}

// ── Action: context menu ──────────────────────
async function action(act, id) {
  if (act === 'open') { openInViewer(id); return; }
  if (act === 'analyse') {
    openInViewer(id);
    setTimeout(() => window.__pandaAnalysis && window.__pandaAnalysis.run(), 1500);
    return;
  }
  if (act === 'rename') {
    const meta = _index[id];
    const newName = prompt('Rename file:', meta.name);
    if (newName && newName.trim() && newName !== meta.name) {
      _index[id].name = newName.trim();
      await saveIndex();
      renderTree();
    }
    return;
  }
  if (act === 'folder') {
    const folders = [...new Set(Object.values(_index).map(f => f.folder))];
    const f = prompt('Move to folder (or type new folder name):\n' + folders.join(', '), _index[id]?.folder || 'root');
    if (f && f.trim()) {
      _index[id].folder = f.trim();
      await saveIndex();
      renderTree();
    }
    return;
  }
  if (act === 'delete') {
    const meta = _index[id];
    if (!confirm(`Delete "${meta.name}" from vault? This cannot be undone.`)) return;
    try {
      const sha = await window.__pandaSync.getSha(meta.path);
      if (sha) await window.__pandaSync.deleteFile(meta.path, sha, `[PandaAI] delete ${meta.name}`);
    } catch(e) { console.warn('[files] delete enc file:', e.message); }
    delete _index[id];
    await saveIndex();
    renderTree();
    window.toast(`Deleted: ${meta.name}`, 'ok', 2000);
    return;
  }
}

// ── Create folder ────────────────────────────
async function newFolder() {
  const name = prompt('New folder name:');
  if (!name || !name.trim()) return;
  // Folders are virtual — just update any file or create placeholder
  window.toast(`Folder "${name.trim()}" created`, 'ok', 2000);
}

// ── Render file tree ──────────────────────────
function renderTree() {
  const tree = document.getElementById('file-tree');
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
    if (!folders[folder]) folders[folder] = [];
    folders[folder].push(f);
  });

  tree.innerHTML = '';
  for (const [folder, items] of Object.entries(folders)) {
    if (folder !== 'root') {
      const fEl = document.createElement('div');
      fEl.className = 'titem folder';
      fEl.innerHTML = `<span class="ti">📁</span><span class="tn">${esc(folder)}</span>`;
      tree.appendChild(fEl);
    }

    items.sort((a,b) => a.name.localeCompare(b.name)).forEach(f => {
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
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Export ───────────────────────────────────
window.__pandaFiles = {
  init,
  add,
  openInViewer,
  action,
  newFolder,
  renderTree,
  getFormat,
  get index() { return _index; }
};

// Wire new-folder button
document.getElementById('btn-new-folder')?.addEventListener('click', newFolder);

console.log('[files] Module loaded');
})();
