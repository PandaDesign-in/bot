/* ═══════════════════════════════════════════════
   PandaAI 🐼 — Renderer Module
   Three.js 3D viewer with extended controls.
   Loads Three.js + loaders lazily from CDN.
   Exposes: window.__pandaRenderer
═══════════════════════════════════════════════ */

(function() {
'use strict';

const CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0';
let THREE, OrbitControls;
let _scene, _camera, _renderer, _controls;
let _canvas, _animId;
let _currentObject = null;
let _currentMeta   = null;
let _grid = true;
let _gridHelper, _axesHelper;
let _lights = {};
let _mode = 'orbit'; // orbit | pan | walk
let _turntable = false;
let _wireframe = false;
let _xray      = false;
let _section   = false;
let _sectionPlane = null;
let _measureMode = false;
let _measurePoints = [];
let _measureLine  = null;
let _explodeVal = 0;
let _originalPositions = new Map();
let _walking = false;
let _walkKeys = {};
let _multiView = false;
let _fpsClock, _fpsFrames = 0, _fpsLast = 0;

// ── CDN script loader ─────────────────────────
function loadScript(url) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${url}"]`)) { res(); return; }
    const s = document.createElement('script');
    s.src = url; s.type = 'module';
    s.onload = res; s.onerror = () => rej(new Error('Failed: ' + url));
    document.head.appendChild(s);
  });
}

// Load Three.js via importmap or dynamic import
async function loadThree() {
  if (window.THREE) { THREE = window.THREE; return; }
  // Use importmap shim approach — import Three as module
  const mod = await import(`${CDN}/build/three.module.min.js`);
  THREE = mod;
  window.THREE = THREE;
}

async function loadOrbControls() {
  if (window.__OrbitControls) { OrbitControls = window.__OrbitControls; return; }
  const mod = await import(`${CDN}/examples/jsm/controls/OrbitControls.js`);
  OrbitControls = mod.OrbitControls;
  window.__OrbitControls = OrbitControls;
}

// ── Init ─────────────────────────────────────
async function init(canvasId) {
  _canvas = document.getElementById(canvasId);
  if (!_canvas) throw new Error('Canvas not found: ' + canvasId);

  await loadThree();
  await loadOrbControls();

  buildScene();
  buildCamera();
  buildRenderer();
  buildLights();
  buildGrid();
  buildControls();
  startLoop();
  bindResize();
  bindWalk();
  console.log('[renderer] Ready');
}

// ── Scene ─────────────────────────────────────
function buildScene() {
  _scene = new THREE.Scene();
  updateBackground();
}

function updateBackground() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  _scene.background = new THREE.Color(dark ? 0x0d0d0d : 0xf0f0f0);
}

// ── Camera ────────────────────────────────────
function buildCamera() {
  const w = _canvas.clientWidth, h = _canvas.clientHeight;
  _camera = new THREE.PerspectiveCamera(45, w / h, 0.001, 100000);
  _camera.position.set(5, 5, 10);
}

// ── Renderer ──────────────────────────────────
function buildRenderer() {
  _renderer = new THREE.WebGLRenderer({
    canvas: _canvas,
    antialias: true,
    preserveDrawingBuffer: true // needed for screenshot
  });
  _renderer.setPixelRatio(window.devicePixelRatio);
  _renderer.setSize(_canvas.clientWidth, _canvas.clientHeight);
  _renderer.shadowMap.enabled = false;
  _renderer.outputColorSpace = THREE.SRGBColorSpace;
}

// ── Lights ────────────────────────────────────
function buildLights() {
  _lights.ambient = new THREE.AmbientLight(0xffffff, 0.6);
  _lights.dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
  _lights.dir1.position.set(5, 10, 7);
  _lights.dir2 = new THREE.DirectionalLight(0x8888ff, 0.3);
  _lights.dir2.position.set(-5, -5, -5);
  _scene.add(_lights.ambient, _lights.dir1, _lights.dir2);
}

// ── Grid + Axes ───────────────────────────────
function buildGrid() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  _gridHelper = new THREE.GridHelper(100, 50, dark ? 0x333333 : 0xcccccc, dark ? 0x222222 : 0xdddddd);
  _axesHelper = new THREE.AxesHelper(2);
  _scene.add(_gridHelper, _axesHelper);
}

