# VaultDocs 🔒

VaultDocs is a zero-knowledge, serverless collaborative workspace MVP. It is designed as a privacy-first alternative to Notion and Google Docs, where **the server never sees your plaintext data**. 

Everything you write is stored locally on your device (offline-first) and synchronized directly with collaborators peer-to-peer (P2P) using WebRTC. All synchronization traffic is encrypted end-to-end (E2EE) inside the browser before touching the network.

---

## 🏗️ Architecture

VaultDocs operates on a decentralized, serverless architecture utilizing three pillars:

```mermaid
graph TD
    subgraph Client A (Browser)
        DocA[Y.Doc]
        DBA[(IndexedDB / Dexie)]
        CryptoA[Crypto Engine]
    end
    subgraph Client B (Browser)
        DocB[Y.Doc]
        DBB[(IndexedDB / Dexie)]
        CryptoB[Crypto Engine]
    end
    Signal[wss://signaling.yjs.dev]
    
    DocA -- Save Encrypted State --> DBA
    DocB -- Save Encrypted State --> DBB
    
    DocA -- Yjs Update --> CryptoA
    CryptoA -- Encrypted AES-256-GCM Blob --> Signal
    Signal -- Relay Encrypted Blob --> CryptoB
    CryptoB -- Decrypted Yjs Update --> DocB
```

### 1. Cryptography Engine (`@noble/ciphers` & Web Crypto)
- **Key Derivation**: When a new team/workspace is created, the app derives a 256-bit symmetric key from your workspace passphrase and a unique team ID using the browser's native **Web Crypto PBKDF2** algorithm with 100,000 iterations.
- **Symmetric Encryption**: Every document state block and individual edit update emitted by the Yjs engine is encrypted locally using **AES-256-GCM** via the `@noble/ciphers` library. A unique, random 12-byte initialization vector (IV/nonce) is generated for every update payload and prepended to the ciphertext.
- **Zero-Knowledge Signaling**: WebRTC SDP negotiations (offers/answers) and ICE connection candidates are fully encrypted using the same team key before being sent to the signaling server. The signaling server is a completely dumb broker; it only routes opaque base64 strings and never sees the metadata or connection structure of the room.

### 2. Local-First Storage (`Dexie.js` & IndexedDB)
- All document updates, workspace keys, and user details are persisted inside the browser's IndexedDB wrapper, **Dexie.js**.
- The database is the single source of truth. When offline, edits are saved directly to Dexie. When online, WebRTC automatically reconciles updates bidirectionally.

### 3. Sync & Conflict Resolution (`Yjs` & WebRTC)
- **CRDT Engine**: Real-time collaborative conflict-free replication is powered by **Yjs**.
- **P2P Transport**: We establish direct WebRTC data channels between browsers using Google's public STUN servers for NAT traversal. A public signaling server (`wss://signaling.yjs.dev`) acts as a secure, blind relay for the initial WebRTC handshake. Once the handshake is complete, direct peer-to-peer data lines sync the documents.

---

## 🛠️ Tech Stack

- **Framework**: React 19 + TypeScript + Vite
- **CRDT**: Yjs
- **Database**: Dexie.js (IndexedDB wrapper)
- **Cryptography**: `@noble/ciphers` (AES-GCM), Browser Web Crypto API (PBKDF2)
- **Sync / Transport**: Native browser WebRTC API + WebSocket Signaling
- **Editor**: TipTap (ProseMirror wrapper) + Yjs Collaboration extensions
- **Icons**: Lucide React
- **Styles**: Vanilla CSS (Linear-style minimal dark mode)

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm

### Installation
1. Clone the repository and navigate to the directory:
   ```bash
   cd VaultDocs
   ```
2. Install dependencies:
   ```bash
   npm install --legacy-peer-deps
   ```
3. Run the development server locally:
   ```bash
   npm run dev
   ```
4. Open the displayed local address (usually `http://localhost:5173`) in your web browser.

---

## 👥 How Collaboration Works (Step-by-Step)

1. **Create Workspace**: Enter your username and choose a workspace name (optionally add a password). This generates your local cryptographic keys.
2. **Write**: Create documents. They will save automatically to your local browser storage.
3. **Share / Invite**:
   - Click the **Share** button in the header.
   - The app generates a secure sharing link containing a **one-time Seitan token** (encrypted representation of the team ID and document key) alongside the connection parameters.
   - Send this link to your teammate.
4. **Join**:
   - The recipient opens the link, enters their username, and accepts the invite.
   - The recipient's browser decrypts the team credentials using the sharing secret inside the link, saves them locally, and initiates WebRTC signaling.
   - Both browsers connect, establish direct E2EE data channels, and sync edits with live cursor awareness!
