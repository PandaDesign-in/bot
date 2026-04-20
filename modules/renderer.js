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
let _exploded    = false;
let _origPos     = new Map();
let _explodeDirs = new Map();   // uuid → { dir: Vector3, orig: Vector3 }
let _explodeScale = 0;          // current explosion strength 0…1
let _turntable = false;
let _walking   = false;
let _walkYaw   = 0;   // radians — yaw controlled by mouse
let _walkPitch = 0;   // radians — pitch controlled by mouse
let _walkSpeed = 0.05;
let _walkKeys  = {};
let _normHelper = null;
let _fpsFrames = 0, _fpsLast = 0;
let _2dBlobUrl = null;  // tracked so we can revoke it
// VRay quality render
let _vray = false;
let _composer = null;
let _vrayGround = null;
// Mesh selection (right-click → Math-er)
let _selectedMesh = null;

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
  _canvas.addEventListener('contextmenu', onCanvasRightClick);
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
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap at 2x for perf
  _renderer.setSize(_canvas.clientWidth, _canvas.clientHeight);
  _renderer.outputColorSpace = T.SRGBColorSpace;
  _renderer.shadowMap.type = T.PCFSoftShadowMap; // ready for VRay use
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
    if (_vray && _composer) {
      _composer.render();
    } else {
      _renderer.render(_scene, _camera);
    }
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

// ── STL Web Worker (large files off main thread) ──
function loadSTLWorker(buf) {
  return new Promise((res, rej) => {
    const worker = new Worker('./modules/worker-stl.js');
    let overlayShown = false;
    worker.onmessage = function(e) {
      const { type, pct, positions, normals, triCount } = e.data;
      if (type === 'progress') {
        if (!overlayShown) {
          overlayShown = true;
          const lo = document.getElementById('loading');
          if (lo) { lo.style.display = 'flex'; lo.classList.remove('hide'); }
        }
        window.setLoadProgress(pct, `Parsing STL: ${pct}%  (${triCount ? Math.round(triCount/1000)+'k triangles' : ''})`);
        return;
      }
      if (type === 'done') {
        if (overlayShown) window.hideLoading();
        worker.terminate();
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(positions, 3));
        geo.setAttribute('normal',   new T.BufferAttribute(normals, 3));
        res(center(new T.Mesh(geo, defaultMat())));
      }
      if (type === 'error') {
        if (overlayShown) window.hideLoading();
        worker.terminate();
        rej(new Error(e.data.message));
      }
    };
    worker.onerror = e => { if (overlayShown) window.hideLoading(); worker.terminate(); rej(new Error('Worker error: ' + e.message)); };
    // Transfer buffer to worker (zero-copy — moves ownership, not copy)
    worker.postMessage({ buffer: buf }, [buf]);
  });
}

// ── VRay quality render ────────────────────────
async function enableVRay() {
  _renderer.toneMapping         = T.ACESToneMapping;
  _renderer.toneMappingExposure = 1.15;
  _renderer.shadowMap.enabled   = true;

  // Better directional light for VRay
  _lights.dir1.intensity = 1.8;
  _lights.dir1.castShadow = true;
  _lights.dir1.shadow.mapSize.set(2048, 2048);
  _lights.dir1.shadow.bias = -0.0004;
  _lights.dir1.shadow.normalBias = 0.02;
  if (_current) {
    const box = new T.Box3().setFromObject(_current);
    const sz  = box.getSize(new T.Vector3());
    const d   = Math.max(sz.x, sz.y, sz.z) * 1.5;
    const sc  = _lights.dir1.shadow.camera;
    sc.near = 0.1; sc.far = d * 4;
    sc.left = -d; sc.right = d; sc.top = d; sc.bottom = -d;
    sc.updateProjectionMatrix();
  }
  _lights.amb.intensity = 0.2;

  // Sky/ground hemisphere light
  if (!_lights.hemi) {
    _lights.hemi = new T.HemisphereLight(0xddeeff, 0x553311, 0.7);
    _scene.add(_lights.hemi);
  }

  // Shadow-catching ground plane
  if (!_vrayGround && _current) {
    const box = new T.Box3().setFromObject(_current);
    _vrayGround = new T.Mesh(
      new T.PlaneGeometry(2000, 2000),
      new T.ShadowMaterial({ opacity: 0.22, transparent: true })
    );
    _vrayGround.receiveShadow = true;
    _vrayGround.rotation.x = -Math.PI / 2;
    _vrayGround.position.y = box.min.y;
    _scene.add(_vrayGround);
  }

  // Enable shadows on loaded model
  if (_current && !_current._2d) {
    _current.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  }

  // EffectComposer — SSAO + Bloom (if available)
  if (TL.EffectComposer && TL.RenderPass && TL.SSAOPass && TL.UnrealBloomPass) {
    _composer = new TL.EffectComposer(_renderer);
    _composer.addPass(new TL.RenderPass(_scene, _camera));

    const ssao = new TL.SSAOPass(_scene, _camera, _canvas.clientWidth, _canvas.clientHeight);
    ssao.kernelRadius = 12;
    ssao.minDistance  = 0.001;
    ssao.maxDistance  = 0.08;
    ssao.output = TL.SSAOPass.OUTPUT.Default;
    _composer.addPass(ssao);

    const bloom = new TL.UnrealBloomPass(
      new T.Vector2(_canvas.clientWidth, _canvas.clientHeight),
      0.2, 0.5, 0.9
    );
    _composer.addPass(bloom);
  }

  _vray = true;
  window.toast('✨ Quality render: ACES · SSAO · Bloom · Soft shadows · Hemisphere', 'ok', 3000);
}

