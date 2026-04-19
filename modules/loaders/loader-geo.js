/* PandaAI — Geo Loader (KML/KMZ, GeoJSON, DEM, GPX, OSM, SHP, CityJSON, CityGML) */
(function() {
'use strict';

async function load(meta, buf, THREE) {
  const ext = meta.ext.toLowerCase();
  if (ext === 'geojson' || ext === 'json' || ext === 'cityjson') return loadGeoJSONorCity(buf, THREE);
  if (ext === 'kml')  return loadKML(buf, THREE);
  if (ext === 'kmz')  return loadKMZ(buf, THREE);
  if (ext === 'dem' || ext === 'asc') return loadDEM(buf, THREE);
  if (ext === 'gml')  return loadGML(buf, THREE);
  if (ext === 'gpx')  return loadGPX(buf, THREE);
  if (ext === 'osm')  return loadOSM(buf, THREE);
  if (ext === 'shp')  return loadSHP(buf, THREE);
  return loadGeoJSONorCity(buf, THREE);
}

// ── GeoJSON or CityJSON (auto-detect) ──────────
function loadGeoJSONorCity(buf, THREE) {
  const text = new TextDecoder().decode(buf);
  let data;
  try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid JSON: ' + e.message); }
  // CityJSON detection
  if (data.type === 'CityJSON') return loadCityJSON(data, THREE);
  return loadGeoJSONObj(data, THREE);
}

// ── GeoJSON ───────────────────────────────────
function loadGeoJSON(buf, THREE) {
  const text = new TextDecoder().decode(buf);
  const gj   = JSON.parse(text);
  return loadGeoJSONObj(gj, THREE);
}

function loadGeoJSONObj(gj, THREE) {
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

// ── GPX (GPS Exchange Format) ──────────────────
function loadGPX(buf, THREE) {
  const text = new TextDecoder().decode(buf);
  const doc  = new DOMParser().parseFromString(text, 'text/xml');
  const group = new THREE.Group();
  const mat   = new THREE.LineBasicMaterial({ color: 0x4ade80 });

  function trkToLine(nodes) {
    const pts = [...nodes].map(n => {
      const lat = parseFloat(n.getAttribute('lat'));
      const lon = parseFloat(n.getAttribute('lon'));
      const ele = parseFloat(n.querySelector('ele')?.textContent || '0');
      return new THREE.Vector3(lon, ele / 1000, -lat);
    }).filter(v => !isNaN(v.x));
    if (pts.length > 1) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }

  doc.querySelectorAll('trkseg').forEach(seg => trkToLine(seg.querySelectorAll('trkpt')));
  doc.querySelectorAll('rte').forEach(rte => trkToLine(rte.querySelectorAll('rtept')));
  // Waypoints as spheres
  doc.querySelectorAll('wpt').forEach(wpt => {
    const lat = parseFloat(wpt.getAttribute('lat')), lon = parseFloat(wpt.getAttribute('lon'));
    if (isNaN(lat)) return;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.002, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xff4444 }));
    m.position.set(lon, 0, -lat);
    group.add(m);
  });
  return group;
}

// ── OSM (OpenStreetMap XML) ────────────────────
function loadOSM(buf, THREE) {
  const text = new TextDecoder().decode(buf);
  const doc  = new DOMParser().parseFromString(text, 'text/xml');
  const group = new THREE.Group();

  // Build node lookup: id → {lat, lon}
  const nodes = {};
  doc.querySelectorAll('node').forEach(n => {
    nodes[n.getAttribute('id')] = {
      lat: parseFloat(n.getAttribute('lat')),
      lon: parseFloat(n.getAttribute('lon'))
    };
  });

  // Classify ways by tags
  const highwayMat  = new THREE.LineBasicMaterial({ color: 0xfbbf24 });
  const buildingMat = new THREE.LineBasicMaterial({ color: 0x4a9eff });
  const waterMat    = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
  const defaultMat  = new THREE.LineBasicMaterial({ color: 0x555555 });

  doc.querySelectorAll('way').forEach(way => {
    const tags = {};
    way.querySelectorAll('tag').forEach(t => { tags[t.getAttribute('k')] = t.getAttribute('v'); });

    const mat = tags.highway ? highwayMat
              : tags.building ? buildingMat
              : tags.waterway || tags.natural === 'water' ? waterMat
              : defaultMat;

    const pts = [...way.querySelectorAll('nd')].map(nd => {
      const n = nodes[nd.getAttribute('ref')];
      return n ? new THREE.Vector3(n.lon, 0, -n.lat) : null;
    }).filter(Boolean);

    if (pts.length > 1) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  });

  return group;
}