// ── Orbit Controls ────────────────────────────
function buildControls() {
  _controls = new OrbitControls(_camera, _renderer.domElement);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.screenSpacePanning = true;
  _controls.minDistance = 0.001;
  _controls.maxDistance = 100000;
}

// ── Render loop ───────────────────────────────
function startLoop() {
  _fpsLast = performance.now();
  function loop() {
    _animId = requestAnimationFrame(loop);
    if (_turntable && _currentObject) _currentObject.rotation.y += 0.005;
    if (_walking) updateWalk();
    if (_controls) _controls.update();
    _renderer.render(_scene, _camera);
    updateFPS();
  }
  loop();
}

function updateFPS() {
  _fpsFrames++;
  const now = performance.now();
  if (now - _fpsLast >= 1000) {
    const fps = Math.round(_fpsFrames * 1000 / (now - _fpsLast));
    const el = document.getElementById('stat-fps');
    if (el) el.textContent = fps + ' fps';
    _fpsFrames = 0; _fpsLast = now;
  }
}

// ── Resize ────────────────────────────────────
function bindResize() {
  const ro = new ResizeObserver(() => onResize());
  ro.observe(_canvas.parentElement);
}
function onResize() {
  const w = _canvas.clientWidth, h = _canvas.clientHeight;
  _camera.aspect = w / h;
  _camera.updateProjectionMatrix();
  _renderer.setSize(w, h);
}

// ── Load a model ─────────────────────────────
async function load(meta, arrayBuffer) {
  if (_currentObject) {
    _scene.remove(_currentObject);
    _currentObject.traverse(c => { if (c.geometry) c.geometry.dispose(); });
    _currentObject = null;
    _originalPositions.clear();
  }
  _currentMeta = meta;
  _measurePoints = [];
  _explodeVal = 0;

  try {
    updateStatusFile(meta.name);
    const loader = meta.loader || 'native';

    let obj;
    if (loader === 'native')   obj = await loadNative(meta, arrayBuffer);
    else if (loader === 'dxf') obj = await loadDXF(meta, arrayBuffer);
    else if (loader === 'ifc') obj = await loadIFC(meta, arrayBuffer);
    else if (loader === 'step') obj = await loadSTEP(meta, arrayBuffer);
    else if (loader === 'dwg')  obj = await loadDWG(meta, arrayBuffer);
    else if (loader === '3dm')  obj = await load3DM(meta, arrayBuffer);
    else if (loader === 'cloud') obj = await loadCloud(meta, arrayBuffer);
    else if (loader === 'geo')   obj = await loadGeo(meta, arrayBuffer);
    else if (loader === 'fallback') { showFallback(meta); return; }
    else obj = await loadNative(meta, arrayBuffer); // try anyway

    if (!obj) { window.toast('Could not parse file', 'er'); return; }

    _currentObject = obj;
    _scene.add(obj);
    fitCamera(obj);
    storeOriginalPositions(obj);
    updateStats(meta, obj);
    document.getElementById('viewer-drop')?.classList.add('has-file');
    window.toast(`Loaded: ${meta.name}`, 'ok', 2000);

  } catch(e) {
    console.error('[renderer] Load error:', e);
    window.toast('Load error: ' + e.message, 'er', 5000);
  }
}

// ── Fit camera to object ──────────────────────
function fitCamera(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = _camera.fov * (Math.PI / 180);
  const dist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.8;
  _camera.position.copy(center).add(new THREE.Vector3(dist * 0.6, dist * 0.4, dist));
  _camera.near = maxDim * 0.0001;
  _camera.far  = maxDim * 1000;
  _camera.updateProjectionMatrix();
  _controls.target.copy(center);
  _controls.update();
  if (_gridHelper) {
    _gridHelper.position.y = box.min.y;
    _gridHelper.scale.setScalar(Math.max(1, maxDim * 2));
  }
}

