import * as Y from 'yjs';
import { EncryptedWebrtcProvider, buildRoomName } from './webrtc-provider';
import { bytesToBase64, base64ToBytes } from '../crypto/crypto';
import type { LocalDocument } from '../db/db';

/**
 * Team-level sync: mirrors the workspace's document list (metadata +
 * already-encrypted Yjs state) to all team members over a dedicated P2P room.
 * Plaintext never leaves the device — encryptedState is AES-GCM ciphertext.
 */

export interface WorkspaceDocRecord {
  id: string;
  title: string;
  teamId: string;
  createdAt: number;
  updatedAt: number;
  encryptedState: string | null; // base64 of AES-GCM ciphertext
  folderId?: string;
  isPinned?: boolean;
  tags?: string[];
  isLocked?: boolean;
  lockedBy?: string;
  deleted?: boolean;
}

export function docToRecord(doc: LocalDocument): WorkspaceDocRecord {
  return {
    id: doc.id,
    title: doc.title,
    teamId: doc.teamId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    encryptedState: doc.encryptedState ? bytesToBase64(doc.encryptedState) : null,
    ...(doc.folderId ? { folderId: doc.folderId } : {}),
    ...(doc.isPinned ? { isPinned: true } : {}),
    ...(doc.tags && doc.tags.length > 0 ? { tags: doc.tags } : {}),
    ...(doc.isLocked ? { isLocked: true } : {}),
    ...(doc.lockedBy ? { lockedBy: doc.lockedBy } : {})
  };
}

export function recordToDoc(rec: WorkspaceDocRecord): LocalDocument {
  return {
    id: rec.id,
    title: rec.title,
    teamId: rec.teamId,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    encryptedState: rec.encryptedState ? base64ToBytes(rec.encryptedState) : null,
    ...(rec.folderId ? { folderId: rec.folderId } : {}),
    ...(rec.isPinned ? { isPinned: true } : {}),
    ...(rec.tags ? { tags: rec.tags } : {}),
    ...(rec.isLocked ? { isLocked: true } : {}),
    ...(rec.lockedBy ? { lockedBy: rec.lockedBy } : {})
  };
}

export class WorkspaceSync {
  private ydoc = new Y.Doc();
  private provider: EncryptedWebrtcProvider;
  private map: Y.Map<string>;
  private remoteTimer: ReturnType<typeof setTimeout> | null = null;
  private onRemoteRecords: (records: WorkspaceDocRecord[]) => void;

  constructor(
    teamId: string,
    teamKey: Uint8Array,
    username: string,
    onRemoteRecords: (records: WorkspaceDocRecord[]) => void
  ) {
    this.onRemoteRecords = onRemoteRecords;
    this.map = this.ydoc.getMap('documents');
    this.provider = new EncryptedWebrtcProvider(
      this.ydoc,
      buildRoomName(teamId, 'workspace'),
      teamKey,
      username
    );

    this.ydoc.on('update', (_update, origin) => {
      // Only react to records applied from remote peers, not our own writes.
      if (origin !== this.provider) return;
      if (this.remoteTimer) clearTimeout(this.remoteTimer);
      this.remoteTimer = setTimeout(() => {
        this.remoteTimer = null;
        const records: WorkspaceDocRecord[] = [];
        this.map.forEach((json) => {
          try {
            records.push(JSON.parse(json));
          } catch {
            // ignore malformed entry
          }
        });
        this.onRemoteRecords(records);
      }, 300);
    });
  }

  /**
   * Push local documents into the shared map. A record is only written when
   * it is newer than (or same-age but different from) the shared copy, so a
   * peer rejoining with stale data cannot clobber newer records.
   */
  pushDocuments(docs: LocalDocument[]) {
    for (const doc of docs) {
      const rec = docToRecord(doc);
      const json = JSON.stringify(rec);
      const existingRaw = this.map.get(doc.id);
      if (existingRaw) {
        if (existingRaw === json) continue;
        try {
          const existing = JSON.parse(existingRaw) as WorkspaceDocRecord;
          if (existing.updatedAt > rec.updatedAt) continue;
        } catch {
          // overwrite malformed entry
        }
      }
      this.map.set(doc.id, json);
    }
  }

  /** Tombstone a document so deletions propagate to peers. */
  pushDelete(docId: string) {
    let rec: WorkspaceDocRecord = {
      id: docId,
      title: '',
      teamId: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      encryptedState: null
    };
    const existingRaw = this.map.get(docId);
    if (existingRaw) {
      try {
        rec = JSON.parse(existingRaw) as WorkspaceDocRecord;
      } catch {
        // keep default
      }
    }
    rec.deleted = true;
    rec.updatedAt = Date.now();
    rec.encryptedState = null;
    this.map.set(docId, JSON.stringify(rec));
  }

  destroy() {
    if (this.remoteTimer) clearTimeout(this.remoteTimer);
    this.provider.destroy();
    this.ydoc.destroy();
  }
}