function disableVRay() {
  _renderer.toneMapping         = T.NoToneMapping;
  _renderer.toneMappingExposure = 1.0;
  _renderer.shadowMap.enabled   = false;
  _lights.dir1.castShadow  = false;
  _lights.dir1.intensity   = 0.8;
  _lights.amb.intensity    = 0.6;
  if (_lights.hemi) { _scene.remove(_lights.hemi); _lights.hemi = null; }
  if (_vrayGround)  { _scene.remove(_vrayGround); _vrayGround.geometry.dispose(); _vrayGround = null; }
  if (_current && !_current._2d) {
    _current.traverse(c => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
  }
  if (_composer) { _composer.dispose(); _composer = null; }
  _vray = false;
  window.toast('Standard render', 'nfo', 1500);
}

// ── Right-click: pick mesh → Math-er ──────────
function onCanvasRightClick(e) {
  e.preventDefault();
  if (!_current || _current._2d) return;
  const rect  = _canvas.getBoundingClientRect();
  const mouse = new T.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray  = new T.Raycaster();
  ray.setFromCamera(mouse, _camera);
  const hits = ray.intersectObject(_current, true);
  if (!hits.length) return;

  _selectedMesh = hits[0].object;
  // Briefly highlight selection
  if (_selectedMesh.isMesh) {
    const origCol = _selectedMesh.material?.color?.getHex?.();
    if (_selectedMesh.material?.color) {
      _selectedMesh.material.color.setHex(0x4a9eff);
      setTimeout(() => { if (_selectedMesh?.material?.color && origCol !== undefined) _selectedMesh.material.color.setHex(origCol); }, 600);
    }
  }

  const meshData = extractMeshData(_selectedMesh);
  if (window.showViewerCtxMenu) window.showViewerCtxMenu(e.clientX, e.clientY, meshData);
}

function extractMeshData(mesh) {
  if (!mesh?.geometry) return null;
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!pos) return null;

  // Bounding box
  geo.computeBoundingBox();
  const box  = geo.boundingBox;
  const size = box.getSize(new T.Vector3());

  const totalFaces = idx ? Math.round(idx.count / 3) : Math.round(pos.count / 3);

  // Cap computation at 100k faces — sample + scale for large meshes
  const SAMPLE_LIMIT = 100_000;
  const isSampled    = totalFaces > SAMPLE_LIMIT;
  const step         = isSampled ? Math.max(1, Math.floor(totalFaces / SAMPLE_LIMIT)) : 1;

  let area = 0, volume = 0, sampled = 0;
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();

  for (let i = 0; i < totalFaces; i += step) {
    let i0, i1, i2;
    if (idx) { i0 = idx.getX(i*3); i1 = idx.getX(i*3+1); i2 = idx.getX(i*3+2); }
    else     { i0 = i*3;           i1 = i*3+1;            i2 = i*3+2; }
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    // Triangle area
    const ab = b.clone().sub(a), ac = c.clone().sub(a);
    area += ab.cross(ac).length() / 2;
    // Signed tetrahedron volume (divergence theorem)
    volume += a.dot(b.clone().cross(c)) / 6;
    sampled++;
  }
  if (isSampled && sampled > 0) {
    const s = totalFaces / sampled;
    area *= s; volume *= s;
  }
  volume = Math.abs(volume);

  return {
    name:        mesh.name || ('mesh_' + mesh.uuid.slice(0,6)),
    uuid:        mesh.uuid,
    vertices:    pos.count,
    faces:       totalFaces,
    dimensions:  { x: +size.x.toFixed(4), y: +size.y.toFixed(4), z: +size.z.toFixed(4) },
    surfaceArea: +area.toFixed(4),
    volume:      +volume.toFixed(4),
    isSampled,
    material: Array.isArray(mesh.material)
      ? mesh.material.map(m => m.name || m.type).join(', ')
      : (mesh.material?.name || mesh.material?.type || 'MeshPhong'),
    parentModel: _meta?.name || 'unknown'
  };
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
    // Large STL files → parse in Web Worker to keep UI responsive
    const WORKER_THRESH = 50 * 1024 * 1024; // 50 MB
    if (buf.byteLength >= WORKER_THRESH && window.Worker) {
      return loadSTLWorker(buf);
    }
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
      loader.load(url, g => { URL.revokeObjectURL(url); res(center(g.scene)); },
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
  't-measure','t-walk','t-turn','t-shadow','t-vray','t-top','t-front','t-side','t-iso',
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
    case 't-explode':
      if (active) { initExplode(); showExplodeSlider(true); applyExplodeScale(0.5); _exploded = true; }
      else        { resetExplode(); }
      break;
    case 't-measure': _measureMode = active; if (!active) clearMeasure(); else window.toast('Click two points to measure', 'nfo', 3000); break;
    case 't-top':     setCam('top'); break;
    case 't-front':   setCam('front'); break;
    case 't-side':    setCam('side'); break;
    case 't-iso':     setCam('iso'); break;
    case 't-walk':    active ? startWalk() : stopWalk(); break;
    case 't-turn':    _turntable = active; break;
    case 't-grid':    if (_gridHelper) { _gridHelper.visible = active; _axesHelper.visible = active; } break;
    case 't-shadow':  _renderer.shadowMap.enabled = active; _lights.dir1.castShadow = active; break;
    case 't-vray':    active ? enableVRay() : disableVRay(); break;
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

// Initialise explosion — compute per-mesh outward directions once
function initExplode() {
  _explodeDirs.clear();
  if (!_current || _current._2d) return;

  const box = new T.Box3().setFromObject(_current);
  const ctr = box.getCenter(new T.Vector3());
  const sz  = box.getSize(new T.Vector3());
  // Unit factor = model max dimension, so scale=1.0 means ~1× the model size of separation
  const unit = Math.max(sz.x, sz.y, sz.z) || 1;

  let i = 0;
  _current.traverse(c => {
    if (!c.isMesh) return;
    const wp  = new T.Vector3();
    c.getWorldPosition(wp);
    const dir = wp.clone().sub(ctr);
    // For meshes at or very near world centre (single mesh, or parts at origin)
    // give each a distinct spread direction so they actually separate
    if (dir.length() < unit * 0.01) {
      dir.set(Math.sin(i * 2.4), Math.cos(i * 1.7) * 0.5, Math.cos(i * 2.4));
    }
    dir.normalize().multiplyScalar(unit * 5); // full-scale = 5× max model dimension
    const orig = _origPos.get(c.uuid) || c.position.clone();
    _explodeDirs.set(c.uuid, { dir: dir.clone(), orig: orig.clone() });
    i++;
  });

  const meshCount = _explodeDirs.size;
  if (meshCount === 0) { window.toast('No mesh parts to explode', 'nfo', 2000); return; }
  window.toast(`Exploding ${meshCount} part${meshCount > 1 ? 's' : ''} — drag slider to scale`, 'nfo', 3000);
}

// Apply explosion at strength t (0 = original, 1 = full separation)
function applyExplodeScale(t) {
  _explodeScale = t;
  if (!_current || _current._2d) return;
  _current.traverse(c => {
    if (!c.isMesh) return;
    const e = _explodeDirs.get(c.uuid);
    if (!e) return;
    if (t === 0) {
      c.position.copy(e.orig);
    } else {
      c.position.copy(e.orig).addScaledVector(e.dir, t);
    }
  });
}

function showExplodeSlider(visible) {
  const bar = document.getElementById('explode-bar');
  if (!bar) return;
  bar.classList.toggle('active', visible);
  if (!visible) {
    const sl = document.getElementById('explode-slider');
    if (sl) sl.value = 50; // reset for next time
    const pct = document.getElementById('explode-pct');
    if (pct) pct.textContent = '50%';
  }
}

function resetExplode() {
  applyExplodeScale(0);
  _explodeDirs.clear();
  _exploded     = false;
  _explodeScale = 0;
  showExplodeSlider(false);
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
function _onWalkMouse(e) {
  if (!_walking) return;
  const sens = 0.002;
  _walkYaw   -= (e.movementX || 0) * sens;
  _walkPitch -= (e.movementY || 0) * sens;
  _walkPitch  = Math.max(-1.5, Math.min(1.5, _walkPitch));
  _camera.rotation.order = 'YXZ';
  _camera.rotation.y = _walkYaw;
  _camera.rotation.x = _walkPitch;
}

function startWalk() {
  _walking = true; _controls.enabled = false;

  // Sync yaw/pitch from current camera orientation so look direction is preserved
  _camera.rotation.order = 'YXZ';
  _walkYaw   = _camera.rotation.y;
  _walkPitch = _camera.rotation.x;

  // Scale speed to model size — large buildings need faster movement
  if (_current && !_current._2d) {
    const sz = new T.Box3().setFromObject(_current).getSize(new T.Vector3());
    _walkSpeed = Math.max(sz.length() * 0.003, 0.02);
  } else {
    _walkSpeed = 0.05;
  }

  document.addEventListener('mousemove', _onWalkMouse);
  _canvas.addEventListener('click', () => { if (_walking) _canvas.requestPointerLock?.(); }, { once: true });
  window.toast('Walk: WASD + mouse look · Space/Shift = up/down · click canvas to lock pointer · ⟳ to exit', 'nfo', 6000);
}

function stopWalk() {
  _walking = false;
  document.removeEventListener('mousemove', _onWalkMouse);
  document.exitPointerLock?.();
  // Re-sync OrbitControls to look at a point in front of current camera position
  const fwd = new T.Vector3(0, 0, -1).applyEuler(_camera.rotation);
  _controls.target.copy(_camera.position).addScaledVector(fwd, Math.max(_walkSpeed * 20, 1));
  _controls.enabled = true;
  _controls.update();
}

function updateWalk() {
  const spd = _walkSpeed;
  // Forward/right vectors derived from yaw only (horizontal plane movement)
  const forward = new T.Vector3(-Math.sin(_walkYaw), 0, -Math.cos(_walkYaw));
  const right   = new T.Vector3( Math.cos(_walkYaw), 0, -Math.sin(_walkYaw));
  if (_walkKeys['KeyW']   || _walkKeys['ArrowUp'])    _camera.position.addScaledVector(forward,  spd);
  if (_walkKeys['KeyS']   || _walkKeys['ArrowDown'])  _camera.position.addScaledVector(forward, -spd);
  if (_walkKeys['KeyA']   || _walkKeys['ArrowLeft'])  _camera.position.addScaledVector(right,   -spd);
  if (_walkKeys['KeyD']   || _walkKeys['ArrowRight']) _camera.position.addScaledVector(right,    spd);
  if (_walkKeys['Space'])                             _camera.position.y += spd;
  if (_walkKeys['ShiftLeft'] || _walkKeys['ShiftRight']) _camera.position.y -= spd;
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
  init, load, command, screenshot, getSceneSummary, onThemeChange, extractMeshData,
  setExplodeScale: applyExplodeScale,
  get hasFile()     { return !!_current; },
  get currentMeta() { return _meta; },
  get selectedMesh(){ return _selectedMesh; }
};

console.log('[renderer] Module loaded');
})();