// ── Stat bar update ───────────────────────────
function updateStatusFile(name) {
  const el = document.getElementById('stat-file');
  if (el) el.textContent = name;
}
function updateStats(meta, obj) {
  let verts = 0, faces = 0;
  obj.traverse(c => {
    if (c.geometry) {
      const pos = c.geometry.attributes.position;
      if (pos) verts += pos.count;
      const idx = c.geometry.index;
      faces += idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
    }
  });
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  document.getElementById('stat-verts').textContent = verts.toLocaleString() + ' verts';
  document.getElementById('stat-faces').textContent = Math.round(faces).toLocaleString() + ' faces';
  document.getElementById('stat-dims').textContent =
    `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`;
  document.getElementById('stat-fmt').textContent = meta.fmt || meta.ext?.toUpperCase();
}

// ── Store original positions for explode ──────
function storeOriginalPositions(obj) {
  obj.traverse(c => {
    if (c.isMesh) _originalPositions.set(c.uuid, c.position.clone());
  });
}

// ═══════════════════════════════════════════════
// LOADERS
// ═══════════════════════════════════════════════

async function loadNative(meta, buf) {
  const ext = meta.ext.toLowerCase();
  const loaderMod = await import(`${CDN}/examples/jsm/loaders/${_loaderClass(ext)}.js`);
  const LoaderClass = Object.values(loaderMod)[0];
  const loader = new LoaderClass();

  // Convert ArrayBuffer to appropriate format
  if (['stl'].includes(ext)) {
    const geo = loader.parse(buf);
    const mat = defaultMat();
    const mesh = new THREE.Mesh(geo, mat);
    return centerObject(mesh);
  }
  if (['ply'].includes(ext)) {
    const geo = loader.parse(buf);
    const mat = new THREE.PointsMaterial({ size: 0.01, vertexColors: true });
    return geo.attributes.color ? new THREE.Points(geo, mat) : new THREE.Mesh(geo, defaultMat());
  }
  if (['pcd'].includes(ext)) {
    const obj = loader.parse(buf);
    return obj;
  }
  if (['gltf','glb'].includes(ext)) {
    return new Promise((res, rej) => {
      loader.parse(buf, '', gltf => res(gltf.scene), rej);
    });
  }
  // Text-based formats
  const text = new TextDecoder().decode(buf);
  if (['obj'].includes(ext)) {
    // Need MTL handling — load obj without mtl for now
    const obj = loader.parse(text);
    return centerObject(obj);
  }
  if (['dae'].includes(ext)) {
    const res = loader.parse(text);
    return centerObject(res.scene);
  }
  if (['wrl','vrml'].includes(ext)) {
    const obj = loader.parse(text);
    return centerObject(obj);
  }
  if (['fbx'].includes(ext)) {
    return new Promise((res, rej) => {
      loader.parse(buf, '', obj => res(centerObject(obj)), rej);
    });
  }
  // Generic attempt
  try {
    const obj = loader.parse(buf);
    return centerObject(obj instanceof THREE.BufferGeometry ? new THREE.Mesh(obj, defaultMat()) : obj);
  } catch(e) {
    const obj2 = loader.parse(new TextDecoder().decode(buf));
    return centerObject(obj2);
  }
}

function _loaderClass(ext) {
  const map = {
    stl:'STLLoader', obj:'OBJLoader', gltf:'GLTFLoader', glb:'GLTFLoader',
    fbx:'FBXLoader', dae:'ColladaLoader', '3ds':'TDSLoader', ply:'PLYLoader',
    pcd:'PCDLoader', wrl:'VRMLLoader', vrml:'VRMLLoader', vtk:'VTKLoader',
    off:'OBJLoader', lwo:'LWOLoader', x3d:'X3DLoader'
  };
  return map[ext] || 'OBJLoader';
}

async function loadDXF(meta, buf) {
  if (!window.DxfParser) {
    await window.loadMod('modules/loaders/loader-dxf.js');
  }
  return window.__dxfLoader.load(buf, THREE, defaultMat);
}

async function loadIFC(meta, buf) {
  if (!window.__ifcLoader) {
    await window.loadMod('modules/loaders/loader-ifc.js');
  }
  return window.__ifcLoader.load(buf, THREE, _scene);
}

async function loadSTEP(meta, buf) {
  if (!window.__stepLoader) {
    await window.loadMod('modules/loaders/loader-step.js');
  }
  return window.__stepLoader.load(buf, THREE, defaultMat);
}