// ── SHP (Shapefile — geometry only) ───────────
function loadSHP(buf, THREE) {
  const dv    = new DataView(buf);
  const group = new THREE.Group();
  const mat   = new THREE.LineBasicMaterial({ color: 0x4a9eff });

  // File header: first 4 bytes = file code (9994), big-endian
  const fileCode = dv.getInt32(0, false);
  if (fileCode !== 9994) throw new Error('Not a valid Shapefile (.shp)');

  const shapeType = dv.getInt32(32, true); // little-endian
  let offset = 100; // data start

  while (offset + 8 <= buf.byteLength) {
    // Record header: record number + content length (big-endian, 16-bit words)
    const contentLen = dv.getInt32(offset + 4, false) * 2; // in bytes
    offset += 8;
    const recEnd = offset + contentLen;
    if (recEnd > buf.byteLength) break;

    const recShapeType = dv.getInt32(offset, true);
    const base = offset + 4;

    try {
      if (recShapeType === 3 || recShapeType === 13 || recShapeType === 23) {
        // PolyLine / PolyLineZ / PolyLineM
        const numParts = dv.getInt32(base + 32, true);
        const numPts   = dv.getInt32(base + 36, true);
        const partsOff = base + 40;
        const ptsOff   = partsOff + numParts * 4;
        const parts    = [];
        for (let i = 0; i < numParts; i++) parts.push(dv.getInt32(partsOff + i*4, true));
        parts.push(numPts); // sentinel
        for (let p = 0; p < numParts; p++) {
          const pts = [];
          for (let i = parts[p]; i < parts[p+1]; i++) {
            const x = dv.getFloat64(ptsOff + i*16, true);
            const y = dv.getFloat64(ptsOff + i*16 + 8, true);
            pts.push(new THREE.Vector3(x, 0, -y));
          }
          if (pts.length > 1) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
        }
      } else if (recShapeType === 5 || recShapeType === 15 || recShapeType === 25) {
        // Polygon / PolygonZ / PolygonM — same layout as PolyLine
        const numParts = dv.getInt32(base + 32, true);
        const numPts   = dv.getInt32(base + 36, true);
        const partsOff = base + 40;
        const ptsOff   = partsOff + numParts * 4;
        const parts    = [];
        for (let i = 0; i < numParts; i++) parts.push(dv.getInt32(partsOff + i*4, true));
        parts.push(numPts);
        for (let p = 0; p < numParts; p++) {
          const pts = [];
          for (let i = parts[p]; i < parts[p+1]; i++) {
            const x = dv.getFloat64(ptsOff + i*16, true);
            const y = dv.getFloat64(ptsOff + i*16 + 8, true);
            pts.push(new THREE.Vector3(x, 0, -y));
          }
          if (pts.length > 1) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
        }
      } else if (recShapeType === 1 || recShapeType === 11 || recShapeType === 21) {
        // Point / PointZ / PointM
        const x = dv.getFloat64(base + 4, true);
        const y = dv.getFloat64(base + 12, true);
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 5, 5),
          new THREE.MeshBasicMaterial({ color: 0xff4444 }));
        m.position.set(x, 0, -y);
        group.add(m);
      }
    } catch (_) { /* skip bad record */ }

    offset = recEnd;
  }

  if (group.children.length === 0) throw new Error('No geometry found in Shapefile');
  return group;
}

// ── CityJSON ────────────────────────────────────
function loadCityJSON(data, THREE) {
  const group    = new THREE.Group();
  const vertices = data.vertices || [];
  const tf       = data.transform;

  function v3(idx) {
    const v = vertices[idx];
    if (!v) return new THREE.Vector3();
    const x = tf ? v[0] * tf.scale[0] + tf.translate[0] : v[0];
    const y = tf ? v[1] * tf.scale[1] + tf.translate[1] : v[1];
    const z = tf ? v[2] * tf.scale[2] + tf.translate[2] : v[2];
    return new THREE.Vector3(x, z, -y);
  }

  const colorMap = {
    Building:         0x4a9eff, BuildingPart: 0x4a9eff,
    Road:             0xfbbf24, Railway:      0x888888,
    WaterBody:        0x38bdf8, LandUse:      0x4ade80,
    CityFurniture:    0xe8a87c, Bridge:       0xff6644,
    PlantCover:       0x22c55e, TINRelief:    0x92400e,
  };

  for (const [, obj] of Object.entries(data.CityObjects || {})) {
    const color = colorMap[obj.type] || 0xaaaaaa;
    const mat   = new THREE.MeshPhongMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });

    for (const geom of (obj.geometry || [])) {
      if (geom.type === 'Solid') {
        for (const shell of geom.boundaries) {
          for (const face of shell) buildFace(face[0], v3, group, mat);
        }
      } else if (geom.type === 'MultiSurface' || geom.type === 'CompositeSurface') {
        for (const face of geom.boundaries) buildFace(face[0] || face, v3, group, mat);
      }
    }
  }

  return group.children.length ? group : null;
}

function buildFace(ring, v3, group, mat) {
  if (!ring || ring.length < 3) return;
  const pts = ring.map(i => v3(i));
  // Simple fan triangulation
  const geo = new THREE.BufferGeometry();
  const pos = [];
  for (let i = 1; i < pts.length - 1; i++) {
    pos.push(pts[0].x, pts[0].y, pts[0].z);
    pos.push(pts[i].x, pts[i].y, pts[i].z);
    pos.push(pts[i+1].x, pts[i+1].y, pts[i+1].z);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, mat));
}

window.__geoLoader = { load };
console.log('[loader-geo] Ready');
})();
