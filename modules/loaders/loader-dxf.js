/* PandaAI — DXF Loader (AutoCAD Drawing Exchange Format) */
(function() {
'use strict';
const CDN_DXF = 'https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/src/DxfParser.js';

async function load(buf, THREE, defaultMat) {
  if (!window.DxfParser) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = CDN_DXF; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const text = new TextDecoder().decode(buf);
  const parser = new DxfParser();
  let dxf;
  try { dxf = parser.parseSync(text); }
  catch(e) { throw new Error('DXF parse error: ' + e.message); }

  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0x4a9eff });
  const matRed = new THREE.LineBasicMaterial({ color: 0xff4444 });

  function layerColor(layerName) {
    const layer = dxf.tables?.layer?.layers?.[layerName];
    if (layer?.color) {
      return new THREE.LineBasicMaterial({ color: layer.color });
    }
    return mat;
  }

  if (dxf.entities) {
    for (const entity of dxf.entities) {
      try {
        let obj = null;
        const lmat = layerColor(entity.layer);
        if (entity.type === 'LINE') {
          const pts = [
            new THREE.Vector3(entity.vertices[0].x, entity.vertices[0].y, entity.vertices[0].z || 0),
            new THREE.Vector3(entity.vertices[1].x, entity.vertices[1].y, entity.vertices[1].z || 0)
          ];
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          obj = new THREE.Line(geo, lmat);
        }
        else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
          const pts = entity.vertices.map(v => new THREE.Vector3(v.x, v.y, v.z || 0));
          if (entity.closed && pts.length) pts.push(pts[0].clone());
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          obj = new THREE.Line(geo, lmat);
        }
        else if (entity.type === 'CIRCLE') {
          const curve = new THREE.EllipseCurve(
            entity.center.x, entity.center.y,
            entity.radius, entity.radius, 0, 2 * Math.PI, false, 0
          );
          const pts = curve.getPoints(64).map(p => new THREE.Vector3(p.x, p.y, entity.center.z || 0));
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          obj = new THREE.Line(geo, lmat);
        }
        else if (entity.type === 'ARC') {
          const curve = new THREE.EllipseCurve(
            entity.center.x, entity.center.y,
            entity.radius, entity.radius,
            entity.startAngle * Math.PI / 180,
            entity.endAngle * Math.PI / 180,
            false, 0
          );
          const pts = curve.getPoints(32).map(p => new THREE.Vector3(p.x, p.y, entity.center.z || 0));
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          obj = new THREE.Line(geo, lmat);
        }
        else if (entity.type === 'SPLINE' && entity.controlPoints) {
          const pts = entity.controlPoints.map(p => new THREE.Vector3(p.x, p.y, p.z || 0));
          const curve = new THREE.CatmullRomCurve3(pts);
          const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
          obj = new THREE.Line(geo, lmat);
        }
        if (obj) { obj.name = entity.layer || ''; group.add(obj); }
      } catch(e) { /* skip bad entity */ }
    }
  }
  return group;
}

window.__dxfLoader = { load };
console.log('[loader-dxf] Ready');
})();