async function loadDWG(meta, buf) {
  if (!window.__dwgLoader) {
    await window.loadMod('modules/loaders/loader-dwg.js');
  }
  return window.__dwgLoader.load(buf, THREE, defaultMat);
}

async function load3DM(meta, buf) {
  if (!window.__3dmLoader) {
    await window.loadMod('modules/loaders/loader-3dm.js');
  }
  return window.__3dmLoader.load(buf, THREE, defaultMat);
}

async function loadCloud(meta, buf) {
  if (!window.__cloudLoader) {
    await window.loadMod('modules/loaders/loader-cloud.js');
  }
  return window.__cloudLoader.load(meta, buf, THREE);
}

async function loadGeo(meta, buf) {
  if (!window.__geoLoader) {
    await window.loadMod('modules/loaders/loader-geo.js');
  }
  return window.__geoLoader.load(meta, buf, THREE);
}

function showFallback(meta) {
  const hint = window.__pandaFiles?.getFormat(meta.name)?.hint || 'Export to an open format first';
  window.toast(`${meta.fmt} is proprietary. ${hint}`, 'nfo', 7000);
  document.getElementById('viewer-drop')?.classList.remove('has-file');
  const vd = document.getElementById('viewer-drop');
  if (vd) {
    vd.querySelector('.dt').textContent = `${meta.fmt} — Conversion required`;
    vd.querySelector('.ds').textContent = hint;
  }
}

// ── Materials ─────────────────────────────────
function defaultMat() {
  return new THREE.MeshPhongMaterial({
    color: 0x888888,
    specular: 0x444444,
    shininess: 30,
    side: THREE.DoubleSide
  });
}

function centerObject(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  return obj;
}

// ═══════════════════════════════════════════════
// COMMANDS (from toolbar buttons)
// ═══════════════════════════════════════════════
function command(id, active) {
  switch(id) {
    case 't-orbit':
      _mode = 'orbit';
      _controls.enabled = true;
      if (_walking) stopWalk();
      break;
    case 't-pan':
      _mode = 'pan';
      _controls.enabled = true;
      break;
    case 't-fit':
      if (_currentObject) fitCamera(_currentObject);
      break;
    case 't-wire':
      _wireframe = active;
      applyWireframe();
      break;
    case 't-xray':
      _xray = active;
      applyXray();
      break;
    case 't-normals':
      toggleNormals(active);
      break;
    case 't-section':
      _section = active;
      toggleSection(active);
      break;
    case 't-explode':
      active ? startExplode() : resetExplode();
      break;
    case 't-measure':
      _measureMode = active;
      if (!active) clearMeasure();
      else window.toast('Click two points to measure distance', 'nfo', 4000);
      break;
    case 't-top':
      setCameraView('top'); break;
    case 't-front':
      setCameraView('front'); break;
    case 't-side':
      setCameraView('side'); break;
    case 't-iso':
      setCameraView('iso'); break;
    case 't-walk':
      active ? startWalk() : stopWalk(); break;
    case 't-turn':
      _turntable = active; break;
    case 't-grid':
      _grid = active;
      if (_gridHelper) _gridHelper.visible = active;
      if (_axesHelper) _axesHelper.visible = active;
      break;
    case 't-shadow':
      toggleShadows(active); break;
    case 't-layers':
      showLayerPanel(); break;
    case 't-4view':
      _multiView = active;
      window.toast(_multiView ? '4-viewport coming in next build' : '', 'nfo', 2000);
      break;
    case 't-shot':
      screenshot(); break;
  }
}

// ── Display modes ─────────────────────────────
function applyWireframe() {
  if (!_currentObject) return;
  _currentObject.traverse(c => {
    if (c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(m => { m.wireframe = _wireframe; });
    }
  });
}

function applyXray() {
  if (!_currentObject) return;
  _currentObject.traverse(c => {
    if (c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(m => {
        m.transparent = _xray;
        m.opacity = _xray ? 0.25 : 1.0;
        m.depthWrite = !_xray;
      });
    }
  });
}

let _normHelper = null;
function toggleNormals(on) {
  if (!_currentObject) return;
  if (_normHelper) { _scene.remove(_normHelper); _normHelper = null; }
  if (!on) return;
  import(`${CDN}/examples/jsm/helpers/VertexNormalsHelper.js`).then(mod => {
    const VNH = mod.VertexNormalsHelper;
    _currentObject.traverse(c => {
      if (c.isMesh) {
        _normHelper = new VNH(c, 0.1, 0x00ff00);
        _scene.add(_normHelper);
      }
    });
  });
}

