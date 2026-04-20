/* ═══════════════════════════════════════════════
   PandaAI 🐼 — Renderer Module
   Three.js 3D viewer + 2D image/SVG/PDF viewer.
   Uses window.THREE and window.__TL globals from index.html bootstrap.
   Exposes: window.__pandaRenderer
═══════════════════════════════════════════════ */
(function() {
'use strict';

let T   = null;   // window.THREE alias
let TL  = null;   // window.__TL loaders alias
let _scene, _camera, _renderer, _controls;
let _canvas;
let _animId;
let _current = null;   // current THREE.Object3D or { _2d: true }
let _meta    = null;
let _grid    = true;
let _gridHelper, _axesHelper;
let _lights  = {};
let _wireframe = false, _xray = false, _section = false;
let _sectionPlane = null;
let _measureMode = false, _measurePts = [], _measureLine = null;
let _exploded = false;
let _origPos  = new Map();
let _turntable = false;
let _walking   = false;
let _walkKeys  = {};
let _normHelper = null;
let _fpsFrames = 0, _fpsLast = 0;
let _2dBlobUrl = null;  // tracked so we can revoke it

// ── Init ─────────────────────────────────────
async function init(canvasId) {
  if (!window.__threeReady) {
    await Promise.race([
      new Promise(res => document.addEventListener('three-ready', res, { once: true })),
      new Promise((_, rej) => setTimeout(() => rej(new Error(
        'Three.js failed to load — check network or try Ctrl+Shift+R'
      )), 15000))
    ]);
  }
  T  = window.THREE;
  TL = window.__TL;

  _canvas = document.getElementById(canvasId);
  if (!_canvas) throw new Error('Canvas not found: ' + canvasId);

  buildScene();
  buildCamera();
  buildRenderer();
  buildLights();
  buildGrid();
  buildControls();
  startLoop();
  new ResizeObserver(onResize).observe(_canvas.parentElement);
  _canvas.addEventListener('click', onCanvasClick);
  document.addEventListener('keydown', e => _walkKeys[e.code] = true);
  document.addEventListener('keyup',   e => _walkKeys[e.code] = false);
  console.log('[renderer] Ready');
}

// ── Scene / Camera / Renderer ─────────────────
function buildScene()   { _scene = new T.Scene(); updateBg(); }
function buildCamera()  {
  _camera = new T.PerspectiveCamera(45, _canvas.clientWidth / _canvas.clientHeight, 0.001, 100000);
  _camera.position.set(5, 5, 10);
}
function buildRenderer() {
  _renderer = new T.WebGLRenderer({ canvas: _canvas, antialias: true, preserveDrawingBuffer: true });
  _renderer.setPixelRatio(window.devicePixelRatio);
  _renderer.setSize(_canvas.clientWidth, _canvas.clientHeight);
  _renderer.outputColorSpace = T.SRGBColorSpace;
}
function buildControls() {
  _controls = new TL.OrbitControls(_camera, _renderer.domElement);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.screenSpacePanning = true;
}
function buildLights() {
  _lights.amb  = new T.AmbientLight(0xffffff, 0.6);
  _lights.dir1 = new T.DirectionalLight(0xffffff, 0.8);
  _lights.dir1.position.set(5, 10, 7);
  _lights.dir2 = new T.DirectionalLight(0x8888ff, 0.3);
  _lights.dir2.position.set(-5, -5, -5);
  _scene.add(_lights.amb, _lights.dir1, _lights.dir2);
}
function buildGrid() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  _gridHelper = new T.GridHelper(100, 50, dark ? 0x333333 : 0xcccccc, dark ? 0x222222 : 0xdddddd);
  _axesHelper = new T.AxesHelper(2);
  _scene.add(_gridHelper, _axesHelper);
}
function updateBg() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  _scene.background = new T.Color(dark ? 0x0d0d0d : 0xf0f0f0);
}

