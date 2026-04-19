# PandaAI 🐼 — Agent Operating Instructions

## MANDATORY: READ THIS BEFORE ANY WORK

This file governs how Claude Code agents must behave in this repository.
**No exceptions. No shortcuts. No sloppy work.**

---

## 1. Session Continuity — CRITICAL

Every conversation session is logged as a raw dump to `/sessions/` in this repo (encrypted).

**Before starting any work session you MUST:**
1. Read `/sessions/index.json` to find the latest session dumps
2. Fetch and read the most recent session files to restore full context
3. Never assume you know the current state — always verify by reading dumps
4. If `/sessions/` is empty or missing, note it and ask the user for context

**During every work session you MUST:**
- Log every user message and your response as-is, verbatim, no edits, no summarisation
- **BEFORE logging, redact all secrets** — replace with `[REDACTED]`:
  - GitHub PATs: `ghp_...` or `github_pat_...`
  - Groq API keys: `gsk_...`
  - Any token, bearer, or API key value
- Flush to `/sessions/` at the end of the session
- Update `/sessions/index.json` with the new session reference

**NEVER log credentials in plaintext, ever — not even in encrypted sessions.**

**Format:** Each session dump is a JSON file:
```json
{
  "session_id": "YYYY-WW-NNN",
  "started": "ISO8601",
  "ended": "ISO8601",
  "persona": "architecture | interior",
  "files_loaded": [],
  "messages": [
    { "role": "user", "content": "...", "ts": "ISO8601" },
    { "role": "assistant", "content": "...", "ts": "ISO8601" }
  ]
}
```

---

## 2. Deep Scan Protocol

Before writing any code, making any edit, or adding any feature:
1. Read ALL relevant source files — never assume file contents
2. Check `/sessions/` for prior context on the same topic
3. Trace all dependencies — never break existing functionality
4. Run a mental simulation of the change before applying it
5. Verify your output is complete — no TODOs, no placeholders, no half-implementations

**This is a zero-tolerance codebase for incomplete work.**

---

## 3. Project — PandaAI

**What it is:** A GitHub-native, client-side PWA for architectural and interior design analysis.
- Vanilla JS, no npm, no build step, no server
- GitHub is the sole backend (encrypted blobs)
- Single user, in-house tool
- Deployed on GitHub Pages (public repo, all sensitive data AES-256-GCM encrypted)

**Owner:** Shivaramakrishnan (architecture) + sister (interior design, Tokyo)

---

## 4. Architecture

```
index.html          ← PWA shell, full UI layout
sw.js               ← Service worker (pre-caches ALL modules on first install)
manifest.json       ← PWA manifest
charmap.json        ← PandaAI persona definitions
modules/
  crypto.js         ← AES-256-GCM + PBKDF2 (always loaded)
  github-sync.js    ← GitHub REST API encrypted R/W (always loaded)
  file-store.js     ← Virtual file tree, vault state
  renderer.js       ← Three.js 3D viewer + controls
  ai-router.js      ← Groq 8B/70B/Whisper routing
  analysis.js       ← Bottom panel AI observations (charmap-driven)
  loaders/
    loader-native.js   ← STL, OBJ, GLTF, FBX, DAE, PLY, PCD, X3D, VRML
    loader-dxf.js      ← DXF (dxf-parser)
    loader-ifc.js      ← IFC (web-ifc WASM)
    loader-step.js     ← STEP/IGES (occt-import-js WASM)
    loader-dwg.js      ← DWG (libredwg WASM)
    loader-3dm.js      ← Rhino 3DM (rhino3dm.js)
    loader-cloud.js    ← LAS/LAZ/E57/XYZ point clouds
    loader-geo.js      ← KML/GeoJSON/DEM
sessions/
  index.json        ← Session index (unencrypted metadata, content is encrypted)
  YYYY-WW-NNN.enc   ← Encrypted session dumps
files/              ← Encrypted uploaded CAD files (GitHub vault)
reports/            ← Encrypted AI analysis reports
```

---

## 5. AI Model Routing

| Task | Model |
|---|---|
| Chat | Groq `llama-3.1-8b-instant` |
| File analysis | Groq `llama-3.3-70b-versatile` |
| Voice input | Groq `whisper-large-v3` |
| Session summary | Groq `llama-3.1-8b-instant` |

Persona driven by `charmap.json` — two modes: `architecture` and `interior`.
Toggle in the bottom bar. 70B reads active persona before every analysis.

---

## 6. File Format Support — ALL REQUIRED, NO EXCEPTIONS

### Group A — Three.js native
STL, OBJ+MTL, GLTF, GLB, FBX, DAE, 3DS, PLY, PCD, X3D, VRML/WRL, VTK, OFF

### Group B — WASM parsers
DXF, IFC, STEP/STP, IGES/IGS, DWG, SAT, 3MF, AMF, SKP, USDZ, 3DM

### Group C — Point clouds
E57, LAS, LAZ, XYZ, PTS, PTX

### Group D — Proprietary (graceful fallback + conversion guide)
RVT, BLEND, MAX, MA/MB, CATPART, SLDPRT, SLDASM, F3D, NWD, C4D, LWO, ZTL

### Group E — Geospatial
KML/KMZ, CityGML, GeoJSON, DEM

---

## 7. Encryption

- Algorithm: AES-256-GCM
- Key derivation: PBKDF2 (SHA-256, 310,000 iterations)
- User passphrase → key, never stored, never leaves browser
- All files and sessions encrypted before any GitHub write
- GitHub PAT stored encrypted in sessionStorage only

---

## 8. Caching Strategy (Tokyo: fast but expensive internet)

Service worker pre-caches ALL modules on first install.
Subsequent sessions: 100% from cache, zero network cost.
Only network calls during a session: Groq API + GitHub sync.
Manual "Check for updates" — user decides when to re-download.

---

## 9. Rules for This Codebase

- Vanilla JS only — no npm, no bundler, no framework
- No placeholders, no TODOs left in committed code
- No half-implemented features
- Always test logic mentally before writing
- Read files before editing them
- Session dumps are sacred — never modify, only append
