import Dexie, { type Table } from 'dexie';

export interface LocalDocument {
  id: string;
  title: string;
  encryptedState: Uint8Array | null;
  teamId: string;
  createdAt: number;
  updatedAt: number;
  folderId?: string;
  isPinned?: boolean;
  isLocked?: boolean;
  lockedBy?: string;
  tags?: string[];
}

export interface LocalTeam {
  teamId: string;
  teamName: string;
  passphraseHash: string;
  teamKey: Uint8Array;
  createdAt: number;
}

export interface LocalFolder {
  id: string;
  name: string;
  teamId: string;
  parentFolderId?: string;
  createdAt: number;
}

export interface DocComment {
  id: string;
  docId: string;
  author: string;
  text: string;
  createdAt: number;
  resolved?: boolean;
}

export interface AuditEntry {
  id: string;
  docId: string;
  teamId: string;
  action: 'create' | 'edit' | 'lock' | 'unlock' | 'pin' | 'unpin' | 'tag' | 'export';
  actor: string;
  timestamp: number;
  details?: Record<string, any>;
}

export interface DocTemplate {
  id: string;
  name: string;
  category: string;
  content: string;
  icon: string;
  description?: string;
}

class VaultDocsDatabase extends Dexie {
  documents!: Table<LocalDocument>;
  teams!: Table<LocalTeam>;
  folders!: Table<LocalFolder>;
  comments!: Table<DocComment>;
  auditLog!: Table<AuditEntry>;
  templates!: Table<DocTemplate>;

  constructor() {
    super('VaultDocsDatabase');
    this.version(1).stores({
      documents: 'id, teamId, updatedAt',
      teams: 'teamId, createdAt'
    });
    this.version(2).stores({
      documents: 'id, teamId, updatedAt, folderId',
      teams: 'teamId, createdAt',
      folders: 'id, teamId, parentFolderId',
      comments: 'id, docId, createdAt',
      auditLog: 'id, docId, teamId, timestamp',
      templates: 'id, category'
    });
  }
}

export const db = new VaultDocsDatabase();

// ─── Document Helpers ──────────────────────────────────────────────────

export async function getLocalDocument(id: string): Promise<LocalDocument | undefined> {
  return db.documents.get(id);
}

export async function saveLocalDocument(doc: LocalDocument): Promise<string> {
  await db.documents.put(doc);
  return doc.id;
}

export async function deleteLocalDocument(id: string): Promise<void> {
  await db.documents.delete(id);
}

export async function listLocalDocuments(teamId?: string): Promise<LocalDocument[]> {
  if (teamId) {
    return db.documents.where('teamId').equals(teamId).reverse().sortBy('updatedAt');
  }
  return db.documents.reverse().sortBy('updatedAt');
}

export async function searchDocuments(query: string, teamId: string): Promise<LocalDocument[]> {
  const allDocs = await listLocalDocuments(teamId);
  const q = query.toLowerCase();
  return allDocs.filter(doc => 
    doc.title.toLowerCase().includes(q) || 
    (doc.tags && doc.tags.some(tag => tag.toLowerCase().includes(q)))
  );
}

export async function togglePin(docId: string, pinned: boolean): Promise<void> {
  const doc = await getLocalDocument(docId);
  if (doc) {
    doc.isPinned = pinned;
    doc.updatedAt = Date.now();
    await saveLocalDocument(doc);
    await logAuditEvent(docId, doc.teamId, pinned ? 'pin' : 'unpin', 'system');
  }
}

export async function toggleLock(docId: string, locked: boolean, actor: string): Promise<void> {
  const doc = await getLocalDocument(docId);
  if (doc) {
    doc.isLocked = locked;
    doc.lockedBy = locked ? actor : undefined;
    doc.updatedAt = Date.now();
    await saveLocalDocument(doc);
    await logAuditEvent(docId, doc.teamId, locked ? 'lock' : 'unlock', actor);
  }
}

export async function addTag(docId: string, tag: string): Promise<void> {
  const doc = await getLocalDocument(docId);
  if (doc) {
    if (!doc.tags) doc.tags = [];
    if (!doc.tags.includes(tag)) {
      doc.tags.push(tag);
      doc.updatedAt = Date.now();
      await saveLocalDocument(doc);
      await logAuditEvent(docId, doc.teamId, 'tag', 'system', { tag });
    }
  }
}