// ── Render loop ───────────────────────────────
function startLoop() {
  _fpsLast = performance.now();
  (function loop() {
    _animId = requestAnimationFrame(loop);
    if (_turntable && _current && !_current._2d) _current.rotation.y += 0.005;
    if (_walking) updateWalk();
    _controls.update();
    _renderer.render(_scene, _camera);
    countFPS();
  })();
}
function countFPS() {
  _fpsFrames++;
  const now = performance.now();
  if (now - _fpsLast >= 1000) {
    const el = document.getElementById('stat-fps');
    if (el) el.textContent = Math.round(_fpsFrames * 1000 / (now - _fpsLast)) + ' fps';
    _fpsFrames = 0; _fpsLast = now;
  }
}
function onResize() {
  const w = _canvas.clientWidth, h = _canvas.clientHeight;
  _camera.aspect = w / h;
  _camera.updateProjectionMatrix();
  _renderer.setSize(w, h);
}

// ── Load model ────────────────────────────────
async function load(meta, arrayBuffer) {
  // Warn user before main-thread parse of large files
  const mb = arrayBuffer ? (arrayBuffer.byteLength / 1048576).toFixed(0) : 0;
  if (mb >= 30) {
    window.toast(`Parsing ${mb} MB — browser may be unresponsive briefly…`, 'nfo', 90000);
    // Yield one frame so the toast renders before the synchronous parse
    await new Promise(r => setTimeout(r, 60));
  }
  // Clear previous 3D object
  if (_current && !_current._2d) {
    _scene.remove(_current);
    _current.traverse(c => c.geometry?.dispose());
    _origPos.clear();
  }
  _current = null;
  _meta    = meta;
  _measurePts = []; _exploded = false;

  document.getElementById('stat-file').textContent = meta.name;
  document.getElementById('stat-verts').textContent = '…';
  document.getElementById('stat-faces').textContent = '…';

  // ── 2D path ──────────────────────────────────
  const L = meta.loader || 'native';
  if (L === '2d' || L === '2d-svg' || L === '2d-pdf') {
    await load2D(meta, arrayBuffer);
    return;
  }

  // ── Hide 2D viewer, show 3D canvas ───────────
  hide2DViewer();

  try {
    let obj;
    if      (L === 'native')   obj = await loadNative(meta, arrayBuffer);
    else if (L === 'dxf')      obj = await loadExternal('loader-dxf',   m => m.load(arrayBuffer, T, defaultMat));
    else if (L === 'ifc')      obj = await loadExternal('loader-ifc',   m => m.load(arrayBuffer, T, _scene));
    else if (L === 'step')     obj = await loadExternal('loader-step',  m => m.load(arrayBuffer, T, defaultMat));
    else if (L === 'dwg')      obj = await loadExternal('loader-dwg',   m => m.load(arrayBuffer, T, defaultMat));
    else if (L === '3dm')      obj = await loadExternal('loader-3dm',   m => m.load(arrayBuffer, T, defaultMat));
    else if (L === 'cloud')    obj = await loadExternal('loader-cloud', m => m.load(meta, arrayBuffer, T));
    else if (L === 'geo')      obj = await loadExternal('loader-geo',   m => m.load(meta, arrayBuffer, T));
    else if (L === 'gcode')    obj = await loadExternal('loader-gcode', m => m.load(arrayBuffer, T, defaultMat));
    else if (L === 'vox')      obj = await loadExternal('loader-vox',   m => m.load(arrayBuffer, T, defaultMat));
    else if (L === 'fallback') { showFallback(meta); return; }
    else                       obj = await loadNative(meta, arrayBuffer);

    if (!obj) { window.toast('Parser returned nothing for this file', 'er'); return; }
    _current = obj;
    _scene.add(obj);
    fitCamera(obj);
    storePositions(obj);
    updateStats(obj);
    document.getElementById('viewer-drop')?.classList.add('has-file');
    document.getElementById('btn-analyse').disabled = false;
    window.toast('Loaded: ' + meta.name, 'ok', 2000);
  } catch(e) {
    console.error('[renderer]', e);
    window.toast('Load error: ' + e.message, 'er', 6000);
  }
}

// Explicit map — loader filename → window global it exports
const _LOADER_KEYS = {
  'loader-dxf':   '__dxfLoader',
  'loader-ifc':   '__ifcLoader',
  'loader-step':  '__stepLoader',
  'loader-dwg':   '__dwgLoader',
  'loader-3dm':   '__3dmLoader',
  'loader-cloud': '__cloudLoader',
  'loader-geo':   '__geoLoader',
  'loader-gcode': '__gcodeLoader',
  'loader-vox':   '__voxLoader',
};

