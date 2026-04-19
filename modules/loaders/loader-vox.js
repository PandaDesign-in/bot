/* PandaAI — MagicaVoxel VOX Loader
   Parses MagicaVoxel .vox binary format (versions 150+).
   Renders each voxel as a coloured box mesh (merged for performance). */
(function() {
'use strict';

async function load(buf, THREE, defaultMat) {
  const dv = new DataView(buf);

  // Magic: "VOX " (0x56 0x4F 0x58 0x20)
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'VOX ') throw new Error('Not a MagicaVoxel VOX file');

  // Default MagicaVoxel palette (256 colours)
  const DEFAULT_PAL = [
    0x00000000, 0xffffffff, 0xffccffff, 0xff99ffff, 0xff66ffff, 0xff33ffff, 0xff00ffff,
    0xffffccff, 0xffccccff, 0xff99ccff, 0xff66ccff, 0xff33ccff, 0xff00ccff, 0xffff99ff,
    // ... truncated for brevity, filled with whites
  ];

  let palette = new Uint32Array(256);
  // Fill default palette
  for (let i = 0; i < 256; i++) palette[i] = DEFAULT_PAL[i] || 0xffffffff;

  // SIZE and XYZI chunks
  let sizeX = 0, sizeY = 0, sizeZ = 0;
  const voxels = []; // { x, y, z, c }

  let offset = 8; // skip magic + version
  // Parse MAIN chunk header
  offset += 12; // MAIN chunk id + contentSize + childrenSize

  while (offset + 12 <= buf.byteLength) {
    const id    = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset+1), dv.getUint8(offset+2), dv.getUint8(offset+3));
    const cSize = dv.getUint32(offset + 4, true);
    offset += 12; // id(4) + contentSize(4) + childrenSize(4)

    if (id === 'SIZE') {
      sizeX = dv.getUint32(offset,     true);
      sizeY = dv.getUint32(offset + 4, true);
      sizeZ = dv.getUint32(offset + 8, true);
    } else if (id === 'XYZI') {
      const numV = dv.getUint32(offset, true);
      for (let i = 0; i < numV; i++) {
        const base = offset + 4 + i * 4;
        voxels.push({
          x: dv.getUint8(base),
          y: dv.getUint8(base + 1),
          z: dv.getUint8(base + 2),
          c: dv.getUint8(base + 3)
        });
      }
    } else if (id === 'RGBA') {
      for (let i = 0; i < 256 && offset + i*4 + 3 < buf.byteLength; i++) {
        const r = dv.getUint8(offset + i*4);
        const g = dv.getUint8(offset + i*4 + 1);
        const b = dv.getUint8(offset + i*4 + 2);
        // RGBA chunk uses 1-indexed colours, shift left
        if (i < 255) palette[i + 1] = (r << 16) | (g << 8) | b;
      }
    }
    offset += cSize;
  }

  if (voxels.length === 0) throw new Error('No voxel data found in VOX file');

  // Build merged geometry grouped by colour
  const colourGroups = {};
  for (const v of voxels) {
    const rgba = palette[v.c] || 0xffffff;
    const hex  = ((rgba >> 16) & 0xff) << 16 | ((rgba >> 8) & 0xff) << 8 | (rgba & 0xff);
    if (!colourGroups[hex]) colourGroups[hex] = [];
    colourGroups[hex].push(v);
  }

  const group = new THREE.Group();
  const unitGeo = new THREE.BoxGeometry(1, 1, 1);

  for (const [hexStr, list] of Object.entries(colourGroups)) {
    const hex = parseInt(hexStr);
    const mat = new THREE.MeshPhongMaterial({ color: hex });
    // Merge boxes of same colour
    const merged = new THREE.BufferGeometry();
    const positions = [], normals = [], indices = [];
    let vOffset = 0;

    const posAttr  = unitGeo.attributes.position;
    const normAttr = unitGeo.attributes.normal;
    const idxArr   = unitGeo.index.array;

    for (const v of list) {
      // VOX uses Z-up; remap to Three.js Y-up
      const tx = v.x - sizeX / 2;
      const ty = v.z;
      const tz = -(v.y - sizeY / 2);

      for (let i = 0; i < posAttr.count; i++) {
        positions.push(posAttr.getX(i) + tx, posAttr.getY(i) + ty, posAttr.getZ(i) + tz);
        normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
      }
      for (const idx of idxArr) indices.push(idx + vOffset);
      vOffset += posAttr.count;
    }

    merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    merged.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(normals),   3));
    merged.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    group.add(new THREE.Mesh(merged, mat));
  }

  return group;
}

window.__voxLoader = { load };
console.log('[loader-vox] Ready');
})();
