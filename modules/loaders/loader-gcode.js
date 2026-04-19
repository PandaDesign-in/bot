/* PandaAI — G-code Loader
   Visualises CNC / 3D printing toolpaths.
   Rapid moves (G0) shown in blue, cut moves (G1/G2/G3) in white/orange.
   Supports G0, G1 (linear), G2/G3 (arc), absolute/relative/metric/imperial. */
(function() {
'use strict';

async function load(buf, THREE, defaultMat) {
  const text = new TextDecoder().decode(buf);
  const group = parseGcode(text, THREE);
  if (!group || group.children.length === 0) throw new Error('No toolpath geometry found in G-code');
  return group;
}

function parseGcode(text, THREE) {
  const group = new THREE.Group();
  const rapidMat = new THREE.LineBasicMaterial({ color: 0x4a9eff, opacity: 0.5, transparent: true });
  const cutMat   = new THREE.LineBasicMaterial({ color: 0xffffff });
  const arcMat   = new THREE.LineBasicMaterial({ color: 0xe8a87c });

  let x = 0, y = 0, z = 0;
  let relative = false;
  let mmMode = true;

  const rapidPts = [];
  const cutPts   = [];

  function flush(pts, mat) {
    if (pts.length < 2) return;
    const geo = new THREE.BufferGeometry().setFromPoints([...pts]);
    group.add(new THREE.Line(geo, mat));
    pts.length = 0;
  }

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    // Strip comments
    const line = rawLine.replace(/[;(][^)]*\)?/g, '').trim().toUpperCase();
    if (!line) continue;

    // Parse tokens: G21, X10.5, Y-3.2, Z0.5, I5, J0, F1200
    const tok = {};
    for (const m of line.matchAll(/([A-Z])([-\d.]+)/g)) {
      tok[m[1]] = parseFloat(m[2]);
    }
    if (tok.G === undefined && tok.M === undefined) continue;

    const g = tok.G;
    const scale = mmMode ? 1 : 25.4;

    function resolve(axis, cur) {
      const v = tok[axis];
      if (v === undefined) return cur;
      return relative ? cur + v * scale : v * scale;
    }

    if (g === 20) { mmMode = false; continue; }
    if (g === 21) { mmMode = true;  continue; }
    if (g === 90) { relative = false; continue; }
    if (g === 91) { relative = true;  continue; }

    if (g === 0) {
      // Rapid move — flush cuts, record rapid
      flush(cutPts, cutMat);
      if (rapidPts.length === 0) rapidPts.push(new THREE.Vector3(x, y, z));
      x = resolve('X', x); y = resolve('Y', y); z = resolve('Z', z);
      rapidPts.push(new THREE.Vector3(x, y, z));
    } else if (g === 1) {
      // Linear cut — flush rapids, record cut
      flush(rapidPts, rapidMat);
      if (cutPts.length === 0) cutPts.push(new THREE.Vector3(x, y, z));
      x = resolve('X', x); y = resolve('Y', y); z = resolve('Z', z);
      cutPts.push(new THREE.Vector3(x, y, z));
    } else if (g === 2 || g === 3) {
      // Arc — flush cuts first, then draw arc, then continue cuts
      flush(cutPts, cutMat);
      const x0 = x, y0 = y;
      const xEnd = resolve('X', x), yEnd = resolve('Y', y), zEnd = resolve('Z', z);
      const ci = tok.I ?? 0, cj = tok.J ?? 0;
      const cx = x0 + ci, cy = y0 + cj;
      const r  = Math.sqrt(ci*ci + cj*cj);
      const a0 = Math.atan2(y0 - cy, x0 - cx);
      const a1 = Math.atan2(yEnd - cy, xEnd - cx);
      const ccw = g === 3;
      const arcPts = [new THREE.Vector3(x0, y0, z)];
      let span = ccw ? (a1 > a0 ? a1 - a0 : a1 - a0 + Math.PI*2)
                     : (a0 > a1 ? a0 - a1 : a0 - a1 + Math.PI*2);
      const segs = Math.max(4, Math.ceil(span / (Math.PI / 16)));
      for (let i = 1; i <= segs; i++) {
        const t  = ccw ? a0 + (i/segs)*span : a0 - (i/segs)*span;
        const az = z + (zEnd - z) * (i / segs);
        arcPts.push(new THREE.Vector3(cx + Math.cos(t)*r, cy + Math.sin(t)*r, az));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(arcPts);
      group.add(new THREE.Line(geo, arcMat));
      x = xEnd; y = yEnd; z = zEnd;
    }
  }

  flush(rapidPts, rapidMat);
  flush(cutPts,   cutMat);
  return group;
}

window.__gcodeLoader = { load };
console.log('[loader-gcode] Ready');
})();
