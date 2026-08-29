# VaultDocs

VaultDocs is a **local-first, end-to-end encrypted** collaborative document editor. Documents live in your browser (IndexedDB) and sync peer-to-peer over WebRTC. Plaintext document content is never sent to a server.

## Features (working)

- Create encrypted workspaces (team key from passphrase via PBKDF2)
- TipTap rich-text editor with Yjs CRDT collaboration
- Offline-first persistence (Dexie / IndexedDB)
- Invite links with AES-GCM key wrap (PBKDF2-derived wrap key)
- Live cursors / awareness when peers connect
- Document templates, folders, pins, tags, local comments & audit log
- Export Markdown / print-to-PDF
- Multi-workspace switcher; leave team wipes local keys for that team

## Not fully collaborative yet

The document list itself (titles, pins, tags, lock flags, encrypted content state) syncs to all
team members via a team-level room (`vd:{teamId}:workspace`) — new documents appear for online
peers automatically. These features are still **local to each browser** (not synced over P2P):

- Comments, audit log, folders

Lock only disables editing on the device that locked the doc.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build   # production build
npm run preview # serve dist/
```

## Collaboration

1. Create a workspace and a document.
2. Click **Share** → copy the invite link (treat it like a password).
3. Open the link in another browser / device → set a username → accept.
4. When WebRTC connects, both sides sync and show peer presence.

### Networking notes

- Signaling defaults to a self-hosted relay at `/signaling` on the same origin (Cloudflare Durable Object in `worker/index.ts`). It only forwards AES-GCM encrypted blobs. The old public default `wss://signaling.yjs.dev` is dead (DNS record removed).
- STUN only is configured by default. **Many mobile / corporate networks need TURN.**

Optional env (copy `.env.example` → `.env`):

```env
VITE_SIGNALING_URL=wss://your-signaling.example
VITE_TURN_URL=turn:turn.example.com:3478
VITE_TURN_USERNAME=user
VITE_TURN_CREDENTIAL=secret
```

Status bar meanings:

| Label | Meaning |
|-------|---------|
| Offline · local only | No signaling connection |
| Online · waiting for peers | Signaling up, no data channels yet |
| Connecting peers… | WebRTC in progress |
| Synced · N peers | At least one peer fully connected |

## Architecture

```text
Browser A                         Browser B
  Y.Doc  <──encrypted WebRTC──>     Y.Doc
  Dexie (encrypted state)           Dexie
         \                       /
          \  encrypted signal   /
           \>  signaling WS  < /
```

- **Crypto**: Web Crypto PBKDF2 (100k) + AES-256-GCM (`@noble/ciphers`)
- **CRDT**: Yjs
- **Editor**: TipTap 3 + Collaboration + CollaborationCaret
- **Sync**: Custom encrypted WebRTC provider (`src/sync/webrtc-provider.ts`)

Room names are `vd:{teamId}:{docId}` so rooms are not bare document ids.

## Threat model (honest)

**Protected**

- Document content in transit (encrypted updates on data channels and signaling payloads)
- Document content at rest in IndexedDB is stored as ciphertext (encrypted Yjs state)

**Not protected / limitations**

- Workspace keys are stored in IndexedDB in a usable form (no unlock screen yet)
- The invite URL contains everything needed to join — anyone with the link is a full collaborator
- Signaling and room activity can be observed as opaque traffic (metadata)
- Without TURN, connectivity fails on some NATs
- Offline peers cannot receive updates until they meet online (no store-and-forward server)
- Device compromise = full access to local vault

## Stack

- React 19 + TypeScript + Vite
- Yjs, y-protocols
- Dexie
- TipTap
- @noble/ciphers, Lucide, qrcode.react

## Roadmap ideas

High value next steps: encrypted vault backup/restore, keys encrypted at rest, TURN defaults, store-and-forward ciphertext relay, synced metadata (folders/comments), per-document keys, full-text local search, PWA.

## License

Private / as published by the repository owner.
