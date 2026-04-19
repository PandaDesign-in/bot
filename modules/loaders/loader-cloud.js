/* PandaAI — Point Cloud Loader (LAS, LAZ, XYZ, PTS, PTX, E57) */
(function() {
'use strict';

async function load(meta, buf, THREE) {
  const ext = meta.ext.toLowerCase();
  if (ext === 'xyz' || ext === 'pts') return loadXYZ(buf, THREE);
  if (ext === 'ptx') return loadPTX(buf, THREE);
  if (ext === 'las' || ext === 'laz') return loadLAS(buf, THREE, ext);
  if (ext === 'e57') return loadE57(buf, THREE);
  return loadXYZ(buf, THREE); // fallback
}

// ── XYZ / PTS (simple text point cloud) ──────
function loadXYZ(buf, THREE) {
  const text = new TextDecoder().decode(buf);
  const lines = text.trim().split('\n');
  const positions = [];
  const colors = [];
  let hasColor = false;
  let count = 0;
  const MAX = 5_000_000; // 5M points max

  for (const line of lines) {
    if (count >= MAX) break;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    const z = parseFloat(parts[2]);
    if (isNaN(x)||isNaN(y)||isNaN(z)) continue;
    positions.push(x, y, z);
    if (parts.length >= 6) {
      hasColor = true;
      colors.push(parseInt(parts[3])/255, parseInt(parts[4])/255, parseInt(parts[5])/255);
    }
    count++;
  }

  return buildPointCloud(positions, hasColor ? colors : null, THREE);
}

// ── PTX (Leica scanner) ───────────────────────
function loadPTX(buf, THREE) {
  // PTX has header rows then XYZ RGB data
  const text = new TextDecoder().decode(buf);
  const lines = text.trim().split('\n');
  const positions = [], colors = [];
  let hasColor = false;
  let headerDone = false, headerCount = 0;

  for (const line of lines) {
    if (!headerDone) {
      headerCount++;
      if (headerCount >= 10) headerDone = true; // PTX header is 10 lines
      continue;
    }
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const x = parseFloat(parts[0]), y = parseFloat(parts[1]), z = parseFloat(parts[2]);
    if (isNaN(x)||isNaN(y)||isNaN(z)) continue;
    positions.push(x, y, z);
    if (parts.length >= 7) {
      hasColor = true;
      colors.push(parseInt(parts[4])/255, parseInt(parts[5])/255, parseInt(parts[6])/255);
    }
  }
  return buildPointCloud(positions, hasColor ? colors : null, THREE);
}

// ── LAS / LAZ ─────────────────────────────────
async function loadLAS(buf, THREE, ext) {
  window.toast('Loading LAS point cloud…', 'nfo', 4000);
  // Minimal LAS 1.x reader (header + point records)
  const dv = new DataView(buf);
  const sig = String.fromCharCode(dv.getUint8(0),dv.getUint8(1),dv.getUint8(2),dv.getUint8(3));
  if (sig !== 'LASF') {
    window.toast('Invalid LAS file signature', 'er');
    return loadXYZ(buf, THREE); // try as text
  }

  const pointDataOffset = dv.getUint32(96, true);
  const numPoints = dv.getUint32(107, true) || dv.getBigUint64(247, true);
  const pointFormat = dv.getUint8(104);
  const pointLength = dv.getUint16(105, true);
  const scaleX = dv.getFloat64(131, true);
  const scaleY = dv.getFloat64(139, true);
  const scaleZ = dv.getFloat64(147, true);
  const offsetX = dv.getFloat64(155, true);
  const offsetY = dv.getFloat64(163, true);
  const offsetZ = dv.getFloat64(171, true);

  const MAX = 2_000_000;
  const total = Math.min(Number(numPoints), MAX);
  const stride = Math.max(1, Math.floor(Number(numPoints) / total));
  const positions = [], colors = [];
  let hasColor = false;

  const colorOffset = pointFormat >= 2 ? 20 : -1;

  for (let i = 0; i < Number(numPoints) && positions.length/3 < MAX; i += stride) {
    const off = pointDataOffset + i * pointLength;
    if (off + 12 > buf.byteLength) break;
    const x = dv.getInt32(off,     true) * scaleX + offsetX;
    const y = dv.getInt32(off + 4, true) * scaleY + offsetY;
    const z = dv.getInt32(off + 8, true) * scaleZ + offsetZ;
    positions.push(x, y, z);
    if (colorOffset > 0 && off + colorOffset + 6 <= buf.byteLength) {
      hasColor = true;
      colors.push(
        dv.getUint16(off + colorOffset,     true) / 65535,
        dv.getUint16(off + colorOffset + 2, true) / 65535,
        dv.getUint16(off + colorOffset + 4, true) / 65535
      );
    }
  }

  window.toast(`Loaded ${(positions.length/3).toLocaleString()} points`, 'ok', 3000);
  return buildPointCloud(positions, hasColor ? colors : null, THREE);
}

// ── E57 (minimal reader) ─────────────────────
async function loadE57(buf, THREE) {
  window.toast('E57: attempting basic parse…', 'nfo', 3000);
  // E57 is XML + binary — try to extract XYZ from binary section
  // Minimal heuristic: find Cartesian data
  const dv = new DataView(buf);
  const sig = String.fromCharCode(...new Uint8Array(buf, 0, 8));
  if (!sig.startsWith('ASTM-E57')) {
    window.toast('E57: invalid signature — trying as XYZ', 'nfo');
    return loadXYZ(buf, THREE);
  }
  // For now: extract float32 triplets from binary pages
  const positions = [];
  const PAGE = 1024;
  let offset = 48; // skip header
  while (offset + 12 < buf.byteLength && positions.length < 3_000_000) {
    const x = dv.getFloat32(offset, true);
    const y = dv.getFloat32(offset + 4, true);
    const z = dv.getFloat32(offset + 8, true);
    if (!isNaN(x) && Math.abs(x) < 1e6) positions.push(x, y, z);
    offset += 12;
  }
  if (positions.length < 9) throw new Error('Could not extract E57 point data');
  return buildPointCloud(positions, null, THREE);
}

// ── Build Three.js Points object ─────────────
function buildPointCloud(positions, colors, THREE) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  let mat;
  if (colors && colors.length === positions.length) {
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    mat = new THREE.PointsMaterial({ size: 0.02, vertexColors: true });
  } else {
    // Height-based coloring
    const col = [];
    const posArr = new Float32Array(positions);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < posArr.length; i += 3) { minY = Math.min(minY, posArr[i]); maxY = Math.max(maxY, posArr[i]); }
    const rangeY = maxY - minY || 1;
    for (let i = 0; i < posArr.length; i += 3) {
      const t = (posArr[i+1] - minY) / rangeY;
      // Blue → Cyan → Green → Yellow → Red
      const r = t > 0.75 ? 1 : t > 0.5 ? (t - 0.5) * 4 : 0;
      const g = t < 0.25 ? t * 4 : t < 0.75 ? 1 : (1-t) * 4;
      const b = t < 0.25 ? 1 : t < 0.5 ? (0.5 - t) * 4 : 0;
      col.push(r, g, b);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    mat = new THREE.PointsMaterial({ size: 0.02, vertexColors: true });
  }
  return new THREE.Points(geo, mat);
}

window.__cloudLoader = { load };
console.log('[loader-cloud] Ready');
})();
