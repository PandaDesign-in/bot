/* PandaAI — Rhino 3DM Loader */
(function() {
'use strict';
const URL_3DM = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.0.1/rhino3dm.module.min.js';

let _rhino = null;

async function load(buf, THREE, defaultMat) {
  if (!_rhino) {
    window.toast('Loading Rhino 3DM engine…', 'nfo', 4000);
    const mod = await import(URL_3DM);
    _rhino = await mod.default();
  }
  const arr = new Uint8Array(buf);
  const doc = _rhino.File3dm.fromByteArray(arr);
  if (!doc) throw new Error('Could not parse 3DM file');

  const group = new THREE.Group();
  const objects = doc.objects();
  for (let i = 0; i < objects.count; i++) {
    try {
      const obj = objects.get(i);
      const geo = obj.geometry();
      if (!geo) continue;
      const typeName = geo.objectType;

      // Mesh
      if (typeName === _rhino.ObjectType.Mesh || geo.faces) {
        const faces = geo.faces();
        const verts = geo.vertices();
        if (!verts || !faces) continue;
        const positions = [];
        const indices = [];
        for (let v = 0; v < verts.count; v++) {
          const pt = verts.get(v);
          positions.push(pt[0], pt[1], pt[2]);
        }
        for (let f = 0; f < faces.count; f++) {
          const face = faces.get(f);
          indices.push(face[0], face[1], face[2]);
          if (face[2] !== face[3]) indices.push(face[0], face[2], face[3]);
        }
        const bGeo = new THREE.BufferGeometry();
        bGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        bGeo.setIndex(indices);
        bGeo.computeVertexNormals();
        const mat = defaultMat ? defaultMat() : new THREE.MeshPhongMaterial({ color: 0x888888, side: THREE.DoubleSide });
        group.add(new THREE.Mesh(bGeo, mat));
      }
      // Curve / LineCurve
      else if (geo.points || typeName === _rhino.ObjectType.Curve) {
        try {
          const pts3d = geo.points ? geo.points() : null;
          if (pts3d && pts3d.count > 1) {
            const v3 = [];
            for (let p = 0; p < pts3d.count; p++) {
              const pt = pts3d.get(p);
              v3.push(new THREE.Vector3(pt[0], pt[1], pt[2]));
            }
            const lineGeo = new THREE.BufferGeometry().setFromPoints(v3);
            group.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x4a9eff })));
          }
        } catch(e) { /* skip curve */ }
      }
    } catch(e) { /* skip object */ }
  }
  doc.delete();
  return group;
}

window.__3dmLoader = { load };
console.log('[loader-3dm] Ready');
})();