export async function removeTag(docId: string, tag: string): Promise<void> {
  const doc = await getLocalDocument(docId);
  if (doc && doc.tags) {
    doc.tags = doc.tags.filter(t => t !== tag);
    doc.updatedAt = Date.now();
    await saveLocalDocument(doc);
  }
}

// ─── Team Helpers ─────────────────────────────────────────────────────

export async function getLocalTeam(teamId: string): Promise<LocalTeam | undefined> {
  return db.teams.get(teamId);
}

export async function saveLocalTeam(team: LocalTeam): Promise<string> {
  await db.teams.put(team);
  return team.teamId;
}

export async function listLocalTeams(): Promise<LocalTeam[]> {
  return db.teams.toArray();
}

// ─── Folder Helpers ───────────────────────────────────────────────────

export async function saveFolder(folder: LocalFolder): Promise<string> {
  await db.folders.put(folder);
  return folder.id;
}

export async function listFolders(teamId: string): Promise<LocalFolder[]> {
  return db.folders.where('teamId').equals(teamId).toArray();
}

export async function deleteFolder(folderId: string): Promise<void> {
  await db.folders.delete(folderId);
}

// ─── Comment Helpers ──────────────────────────────────────────────────

export async function listComments(docId: string): Promise<DocComment[]> {
  return db.comments.where('docId').equals(docId).toArray();
}

export async function saveComment(comment: DocComment): Promise<string> {
  await db.comments.put(comment);
  return comment.id;
}

export async function resolveComment(commentId: string): Promise<void> {
  const comment = await db.comments.get(commentId);
  if (comment) {
    comment.resolved = true;
    await db.comments.put(comment);
  }
}

export async function deleteComment(commentId: string): Promise<void> {
  await db.comments.delete(commentId);
}

// ─── Audit Log Helpers ────────────────────────────────────────────────

export async function logAuditEvent(
  docId: string,
  teamId: string,
  action: AuditEntry['action'],
  actor: string,
  details?: Record<string, any>
): Promise<void> {
  const entry: AuditEntry = {
    id: 'audit-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
    docId,
    teamId,
    action,
    actor,
    timestamp: Date.now(),
    details
  };
  await db.auditLog.put(entry);
}

export async function getAuditLog(docId: string): Promise<AuditEntry[]> {
  return db.auditLog.where('docId').equals(docId).toArray();
}

export async function listAuditEntries(teamId: string, limit = 100): Promise<AuditEntry[]> {
  return db.auditLog.where('teamId').equals(teamId).reverse().limit(limit).toArray();
}

// ─── Template Helpers ─────────────────────────────────────────────────

export async function listTemplates(): Promise<DocTemplate[]> {
  return db.templates.toArray();
}

export async function saveTemplate(template: DocTemplate): Promise<string> {
  await db.templates.put(template);
  return template.id;
}

// ─── Seed default templates ───────────────────────────────────────────

export async function seedDefaultTemplates(): Promise<void> {
  const existing = await db.templates.count();
  if (existing > 0) return;

  const templates: DocTemplate[] = [
    {
      id: 'tpl-meeting-notes',
      name: 'Meeting Notes',
      category: 'Work',
      icon: '📝',
      content: '# Meeting Notes\n\n## Attendees\n- \n\n## Agenda\n1. \n\n## Discussion\n\n## Action Items\n- '
    },
    {
      id: 'tpl-project-brief',
      name: 'Project Brief',
      category: 'Work',
      icon: '📋',
      content: '# Project Brief\n\n## Objective\n\n## Scope\n\n## Timeline\n\n## Resources\n\n## Risks\n'
    },
    {
      id: 'tpl-sop',
      name: 'Standard Operating Procedure',
      category: 'Work',
      icon: '⚙️',
      content: '# SOP: [Process Name]\n\n## Purpose\n\n## Prerequisites\n\n## Steps\n1. \n\n## Troubleshooting\n'
    },
    {
      id: 'tpl-journal',
      name: 'Daily Journal',
      category: 'Personal',
      icon: '📔',
      content: '# [Date]\n\n## Today\'s Highlights\n\n## What I Learned\n\n## Tomorrow\'s Focus\n'
    },
    {
      id: 'tpl-brainstorm',
      name: 'Brainstorm',
      category: 'Creative',
      icon: '💡',
      content: '# Brainstorm\n\n## Problem Statement\n\n## Ideas\n- \n\n## Next Steps\n'
    }
  ];

  for (const template of templates) {
    await saveTemplate(template);
  }
}
