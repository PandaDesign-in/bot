/* PandaAI — Geo Loader (KML/KMZ, GeoJSON, DEM) */
(function() {
'use strict';

async function load(meta, buf, THREE) {
  const ext = meta.ext.toLowerCase();
  if (ext === 'geojson' || ext === 'json') return loadGeoJSON(buf, THREE);
  if (ext === 'kml') return loadKML(buf, THREE);
  if (ext === 'kmz') return loadKMZ(buf, THREE);
  if (ext === 'dem' || ext === 'asc') return loadDEM(buf, THREE);
  if (ext === 'gml') return loadGML(buf, THREE);
  return loadGeoJSON(buf, THREE);
}

// ── GeoJSON ───────────────────────────────────
function loadGeoJSON(buf, THREE) {
  const text = new TextDecoder().decode(buf);
  const gj = JSON.parse(text);
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0x4a9eff });
  const matFill = new THREE.MeshBasicMaterial({ color: 0x4a9eff, opacity: 0.3, transparent: true, side: THREE.DoubleSide });

  function processFeature(feature) {
    if (!feature.geometry) return;
    const geom = feature.geometry;
    const type = geom.type;

    function coordToVec(c) {
      // GeoJSON [lng, lat, alt?] → Three.js [x, y, z]
      return new THREE.Vector3(c[0], c[2] || 0, -c[1]);
    }

    if (type === 'LineString') {
      const pts = geom.coordinates.map(coordToVec);
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    else if (type === 'MultiLineString') {
      geom.coordinates.forEach(line => {
        const pts = line.map(coordToVec);
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      });
    }
    else if (type === 'Polygon') {
      geom.coordinates.forEach(ring => {
        const pts = ring.map(coordToVec);
        if (pts[0] && pts[pts.length-1] && !pts[0].equals(pts[pts.length-1])) pts.push(pts[0].clone());
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      });
    }
    else if (type === 'MultiPolygon') {
      geom.coordinates.forEach(poly => poly.forEach(ring => {
        const pts = ring.map(coordToVec);
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      }));
    }
    else if (type === 'Point') {
      const v = coordToVec(geom.coordinates);
      const geo = new THREE.SphereGeometry(0.01, 6, 6);
      group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff4444 })));
      group.children[group.children.length-1].position.copy(v);
    }
  }

  if (gj.type === 'FeatureCollection') {
    gj.features?.forEach(processFeature);
  } else if (gj.type === 'Feature') {
    processFeature(gj);
  } else {
    processFeature({ geometry: gj });
  }
  return group;
}

// ── KML ───────────────────────────────────────
function loadKML(buf, THREE) {
  const text = new TextDecoder().decode(buf);
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0xff6644 });

  const coordNodes = doc.querySelectorAll('coordinates');
  coordNodes.forEach(node => {
    const raw = node.textContent.trim();
    const pts = raw.split(/\s+/).map(c => {
      const parts = c.split(',');
      return new THREE.Vector3(parseFloat(parts[0]), parseFloat(parts[2])||0, -parseFloat(parts[1]));
    }).filter(v => !isNaN(v.x));
    if (pts.length > 1) {
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
  });
  return group;
}

// ── KMZ (ZIP containing doc.kml) ─────────────
async function loadKMZ(buf, THREE) {
  // Need JSZip for this — load from CDN
  if (!window.JSZip) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const zip = await window.JSZip.loadAsync(buf);
  const kmlFile = Object.keys(zip.files).find(n => n.endsWith('.kml'));
  if (!kmlFile) throw new Error('No .kml found in KMZ');
  const kmlBuf = await zip.files[kmlFile].async('arraybuffer');
  return loadKML(kmlBuf, THREE);
}

// ── DEM (ASCII Grid elevation) ────────────────
function loadDEM(buf, THREE) {
  const text = new TextDecoder().decode(buf);
  const lines = text.trim().split('\n');
  const header = {};
  let dataStart = 0;

  // Parse ASCII grid header (ncols, nrows, xllcorner, yllcorner, cellsize, nodata_value)
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const m = lines[i].trim().match(/^(\w+)\s+([\d.-]+)$/i);
    if (m) { header[m[1].toLowerCase()] = parseFloat(m[2]); dataStart = i + 1; }
    else break;
  }

  const ncols = header.ncols || 100;
  const nrows = header.nrows || 100;
  const cellsize = header.cellsize || 1;
  const nodata = header.nodata_value ?? -9999;

  const elevations = [];
  for (let r = dataStart; r < lines.length; r++) {
    const vals = lines[r].trim().split(/\s+/).map(Number);
    elevations.push(...vals);
  }

  // Build terrain mesh
  const geo = new THREE.PlaneGeometry(ncols * cellsize, nrows * cellsize, ncols - 1, nrows - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  let minE = Infinity, maxE = -Infinity;
  for (let i = 0; i < elevations.length; i++) {
    if (elevations[i] !== nodata) { minE = Math.min(minE, elevations[i]); maxE = Math.max(maxE, elevations[i]); }
  }
  for (let i = 0; i < pos.count && i < elevations.length; i++) {
    const e = elevations[i] === nodata ? minE : elevations[i];
    pos.setY(i, e);
  }
  geo.computeVertexNormals();

  // Color by elevation
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minE) / (maxE - minE || 1);
    colors[i*3]   = t > 0.6 ? 0.9 : t * 0.5;
    colors[i*3+1] = t < 0.3 ? 0.6 + t : 0.7 - t * 0.4;
    colors[i*3+2] = t < 0.2 ? 0.4 : 0.1;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

// ── GML (CityGML — minimal) ───────────────────
function loadGML(buf, THREE) {
  // Parse as KML-like (look for coordinates tags)
  return loadKML(buf, THREE);
}

window.__geoLoader = { load };
console.log('[loader-geo] Ready');
})();
