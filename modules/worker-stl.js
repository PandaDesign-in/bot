/* ═══════════════════════════════════════════════
   PandaAI 🐼 — STL Web Worker
   Parses binary or ASCII STL files completely off
   the main thread. Transferable buffers — zero copy.

   Messages IN:  { buffer: ArrayBuffer }
   Messages OUT:
     { type:'progress', pct:0–100 }
     { type:'done', positions:Float32Array, normals:Float32Array }
     { type:'error', message:string }
═══════════════════════════════════════════════ */

/* ── Detect binary vs ASCII ─────────────────── */
function isBinarySTL(buffer) {
  if (buffer.byteLength < 84) return false;
  const dv       = new DataView(buffer);
  const triCount = dv.getUint32(80, true);
  if (triCount === 0) return false;
  const expected = 84 + triCount * 50;
  // Allow ±4 bytes for minor exporter quirks
  return Math.abs(buffer.byteLength - expected) <= 4;
}

/* ── Binary STL parser ──────────────────────── */
function parseBinary(buffer) {
  const dv       = new DataView(buffer);
  const triCount = dv.getUint32(80, true);

  const positions = new Float32Array(triCount * 9);  // 3 verts × XYZ
  const normals   = new Float32Array(triCount * 9);  // flat normals

  const REPORT_EVERY = 100_000;
  let off = 84, pi = 0, ni = 0;

  for (let i = 0; i < triCount; i++) {
    // Facet normal
    const nx = dv.getFloat32(off,      true);
    const ny = dv.getFloat32(off +  4, true);
    const nz = dv.getFloat32(off +  8, true);
    off += 12;

    // 3 vertices
    for (let v = 0; v < 3; v++) {
      positions[pi++] = dv.getFloat32(off,     true);
      positions[pi++] = dv.getFloat32(off + 4, true);
      positions[pi++] = dv.getFloat32(off + 8, true);
      normals[ni++] = nx;
      normals[ni++] = ny;
      normals[ni++] = nz;
      off += 12;
    }
    off += 2; // attribute byte count

    if (i % REPORT_EVERY === 0) {
      self.postMessage({ type: 'progress', pct: Math.round(i / triCount * 100) });
    }
  }

  return { positions, normals, triCount };
}

/* ── ASCII STL parser ───────────────────────── */
function parseASCII(buffer) {
  const text  = new TextDecoder().decode(buffer);
  const lines = text.split(/\r?\n/);
  const pos   = [];
  const nor   = [];
  let nx = 0, ny = 0, nz = 0;
  const total = lines.length;
  const REPORT_EVERY = 50_000;

  for (let li = 0; li < lines.length; li++) {
    const raw  = lines[li];
    const line = raw.trimStart();

    if (line.startsWith('facet normal')) {
      const p = line.split(/\s+/);
      nx = parseFloat(p[2]);
      ny = parseFloat(p[3]);
      nz = parseFloat(p[4]);
    } else if (line.startsWith('vertex')) {
      const p = line.split(/\s+/);
      pos.push(parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]));
      nor.push(nx, ny, nz);
    }

    if (li % REPORT_EVERY === 0) {
      self.postMessage({ type: 'progress', pct: Math.round(li / total * 100) });
    }
  }

  const triCount = Math.floor(pos.length / 9);
  return {
    positions: new Float32Array(pos),
    normals:   new Float32Array(nor),
    triCount
  };
}

/* ── Entry ──────────────────────────────────── */
self.onmessage = function (e) {
  const buffer = e.data.buffer;
  try {
    const binary = isBinarySTL(buffer);
    const result = binary ? parseBinary(buffer) : parseASCII(buffer);
    // Transfer the large typed arrays — zero-copy move to main thread
    self.postMessage(
      {
        type:      'done',
        positions: result.positions,
        normals:   result.normals,
        triCount:  result.triCount,
        wasBinary: binary
      },
      [result.positions.buffer, result.normals.buffer]
    );
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
