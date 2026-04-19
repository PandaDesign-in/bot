# bot

# AI Architecture Workbench (AAW) — v2.0

## Overview

AI Architecture Workbench (AAW) is a **GitHub-native, client-driven AI system** designed for architectural workflows. It enables end-to-end assistance across:

- Knowledge retrieval (codes, standards, materials)
- Conversational design reasoning
- CAD and parametric generation
- Functional code outputs
- Speech-to-text and transcript logging

The system is built with a **strict security-first and GitHub-only persistence model**, ensuring that all data is encrypted and version-controlled.

---

## Core Philosophy

- **GitHub as the only persistent layer**
- **Client-side encryption (AES-256-GCM) before any storage**
- **No external databases or storage systems**
- **Deterministic session reconstruction from commit history**
- **Modular and extensible architecture**

---

## Key Features

### 1. GitHub-Native Persistence
- All sessions, outputs, and logs are stored as encrypted files in the repository
- Version-controlled and fully auditable
- Weekly partitioned session storage

---

### 2. Strong Cryptographic Security
- AES-256-GCM encryption
- Client-side key derivation (PBKDF2)
- No plaintext leaves the browser
- No server-side decryption

---

### 3. AI Orchestration Layer
- Multi-model routing:
  - Lightweight → 8B models
  - Complex reasoning → 70B models
  - Speech → Whisper
- Configurable model registry
- Persona-driven behavior (`charmap.json`)

---

### 4. Continuous Session Logging
- Automatic flush every **60 seconds**
- Append-only architecture
- Weekly indexed storage (`YYYY-WW`)
- Fully reproducible interaction history

---

### 5. CAD + Functional Generation
- Parametric design outputs
- Support for:
  - SVG
  - DXF
  - JSON layouts
- Plugin-based generator system

---

### 6. Knowledge System
- Local file-based corpus (`/knowledge`)
- Expandable domain-specific datasets
- Optional client-side indexing and retrieval

---

### 7. Speech Integration
- Speech-to-text via Whisper
- Transcript logging
- Stored as encrypted session artifacts

---

### 8. Progressive Web App (PWA)
- Offline-capable interface
- Deferred GitHub synchronization
- Cached knowledge access

---

## Repository Structure
/aaw-root
│
├── /app
│ ├── index.html
│ ├── app.js
│ ├── runtime/
│ ├── crypto/
│ ├── ai/
│ ├── cad/
│ ├── speech/
│ ├── github/
│ └── ui/
│
├── /sessions
│ └── /YYYY-WW/
│
├── /knowledge
│
├── /plugins
│
├── /config
│
└── /docs


---

## Authentication

- Uses **GitHub Personal Access Token (PAT)**
- Stored client-side only
- Recommended scopes:
  - `repo`
  - `contents:write`

---

## Encryption Model

- Algorithm: **AES-256-GCM**
- Key derivation: PBKDF2
- Encryption occurs:
  - Before GitHub push
  - Within browser runtime only

---

## Session Logging Format

Each session is stored as an encrypted JSON object:

```json
{
  "session_id": "uuid",
  "start_time": "ISO8601",
  "messages": [],
  "artifacts": {},
  "speech": {}
}
GitHub Sync Model
Interval: every 60 seconds
Batched commits
Append-only updates
Weekly folder structure

Commit format:

[AUTOLOG] session <id> update <timestamp>
AI Model Configuration

/app/ai/models.json

{
  "default": "groq-8b",
  "heavy": "groq-70b",
  "speech": "whisper"
}
Persona Configuration

/app/ai/charmap.json

Defines system behavior, capabilities, and tone.

Security Model
Layer	Mechanism
Encryption	AES-256-GCM
Key Derivation	PBKDF2
Transport	HTTPS
Storage	Encrypted blobs
Access	GitHub PAT
Hard Constraints
No plaintext storage outside runtime
No external database
No server-side decryption
GitHub is the only persistence layer
Extensibility

AAW is designed to scale across:

AI
Add new model adapters
Local LLM integration (GGUF)
CAD
Plugin-based generators
BIM integrations (future)
Knowledge
Expandable datasets
Indexed retrieval systems
Collaboration
Future encrypted multi-user workflows
Development Targets

AI agents (Codex, etc.) should be able to:

Scaffold repository structure
Implement encryption module
Build GitHub sync system
Implement AI orchestration
Create UI (chat + CAD preview)
Add session logging engine
Enable plugin architecture
Future Roadmap
Local GPU inference support
Parametric BIM pipelines
Autonomous design agents
Continuous learning from session logs
License

Define based on deployment preference (recommended: MIT / Apache 2.0 for flexibility)

Notes

This system is intentionally designed to:

Maximize data control
Ensure auditability
Enable reproducible AI-assisted workflows

No component should violate the core constraint of GitHub-only encrypted persistence.