async function loadExternal(loaderName, fn) {
  const key = _LOADER_KEYS[loaderName];
  if (!key) throw new Error('No key registered for loader: ' + loaderName);
  if (!window[key]) await window.loadMod('modules/loaders/' + loaderName + '.js');
  if (!window[key]) throw new Error(loaderName + ' did not initialise (window.' + key + ' missing)');
  return fn(window[key]);
}

// ── Native Three.js loaders ───────────────────
async function loadNative(meta, buf) {
  const ext = meta.ext.toLowerCase();
  // OFF format handled separately (no Three.js loader)
  if (ext === 'off') return parseOFF(buf, T, defaultMat);

  const map = {
    stl:'STLLoader', obj:'OBJLoader', gltf:'GLTFLoader', glb:'GLTFLoader',
    fbx:'FBXLoader', dae:'ColladaLoader', '3ds':'TDSLoader', ply:'PLYLoader',
    pcd:'PCDLoader', wrl:'VRMLLoader', vrml:'VRMLLoader', vtk:'VTKLoader',
    '3mf':'ThreeMFLoader', amf:'AMFLoader',
    usdz:'USDZLoader', usd:'USDZLoader',
    // lwo/x3d removed in Three.js r157/r152 — handled as fallback in FORMAT_MAP
  };
  const clsName = map[ext];
  if (!clsName || !TL[clsName]) throw new Error('No built-in loader for .' + ext);
  const loader = new TL[clsName]();

  if (ext === 'stl') {
    const geo = loader.parse(buf);
    geo.computeVertexNormals();
    return center(new T.Mesh(geo, defaultMat()));
  }
  if (ext === 'ply') {
    const geo = loader.parse(buf);
    const mat = geo.attributes.color
      ? new T.PointsMaterial({ size: 0.01, vertexColors: true })
      : defaultMat();
    return center(geo.attributes.color ? new T.Points(geo, mat) : new T.Mesh(geo, mat));
  }
  if (ext === 'pcd') {
    return center(loader.parse(buf));
  }
  if (ext === 'gltf' || ext === 'glb') {
    // Attach Draco decoder so compressed geometry renders correctly
    if (TL.dracoLoader) loader.setDRACOLoader(TL.dracoLoader);
    const blob = new Blob([buf]);
    const url  = URL.createObjectURL(blob);
    return new Promise((res, rej) => {
      loader.load(url, g => { URL.revokeObjectURL(url); res(g.scene); },
        null, e => { URL.revokeObjectURL(url); rej(e); });
    });
  }
  if (ext === 'fbx') {
    // Object URL lets the loader resolve embedded texture paths correctly
    const blob = new Blob([buf]);
    const url  = URL.createObjectURL(blob);
    return new Promise((res, rej) => {
      loader.load(url, o => { URL.revokeObjectURL(url); res(center(o)); },
        null, e => { URL.revokeObjectURL(url); rej(e); });
    });
  }
  if (ext === '3mf') {
    const group = loader.parse(buf);
    return center(group);
  }
  if (ext === 'amf') {
    const group = loader.parse(buf);
    return center(group);
  }
  if (ext === 'usdz' || ext === 'usd') {
    // USDZLoader.parse may return a Group directly or via Promise
    const result = await Promise.resolve(loader.parse(buf));
    return center(result);
  }
  // Text-based formats
  const text = new TextDecoder().decode(buf);
  if (ext === 'dae')              return center(loader.parse(text).scene);
  if (ext === 'wrl' || ext === 'vrml') return center(loader.parse(text));
  if (ext === 'vtk') {
    const geo = loader.parse(text);
    return center(new T.Mesh(geo, defaultMat()));
  }
  // Generic fallback — try text then binary
  try {
    const res = loader.parse(text);
    return center(res.scene || res);
  } catch(_) {
    const res2 = loader.parse(buf);
    return center(res2.scene || res2);
  }
}

