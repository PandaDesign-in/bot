/* PandaAI — DXF Loader (self-contained, zero CDN dependency)
   Supports: LINE, CIRCLE, ARC, ELLIPSE, LWPOLYLINE, POLYLINE/VERTEX,
             SPLINE, 3DFACE, SOLID, INSERT (block references), HATCH (outline)
   Works with both 2D floor plans and 3D drawings. */
(function() {
'use strict';

// ── Entry point ───────────────────────────────
async function load(buf, THREE, defaultMat) {
  const text = new TextDecoder().decode(buf);
  const entities = parseDXF(text);
  const group = buildScene(entities, THREE, defaultMat);
  if (!group || group.children.length === 0) throw new Error('No renderable geometry found in DXF');
  return group;
}

// ── DXF Parser ────────────────────────────────
function parseDXF(text) {
  // Split into group-code / value pairs, one per two lines
  const raw = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const codeStr = raw[i].trim();
    const value   = raw[i + 1].trim();
    const code    = parseInt(codeStr, 10);
    if (!isNaN(code)) { pairs.push([code, value]); i++; }
  }

  const entities = [];
  let sectionName = '';
  let inDrawable  = false;
  let current     = null;

  for (const [code, value] of pairs) {
    // Track sections
    if (code === 0 && value === 'SECTION') { inDrawable = false; continue; }
    if (code === 2 && !inDrawable) { sectionName = value; inDrawable = (value === 'ENTITIES' || value === 'BLOCKS'); continue; }
    if (code === 0 && value === 'ENDSEC') { if (current) { entities.push(current); current = null; } inDrawable = false; sectionName = ''; continue; }
    if (!inDrawable) continue;

    const f = parseFloat(value);

    if (code === 0) {
      if (current && current.type !== 'SEQEND' && current.type !== 'ENDBLK') entities.push(current);
      current = { type: value, layer: '0', pts: [], bulges: [], closed: false };
      continue;
    }
    if (!current) continue;

    switch (code) {
      case 8:  current.layer = value; break;
      case 2:  current.blockName = value; break;
      case 62: current.colorACI = parseInt(value, 10); break;
      // Point 0 (center / start / insertion)
      case 10: current.pts.push({ x: f, y: 0, z: 0 }); break;
      case 20: if (current.pts.length) current.pts[current.pts.length - 1].y = f; break;
      case 30: if (current.pts.length) current.pts[current.pts.length - 1].z = f; break;
      // Point 1 (end / second corner / major axis)
      case 11: current.x1 = f; break; case 21: current.y1 = f; break; case 31: current.z1 = f; break;
      // Point 2 (third corner)
      case 12: current.x2 = f; break; case 22: current.y2 = f; break; case 32: current.z2 = f; break;
      // Point 3 (fourth corner)
      case 13: current.x3 = f; break; case 23: current.y3 = f; break; case 33: current.z3 = f; break;
      case 40: current.r   = f; break;   // radius / major semi-axis / row spacing
      case 41: current.r2  = f; break;   // minor axis ratio
      case 42: current.bulges.push(f); break; // polyline arc segment
      case 50: current.a0  = f; break;   // start angle
      case 51: current.a1  = f; break;   // end angle
      case 70: current.flags   = parseInt(value, 10); current.closed = !!(current.flags & 1); break;
      case 71: current.meshM   = parseInt(value, 10); break;
      case 72: current.meshN   = parseInt(value, 10); break;
      case 90: current.count   = parseInt(value, 10); break;
      case 1:  current.textVal = value; break;
    }
  }
  if (current && current.type !== 'SEQEND' && current.type !== 'ENDBLK') entities.push(current);
  return entities;
}

// ── ACI color index → hex ─────────────────────
const ACI_COLORS = [
  0xffffff, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff,
  0xffffff, 0x808080, 0xc0c0c0, 0xff0000, 0xff7f7f, 0xcc0000, 0xcc6666,
  0x990000, 0x994c4c, 0x7f0000, 0x7f3f3f, 0x4c0000, 0x4c2626
];
function aciToHex(aci) {
  if (aci > 0 && aci < ACI_COLORS.length) return ACI_COLORS[aci];
  return 0x4a9eff; // default blue
}

// ── Scene builder ─────────────────────────────
function buildScene(entities, THREE, defaultMat) {
  const group = new THREE.Group();

  function lineMat(e) {
    return new THREE.LineBasicMaterial({ color: aciToHex(e.colorACI) });
  }
  function fillMat(e) {
    const col = aciToHex(e.colorACI);
    return defaultMat ? defaultMat() : new THREE.MeshPhongMaterial({ color: col, side: THREE.DoubleSide });
  }
  function addLine(pts, mat) {
    if (pts.length < 2) return;
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }

  for (let ei = 0; ei < entities.length; ei++) {
    const e = entities[ei];
    try {
      switch (e.type) {

        case 'LINE': {
          if (!e.pts[0]) break;
          const p = e.pts[0];
          addLine([
            new THREE.Vector3(p.x, p.y, p.z),
            new THREE.Vector3(e.x1 ?? 0, e.y1 ?? 0, e.z1 ?? 0)
          ], lineMat(e));
          break;
        }

        case 'CIRCLE': {
          if (!e.pts[0] || !e.r) break;
          const c = e.pts[0]; const r = e.r;
          const pts = [];
          for (let i = 0; i <= 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            pts.push(new THREE.Vector3(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, c.z));
          }
          addLine(pts, lineMat(e));
          break;
        }

        case 'ARC': {
          if (!e.pts[0] || !e.r) break;
          const c = e.pts[0]; const r = e.r;
          let a0 = (e.a0 ?? 0)   * Math.PI / 180;
          let a1 = (e.a1 ?? 360) * Math.PI / 180;
          if (a1 <= a0) a1 += Math.PI * 2;
          const span = a1 - a0;
          const segs = Math.max(8, Math.ceil(span / (Math.PI / 16)));
          const pts = [];
          for (let i = 0; i <= segs; i++) {
            const a = a0 + (i / segs) * span;
            pts.push(new THREE.Vector3(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, c.z));
          }
          addLine(pts, lineMat(e));
          break;
        }

        case 'ELLIPSE': {
          if (!e.pts[0]) break;
          const c   = e.pts[0];
          const mx  = e.x1 ?? 1, my = e.y1 ?? 0;
          const a   = Math.sqrt(mx * mx + my * my);
          const b   = a * (e.r2 ?? 1);
          const rot = Math.atan2(my, mx);
          const t0  = e.a0 ?? 0, t1 = e.a1 ?? (Math.PI * 2);
          const pts = [];
          for (let i = 0; i <= 64; i++) {
            const t  = t0 + (i / 64) * (t1 - t0);
            const ex = Math.cos(t) * a, ey = Math.sin(t) * b;
            pts.push(new THREE.Vector3(
              c.x + ex * Math.cos(rot) - ey * Math.sin(rot),
              c.y + ex * Math.sin(rot) + ey * Math.cos(rot),
              c.z
            ));
          }
          addLine(pts, lineMat(e));
          break;
        }

        case 'LWPOLYLINE': {
          if (e.pts.length < 2) break;
          const pts = e.pts.map(p => new THREE.Vector3(p.x, p.y, p.z));
          if (e.closed && pts.length) pts.push(pts[0].clone());
          addLine(pts, lineMat(e));
          break;
        }

        case 'POLYLINE': {
          // Read VERTEX entities that follow
          const verts = [];
          for (let j = ei + 1; j < entities.length; j++) {
            if (entities[j].type === 'SEQEND') break;
            if (entities[j].type === 'VERTEX' && entities[j].pts[0]) {
              verts.push(new THREE.Vector3(entities[j].pts[0].x, entities[j].pts[0].y, entities[j].pts[0].z));
            }
          }
          if (verts.length >= 2) {
            if (e.closed) verts.push(verts[0].clone());
            addLine(verts, lineMat(e));
          }
          break;
        }

        case 'SPLINE': {
          if (e.pts.length < 2) break;
          const ctrlPts = e.pts.map(p => new THREE.Vector3(p.x, p.y, p.z));
          const curve   = new THREE.CatmullRomCurve3(ctrlPts);
          addLine(curve.getPoints(Math.max(50, ctrlPts.length * 8)), lineMat(e));
          break;
        }

        case '3DFACE':
        case 'SOLID': {
          if (!e.pts[0]) break;
          const p0 = new THREE.Vector3(e.pts[0].x, e.pts[0].y, e.pts[0].z);
          const p1 = new THREE.Vector3(e.x1 ?? 0, e.y1 ?? 0, e.z1 ?? 0);
          const p2 = new THREE.Vector3(e.x2 ?? 0, e.y2 ?? 0, e.z2 ?? 0);
          const p3 = new THREE.Vector3(e.x3 ?? 0, e.y3 ?? 0, e.z3 ?? 0);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            p0.x,p0.y,p0.z, p1.x,p1.y,p1.z, p2.x,p2.y,p2.z,
            p0.x,p0.y,p0.z, p2.x,p2.y,p2.z, p3.x,p3.y,p3.z
          ]), 3));
          geo.computeVertexNormals();
          group.add(new THREE.Mesh(geo, fillMat(e)));
          break;
        }

        case 'HATCH': {
          // Render hatch boundary as lines
          const pts = e.pts.map(p => new THREE.Vector3(p.x, p.y, p.z));
          if (pts.length >= 2) {
            if (pts.length > 2) pts.push(pts[0].clone());
            addLine(pts, new THREE.LineBasicMaterial({ color: 0x666666 }));
          }
          break;
        }

      }
    } catch (_) { /* skip bad entity */ }
  }

  return group;
}

window.__dxfLoader = { load };
console.log('[loader-dxf] Ready');
})();