// ── Section cut ───────────────────────────────
function toggleSection(on) {
  if (!THREE) return;
  if (!on) {
    _renderer.clippingPlanes = [];
    _renderer.localClippingEnabled = false;
    _sectionPlane = null;
    return;
  }
  if (!_currentObject) return;
  const box = new THREE.Box3().setFromObject(_currentObject);
  const mid = box.getCenter(new THREE.Vector3());
  _sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), mid.y);
  _renderer.localClippingEnabled = true;
  _renderer.clippingPlanes = [_sectionPlane];
  window.toast('Section cut active — scroll to move plane', 'nfo', 3000);
  // Mouse wheel to move section plane
  _canvas.addEventListener('wheel', onSectionScroll, { passive: true });
}

function onSectionScroll(e) {
  if (!_section || !_sectionPlane) return;
  _sectionPlane.constant += e.deltaY * 0.001;
}

// ── Explode view ──────────────────────────────
function startExplode() {
  if (!_currentObject) return;
  const center = new THREE.Box3().setFromObject(_currentObject).getCenter(new THREE.Vector3());
  let idx = 0;
  _currentObject.traverse(c => {
    if (c.isMesh) {
      const orig = _originalPositions.get(c.uuid) || c.position.clone();
      const dir = c.position.clone().sub(center).normalize();
      if (dir.length() < 0.01) dir.set(Math.sin(idx), 0, Math.cos(idx));
      c.position.copy(orig).add(dir.multiplyScalar(1.5));
      idx++;
    }
  });
}

function resetExplode() {
  if (!_currentObject) return;
  _currentObject.traverse(c => {
    if (c.isMesh && _originalPositions.has(c.uuid)) {
      c.position.copy(_originalPositions.get(c.uuid));
    }
  });
}

// ── Camera views ─────────────────────────────
function setCameraView(view) {
  if (!_currentObject) return;
  const box = new THREE.Box3().setFromObject(_currentObject);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const d = Math.max(size.x, size.y, size.z) * 2;
  const views = {
    top:   [0, d, 0],
    front: [0, 0, d],
    side:  [d, 0, 0],
    iso:   [d * 0.6, d * 0.4, d]
  };
  const [x, y, z] = views[view] || views.iso;
  _camera.position.set(center.x + x, center.y + y, center.z + z);
  _controls.target.copy(center);
  _controls.update();
}

// ── Shadows ───────────────────────────────────
function toggleShadows(on) {
  _renderer.shadowMap.enabled = on;
  if (_lights.dir1) _lights.dir1.castShadow = on;
  if (_currentObject) _currentObject.traverse(c => {
    if (c.isMesh) { c.castShadow = on; c.receiveShadow = on; }
  });
}

// ── Layer panel ───────────────────────────────
function showLayerPanel() {
  if (!_currentObject) { window.toast('No file loaded', 'nfo'); return; }
  const names = new Set();
  _currentObject.traverse(c => { if (c.name) names.add(c.name); });
  if (names.size === 0) { window.toast('No named layers in this file', 'nfo'); return; }
  window.toast(`Layers: ${[...names].slice(0,5).join(', ')}${names.size>5?'…':''}`, 'nfo', 5000);
}

// ── Measure tool ──────────────────────────────
function initMeasureClick() {
  _renderer.domElement.addEventListener('click', onMeasureClick);
}
function onMeasureClick(e) {
  if (!_measureMode) return;
  const rect = _renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, _camera);
  const hits = ray.intersectObject(_currentObject, true);
  if (!hits.length) return;
  _measurePoints.push(hits[0].point.clone());
  if (_measurePoints.length === 2) {
    const d = _measurePoints[0].distanceTo(_measurePoints[1]);
    window.toast(`Distance: ${d.toFixed(4)} units`, 'nfo', 6000);
    drawMeasureLine();
    _measurePoints = [];
  }
}
function drawMeasureLine() {
  if (_measureLine) _scene.remove(_measureLine);
  const geo = new THREE.BufferGeometry().setFromPoints(_measurePoints);
  const mat = new THREE.LineBasicMaterial({ color: 0xffcc00, linewidth: 2 });
  _measureLine = new THREE.Line(geo, mat);
  _scene.add(_measureLine);
}
function clearMeasure() {
  if (_measureLine) { _scene.remove(_measureLine); _measureLine = null; }
  _measurePoints = [];
}