// ── OFF (Object File Format) parser ──────────
function parseOFF(buf, T, defaultMat) {
  const text  = new TextDecoder().decode(buf);
  const lines = text.split(/\r?\n/).map(l => l.replace(/#.*/,'').trim()).filter(Boolean);
  let li = 0;
  // Skip optional "OFF" header
  if (lines[li].startsWith('OFF')) li++;
  if (!lines[li]) throw new Error('OFF: missing size line');
  const [nV, nF] = lines[li++].split(/\s+/).map(Number);

  const verts = [];
  for (let i = 0; i < nV; i++) {
    const [x, y, z] = lines[li++].split(/\s+/).map(Number);
    verts.push(x, y, z);
  }
  const positions = [], indices = [];
  for (let i = 0; i < nF; i++) {
    const parts = lines[li++].split(/\s+/).map(Number);
    const n = parts[0];
    if (n >= 3) {
      for (let j = 1; j < n - 1; j++) {
        indices.push(parts[1], parts[j+1], parts[j+2]);
      }
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return center(new T.Mesh(geo, defaultMat()));
}

function defaultMat() {
  return new T.MeshPhongMaterial({ color: 0x888888, specular: 0x333333, shininess: 30, side: T.DoubleSide });
}
function center(obj) {
  const box = new T.Box3().setFromObject(obj);
  obj.position.sub(box.getCenter(new T.Vector3()));
  return obj;
}
function fitCamera(obj) {
  const box  = new T.Box3().setFromObject(obj);
  const ctr  = box.getCenter(new T.Vector3());
  const size = box.getSize(new T.Vector3());
  const max  = Math.max(size.x, size.y, size.z);
  const dist = Math.abs(max / 2 / Math.tan(_camera.fov * Math.PI / 360)) * 1.8;
  _camera.position.copy(ctr).add(new T.Vector3(dist * .6, dist * .4, dist));
  _camera.near = max * 0.0001; _camera.far = max * 1000;
  _camera.updateProjectionMatrix();
  _controls.target.copy(ctr); _controls.update();
  if (_gridHelper) {
    _gridHelper.position.y = box.min.y;
    _gridHelper.scale.setScalar(Math.max(1, max * 2));
  }
}
function storePositions(obj) {
  if (!obj || obj._2d) return;
  obj.traverse(c => { if (c.isMesh) _origPos.set(c.uuid, c.position.clone()); });
}
function updateStats(obj) {
  if (!obj || obj._2d) return;
  let v = 0, f = 0;
  obj.traverse(c => {
    if (!c.geometry) return;
    const p = c.geometry.attributes.position;
    if (p) v += p.count;
    const i = c.geometry.index;
    f += i ? i.count / 3 : (p ? p.count / 3 : 0);
  });
  const box  = new T.Box3().setFromObject(obj);
  const size = box.getSize(new T.Vector3());
  document.getElementById('stat-verts').textContent = v.toLocaleString() + ' verts';
  document.getElementById('stat-faces').textContent = Math.round(f).toLocaleString() + ' faces';
  document.getElementById('stat-dims').textContent  =
    `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`;
  document.getElementById('stat-fmt').textContent   = _meta?.fmt || _meta?.ext?.toUpperCase();
}

// ── 2D Viewer ────────────────────────────────
const MIME = {
  png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
  gif:'image/gif', bmp:'image/bmp', webp:'image/webp',
  tiff:'image/tiff', tif:'image/tiff',
  svg:'image/svg+xml', pdf:'application/pdf'
};

async function load2D(meta, arrayBuffer) {
  const vd = document.getElementById('viewer-2d');
  if (!vd) { window.toast('2D viewer element missing', 'er'); return; }

  // Revoke previous blob
  if (_2dBlobUrl) { URL.revokeObjectURL(_2dBlobUrl); _2dBlobUrl = null; }

  vd.innerHTML = '';

  const ext = meta.ext.toLowerCase();
  const L   = meta.loader;

  if (L === '2d-svg') {
    // Inline SVG
    const text = new TextDecoder().decode(arrayBuffer);
    const wrap = document.createElement('div');
    wrap.style.cssText = 'max-width:100%;max-height:100%;overflow:auto;padding:12px';
    wrap.innerHTML = text;
    vd.appendChild(wrap);
  } else if (L === '2d-pdf') {
    // PDF in iframe
    const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
    _2dBlobUrl = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:100%;border:none';
    iframe.src = _2dBlobUrl;
    vd.appendChild(iframe);
  } else {
    // Raster image
    const mime = MIME[ext] || 'image/png';
    const blob = new Blob([arrayBuffer], { type: mime });
    _2dBlobUrl = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.src = _2dBlobUrl;
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:4px';
    img.onload = () => {
      document.getElementById('stat-dims').textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px';
    };
    vd.appendChild(img);
  }

  vd.classList.add('active');
  _current = { _2d: true };
  _meta    = meta;

  document.getElementById('viewer-drop')?.classList.add('has-file');
  document.getElementById('btn-analyse').disabled = false;
  document.getElementById('stat-file').textContent = meta.name;
  document.getElementById('stat-fmt').textContent  = meta.fmt || ext.toUpperCase();
  document.getElementById('stat-verts').textContent = '—';
  document.getElementById('stat-faces').textContent = '—';
  document.getElementById('stat-dims').textContent  = '2D';

  window.toast('Loaded: ' + meta.name, 'ok', 2000);
}

function hide2DViewer() {
  const vd = document.getElementById('viewer-2d');
  if (vd) vd.classList.remove('active');
  if (_2dBlobUrl) { URL.revokeObjectURL(_2dBlobUrl); _2dBlobUrl = null; }
}

// ── Fallback for proprietary ──────────────────
function showFallback(meta) {
  hide2DViewer();
  const hint = window.__pandaFiles?.getFormat(meta.name)?.hint || 'Export to an open format first';
  window.toast(`${meta.fmt} is proprietary — ${hint}`, 'nfo', 8000);
  const vd = document.getElementById('viewer-drop');
  if (vd) {
    const dt = vd.querySelector('.dt'); if (dt) dt.textContent = meta.fmt + ' — conversion required';
    const ds = vd.querySelector('.ds'); if (ds) ds.textContent = hint;
    vd.classList.remove('has-file');
  }
}

// ── Toolbar commands ──────────────────────────
const _3D_ONLY = new Set(['t-wire','t-xray','t-normals','t-section','t-explode',
  't-measure','t-walk','t-turn','t-shadow','t-top','t-front','t-side','t-iso',
  't-orbit','t-pan','t-fit','t-4view','t-layers']);

function command(id, active) {
  if (_current?._2d && _3D_ONLY.has(id)) {
    window.toast('3D tools not available for 2D files', 'nfo', 2000); return;
  }
  switch(id) {
    case 't-orbit':   _controls.enabled = true; if (_walking) stopWalk(); break;
    case 't-pan':     _controls.enableRotate = !active; _controls.enablePan = active; break;
    case 't-fit':     if (_current && !_current._2d) fitCamera(_current); break;
    case 't-wire':    _wireframe = active; applyToMats(m => m.wireframe = active); break;
    case 't-xray':    _xray = active; applyToMats(m => { m.transparent = active; m.opacity = active ? .25 : 1; m.depthWrite = !active; }); break;
    case 't-normals': toggleNormals(active); break;
    case 't-section': toggleSection(active); break;
    case 't-explode': active ? explode() : resetExplode(); break;
    case 't-measure': _measureMode = active; if (!active) clearMeasure(); else window.toast('Click two points to measure', 'nfo', 3000); break;
    case 't-top':     setCam('top'); break;
    case 't-front':   setCam('front'); break;
    case 't-side':    setCam('side'); break;
    case 't-iso':     setCam('iso'); break;
    case 't-walk':    active ? startWalk() : stopWalk(); break;
    case 't-turn':    _turntable = active; break;
    case 't-grid':    if (_gridHelper) { _gridHelper.visible = active; _axesHelper.visible = active; } break;
    case 't-shadow':  _renderer.shadowMap.enabled = active; _lights.dir1.castShadow = active; break;
    case 't-layers':  showLayers(); break;
    case 't-shot':    screenshot(); break;
    case 't-4view':   window.toast('4-viewport coming soon', 'nfo', 2000); break;
  }
}

function applyToMats(fn) {
  _current?.traverse(c => {
    if (!c.material) return;
    (Array.isArray(c.material) ? c.material : [c.material]).forEach(fn);
  });
}

function toggleNormals(on) {
  if (_normHelper) { _scene.remove(_normHelper); _normHelper = null; }
  if (!on || !_current || _current._2d) return;
  _current.traverse(c => {
    if (c.isMesh) {
      _normHelper = new TL.VertexNormalsHelper(c, 0.1, 0x00ff00);
      _scene.add(_normHelper);
    }
  });
}

function toggleSection(on) {
  if (!on) { _renderer.clippingPlanes = []; _renderer.localClippingEnabled = false; return; }
  if (!_current || _current._2d) return;
  const mid = new T.Box3().setFromObject(_current).getCenter(new T.Vector3());
  _sectionPlane = new T.Plane(new T.Vector3(0, -1, 0), mid.y);
  _renderer.localClippingEnabled = true;
  _renderer.clippingPlanes = [_sectionPlane];
  window.toast('Section cut: scroll to move plane', 'nfo', 3000);
  _canvas.addEventListener('wheel', e => {
    if (_sectionPlane) _sectionPlane.constant += e.deltaY * 0.001;
  }, { passive: true });
}

function explode() {
  if (!_current || _current._2d) return;
  const box = new T.Box3().setFromObject(_current);
  const ctr = box.getCenter(new T.Vector3());
  const sz  = box.getSize(new T.Vector3());
  // Scale explosion relative to model size so it looks right for any unit system
  const factor = Math.max(sz.x, sz.y, sz.z) * 0.4 || 1.5;
  let i = 0;
  _current.traverse(c => {
    if (!c.isMesh) return;
    // Use WORLD position so direction is correct for any scene hierarchy
    const wp  = new T.Vector3();
    c.getWorldPosition(wp);
    const dir = wp.clone().sub(ctr);
    if (dir.length() < 0.001) dir.set(Math.sin(i * 1.3), Math.cos(i * 0.7), Math.sin(i));
    dir.normalize();
    const orig = _origPos.get(c.uuid) || c.position.clone();
    c.position.copy(orig).add(dir.multiplyScalar(factor));
    i++;
  });
  _exploded = true;
}
function resetExplode() {
  if (!_current || _current._2d) return;
  _current.traverse(c => { if (c.isMesh && _origPos.has(c.uuid)) c.position.copy(_origPos.get(c.uuid)); });
  _exploded = false;
}

function setCam(v) {
  if (!_current || _current._2d) return;
  const box = new T.Box3().setFromObject(_current);
  const ctr = box.getCenter(new T.Vector3());
  const sz  = box.getSize(new T.Vector3());
  const d   = Math.max(sz.x, sz.y, sz.z) * 2;
  const pos = { top:[0,d,0], front:[0,0,d], side:[d,0,0], iso:[d*.6,d*.4,d] }[v] || [d*.6,d*.4,d];
  _camera.position.set(ctr.x + pos[0], ctr.y + pos[1], ctr.z + pos[2]);
  _controls.target.copy(ctr); _controls.update();
}

function showLayers() {
  if (!_current || _current._2d) { window.toast('No 3D file loaded', 'nfo'); return; }
  const names = new Set();
  _current.traverse(c => { if (c.name) names.add(c.name); });
  window.toast(names.size ? 'Layers: ' + [...names].slice(0,6).join(', ') : 'No named layers', 'nfo', 5000);
}

// ── Measure ───────────────────────────────────
function onCanvasClick(e) {
  if (!_measureMode || !_current || _current._2d) return;
  const rect = _canvas.getBoundingClientRect();
  const mouse = new T.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new T.Raycaster();
  ray.setFromCamera(mouse, _camera);
  const hits = ray.intersectObject(_current, true);
  if (!hits.length) return;
  _measurePts.push(hits[0].point.clone());
  if (_measurePts.length === 2) {
    const d = _measurePts[0].distanceTo(_measurePts[1]);
    window.toast('Distance: ' + d.toFixed(4) + ' units', 'nfo', 6000);
    if (_measureLine) _scene.remove(_measureLine);
    _measureLine = new T.Line(
      new T.BufferGeometry().setFromPoints(_measurePts),
      new T.LineBasicMaterial({ color: 0xffcc00 })
    );
    _scene.add(_measureLine);
    _measurePts = [];
  }
}
function clearMeasure() {
  if (_measureLine) { _scene.remove(_measureLine); _measureLine = null; }
  _measurePts = [];
}

// ── Walk mode ─────────────────────────────────
function startWalk() {
  _walking = true; _controls.enabled = false;
  window.toast('Walk: WASD move · Space/Shift up/down · click to lock pointer', 'nfo', 5000);
  _canvas.addEventListener('click', () => { if (_walking) _canvas.requestPointerLock?.(); }, { once: true });
}
function stopWalk() {
  _walking = false; _controls.enabled = true;
  document.exitPointerLock?.();
}
function updateWalk() {
  const spd = 0.05;
  const dir = new T.Vector3(); _camera.getWorldDirection(dir);
  const rt  = new T.Vector3().crossVectors(dir, _camera.up).normalize();
  if (_walkKeys['KeyW']  || _walkKeys['ArrowUp'])    _camera.position.addScaledVector(dir,  spd);
  if (_walkKeys['KeyS']  || _walkKeys['ArrowDown'])  _camera.position.addScaledVector(dir, -spd);
  if (_walkKeys['KeyA']  || _walkKeys['ArrowLeft'])  _camera.position.addScaledVector(rt,  -spd);
  if (_walkKeys['KeyD']  || _walkKeys['ArrowRight']) _camera.position.addScaledVector(rt,   spd);
  if (_walkKeys['Space'])     _camera.position.y += spd;
  if (_walkKeys['ShiftLeft']) _camera.position.y -= spd;
}

// ── Screenshot ────────────────────────────────
function screenshot() {
  const a = document.createElement('a');
  if (_current?._2d) {
    // Screenshot for 2D: capture the 2D viewer
    const vd  = document.getElementById('viewer-2d');
    const img = vd?.querySelector('img');
    if (img) {
      a.href     = img.src;
      a.download = (_meta?.name || 'pandaai') + '_screenshot.png';
      a.click(); return;
    }
  }
  _renderer.render(_scene, _camera);
  a.href     = _canvas.toDataURL('image/png');
  a.download = (_meta?.name || 'pandaai') + '_' + Date.now() + '.png';
  a.click();
  window.toast('Screenshot saved', 'ok', 2000);
}

// ── Scene summary (for AI analysis) ──────────
function getSceneSummary() {
  if (!_current || !_meta) return null;
  if (_current._2d) {
    return {
      filename: _meta.name, format: _meta.fmt || _meta.ext,
      vertices: 0, faces: 0, meshes: 0, materials: [],
      dimensions: { x: 0, y: 0, z: 0 }, aspectRatio: { xy: 0, xz: 0 },
      is2D: true
    };
  }
  let v = 0, f = 0, m = 0;
  const mats = new Set();
  _current.traverse(c => {
    if (!c.isMesh) return; m++;
    const p = c.geometry?.attributes?.position; if (p) v += p.count;
    const i = c.geometry?.index; f += i ? i.count/3 : (p ? p.count/3 : 0);
    (Array.isArray(c.material) ? c.material : [c.material]).forEach(mt => mt?.name && mats.add(mt.name));
  });
  const box  = new T.Box3().setFromObject(_current);
  const size = box.getSize(new T.Vector3());
  return {
    filename: _meta.name, format: _meta.fmt || _meta.ext,
    vertices: v, faces: Math.round(f), meshes: m,
    materials: [...mats],
    dimensions: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
    aspectRatio: { xy: +(size.x/size.y).toFixed(2), xz: +(size.x/size.z).toFixed(2) }
  };
}

// ── Theme change ──────────────────────────────
function onThemeChange() {
  updateBg();
  if (_gridHelper) { _scene.remove(_gridHelper); _scene.remove(_axesHelper); buildGrid(); }
}
document.getElementById('btn-theme')?.addEventListener('click', () => setTimeout(onThemeChange, 30));

// ── Export ───────────────────────────────────
window.__pandaRenderer = {
  init, load, command, screenshot, getSceneSummary, onThemeChange,
  get hasFile() { return !!_current; },
  get currentMeta() { return _meta; }
};

console.log('[renderer] Module loaded');
})();
