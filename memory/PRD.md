# VaultDocs — Product Requirements

## Original Problem Statement
Build VaultDocs app.

## User Choices (clarified)
- Core purpose: Secure document storage & sharing
- Auth: None — zero-knowledge, local collaboration via browser
- First features: Folders/categories & search, file upload/download
- Design: Clean & minimal
- File limits/integrations: defaults

## What It Is
A zero-knowledge, peer-to-peer collaborative rich-text document workspace.
All data lives in the browser (IndexedDB via Dexie), encrypted client-side with
AES-256-GCM. Collaboration is via WebRTC + a public Yjs signaling server
(configurable via VITE_SIGNALING_URL). Plaintext never reaches any server.

## Tech Stack (existing, pre-built codebase)
- Vite + React 19 + TypeScript (NOT the FastAPI/Mongo stack)
- Yjs + y-protocols (CRDT), TipTap editor, @noble/ciphers (AES-GCM), Dexie (IndexedDB), qrcode.react
- Frontend served on :3000 via supervisor (`yarn start` -> vite). Minimal FastAPI health stub at /app/backend (:8001), unused by the app.

## Architecture / Layout
- /app/frontend — the Vite app (moved here to fit platform supervisor config)
- /app/frontend/src/App.tsx — root: setup screen + workspace shell + doc/provider lifecycle
- /app/frontend/src/crypto/crypto.ts — PBKDF2 key derivation, AES-GCM encrypt/decrypt, invite tokens
- /app/frontend/src/db/db.ts — Dexie schema (documents, teams, folders, auditLog, comments, templates)
- /app/frontend/src/sync/webrtc-provider.ts — encrypted WebRTC provider (E2EE signaling + data channels)
- /app/frontend/src/components/ — Sidebar, Editor, FolderTree, SearchBar, CommentsPanel, TemplatesModal, AuditLogModal, ExportMenu, InviteModal

## Implemented (verified 2026-06 via testing agent, 100% functional flows pass)
- Create/open encrypted workspace (team) with optional passphrase
- Rich-text collaborative editor (TipTap + Yjs), title editing
- Document CRUD, pin, lock (local), tags, folders, search filter
- Templates (Meeting Notes, Project Brief, SOP, Tech Spec, Weekly Report)
- Audit log, comments (add/resolve/delete), export (PDF via print, Markdown)
- Share via encrypted invite link + QR code
- IndexedDB persistence across reloads; mobile responsive sidebar

## Fixes applied this session
- Restructured app into /app/frontend; vite config for :3000, host, HMR over wss
- Added minimal backend health stub so pod is healthy
- Added all missing CSS for newer components (comments panel, templates grid, audit timeline, folder tree, search bar, tags, context menu, export dropdown, lock banner)
- Pinned status bar footer to viewport bottom; vertically centered setup card
- Fixed React setState-during-render warning (useCallback + queueMicrotask on title sync)
- Fixed FolderTree "No results found" empty state when folders exist

## Known Notes
- WebRTC peer sync needs a reachable signaling server. Default wss://signaling.yjs.dev
  does not resolve in the preview sandbox (shows "Signaling offline" — expected);
  app degrades gracefully to local-only. Configurable via frontend/.env VITE_SIGNALING_URL.
- Document lock is local-only (not synced to peers) — by design for MVP.

## Backlog / Next
- P1: File upload/download of binary attachments (currently rich-text only)
- P1: Self-hosted / reliable signaling server for real cross-device sync
- P2: Add data-testid attributes across components for automation
- P2: Sync lock state to peers; per-document passphrases