// ── First-person walk ─────────────────────────
function bindWalk() {
  document.addEventListener('keydown', e => { _walkKeys[e.code] = true; });
  document.addEventListener('keyup',   e => { _walkKeys[e.code] = false; });
}
function startWalk() {
  _walking = true;
  _controls.enabled = false;
  window.toast('Walk mode: WASD + mouse. Click viewer to lock pointer.', 'nfo', 4000);
  _renderer.domElement.addEventListener('click', () => {
    if (_walking) _renderer.domElement.requestPointerLock?.();
  });
}
function stopWalk() {
  _walking = false;
  _controls.enabled = true;
  document.exitPointerLock?.();
}
function updateWalk() {
  const speed = 0.05;
  const dir = new THREE.Vector3();
  _camera.getWorldDirection(dir);
  const right = new THREE.Vector3().crossVectors(dir, _camera.up).normalize();
  if (_walkKeys['KeyW']||_walkKeys['ArrowUp'])    _camera.position.addScaledVector(dir, speed);
  if (_walkKeys['KeyS']||_walkKeys['ArrowDown'])  _camera.position.addScaledVector(dir, -speed);
  if (_walkKeys['KeyA']||_walkKeys['ArrowLeft'])  _camera.position.addScaledVector(right, -speed);
  if (_walkKeys['KeyD']||_walkKeys['ArrowRight']) _camera.position.addScaledVector(right, speed);
  if (_walkKeys['Space']) _camera.position.y += speed;
  if (_walkKeys['ShiftLeft']||_walkKeys['ShiftRight']) _camera.position.y -= speed;
}

// ── Screenshot ────────────────────────────────
function screenshot() {
  _renderer.render(_scene, _camera);
  const url = _renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = (_currentMeta?.name || 'pandaai') + '_' + Date.now() + '.png';
  a.click();
  window.toast('Screenshot saved', 'ok', 2000);
}

// ── Get scene summary for AI ──────────────────
function getSceneSummary() {
  if (!_currentObject || !_currentMeta) return null;
  let verts = 0, faces = 0, meshCount = 0;
  const materials = new Set();
  _currentObject.traverse(c => {
    if (c.isMesh) {
      meshCount++;
      const pos = c.geometry?.attributes?.position;
      if (pos) verts += pos.count;
      const idx = c.geometry?.index;
      faces += idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
      const m = Array.isArray(c.material) ? c.material : [c.material];
      m.forEach(mat => mat?.name && materials.add(mat.name));
    }
  });
  const box = new THREE.Box3().setFromObject(_currentObject);
  const size = box.getSize(new THREE.Vector3());
  return {
    filename: _currentMeta.name,
    format: _currentMeta.fmt || _currentMeta.ext,
    vertices: verts,
    faces: Math.round(faces),
    meshes: meshCount,
    materials: [...materials],
    dimensions: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
    aspectRatio: { xy: +(size.x/size.y).toFixed(2), xz: +(size.x/size.z).toFixed(2) }
  };
}

// ── Theme change (called from app) ───────────
function onThemeChange() {
  updateBackground();
  if (_gridHelper) {
    _scene.remove(_gridHelper);
    buildGrid();
  }
}

// ── Export ───────────────────────────────────
window.__pandaRenderer = {
  init,
  load,
  command,
  fitCamera: () => _currentObject && fitCamera(_currentObject),
  screenshot,
  getSceneSummary,
  onThemeChange,
  get currentMeta() { return _currentMeta; },
  get hasFile() { return !!_currentObject; }
};

// Wire measure click after init
document.getElementById('viewer-canvas')?.addEventListener('click', onMeasureClick);

// Notify theme changes
document.getElementById('btn-theme')?.addEventListener('click', () => {
  setTimeout(onThemeChange, 50);
});

console.log('[renderer] Module loaded');
})();
