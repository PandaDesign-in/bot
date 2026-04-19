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
