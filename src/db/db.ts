import Dexie, { type Table } from 'dexie';

export interface LocalDocument {
  id: string;
  title: string;
  encryptedState: Uint8Array | null; // AES-256-GCM encrypted Yjs state update
  teamId: string;
  createdAt: number;
  updatedAt: number;
  // New optional fields
  folderId?: string;
  isPinned?: boolean;
  tags?: string[];
  isLocked?: boolean;
  lockedBy?: string;
}

export interface LocalTeam {
  teamId: string;
  teamName: string;
  passphraseHash: string; // To verify if joining the same team
  teamKey: Uint8Array; // Derived AES key for this team
  createdAt: number;
}

export interface LocalFolder {
  id: string;
  name: string;
  teamId: string;
  createdAt: number;
}

export interface AuditEntry {
  id: string;
  docId: string;
  teamId: string;
  action: string; // 'created' | 'edited' | 'locked' | 'unlocked' | 'deleted' | 'commented' | 'pinned' | 'unpinned' | 'tagged' | 'moved'
  username: string;
  detail?: string;
  timestamp: number;
}

export interface DocComment {
  id: string;
  docId: string;
  teamId: string;
  username: string;
  text: string;
  resolved: boolean;
  createdAt: number;
}

export interface DocTemplate {
  id: string;
  name: string;
  description: string;
  content: string; // HTML string for Tiptap
  category: string;
}

class VaultDocsDatabase extends Dexie {
  documents!: Table<LocalDocument>;
  teams!: Table<LocalTeam>;
  folders!: Table<LocalFolder>;
  auditLog!: Table<AuditEntry>;
  comments!: Table<DocComment>;
  templates!: Table<DocTemplate>;

  constructor() {
    super('VaultDocsDatabase');
    this.version(1).stores({
      documents: 'id, teamId, updatedAt',
      teams: 'teamId, createdAt'
    });
    this.version(2).stores({
      documents: 'id, teamId, updatedAt, folderId, isPinned',
      teams: 'teamId, createdAt',
      folders: 'id, teamId, createdAt',
      auditLog: 'id, docId, teamId, timestamp',
      comments: 'id, docId, resolved, createdAt',
      templates: 'id, category'
    });
  }
}

export const db = new VaultDocsDatabase();

// ─── Document Helpers ──────────────────────────────────────────────────────

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

// ─── Team Helpers ──────────────────────────────────────────────────────────

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

/**
 * Removes a team and all local data associated with it (docs, folders, comments, audit).
 */
export async function leaveTeamAndWipeLocal(teamId: string): Promise<void> {
  const docs = await db.documents.where('teamId').equals(teamId).toArray();
  const docIds = docs.map((d) => d.id);

  await db.documents.where('teamId').equals(teamId).delete();
  await db.folders.where('teamId').equals(teamId).delete();
  await db.auditLog.where('teamId').equals(teamId).delete();
  for (const docId of docIds) {
    await db.comments.where('docId').equals(docId).delete();
  }
  await db.teams.delete(teamId);
}

// ─── Folder Helpers ────────────────────────────────────────────────────────

export async function createFolder(name: string, teamId: string): Promise<LocalFolder> {
  const folder: LocalFolder = {
    id: 'folder-' + Math.random().toString(36).substring(2, 11),
    name,
    teamId,
    createdAt: Date.now()
  };
  await db.folders.put(folder);
  return folder;
}

export async function listFolders(teamId: string): Promise<LocalFolder[]> {
  return db.folders.where('teamId').equals(teamId).sortBy('createdAt');
}

export async function deleteFolder(folderId: string): Promise<void> {
  await db.folders.delete(folderId);
  await db.documents.where('folderId').equals(folderId).modify({ folderId: undefined });
}

// ─── Audit Log Helpers ─────────────────────────────────────────────────────

export async function addAuditEntry(
  docId: string,
  teamId: string,
  action: string,
  username: string,
  detail?: string
): Promise<void> {
  const entry: AuditEntry = {
    id: 'audit-' + Math.random().toString(36).substring(2, 11),
    docId,
    teamId,
    action,
    username,
    detail,
    timestamp: Date.now()
  };
  await db.auditLog.put(entry);
}

export async function listAuditEntries(docId: string): Promise<AuditEntry[]> {
  const entries = await db.auditLog.where('docId').equals(docId).sortBy('timestamp');
  return entries.reverse();
}

// ─── Comment Helpers ───────────────────────────────────────────────────────

export async function saveComment(
  docId: string,
  teamId: string,
  username: string,
  text: string
): Promise<DocComment> {
  const comment: DocComment = {
    id: 'comment-' + Math.random().toString(36).substring(2, 11),
    docId,
    teamId,
    username,
    text,
    resolved: false,
    createdAt: Date.now()
  };
  await db.comments.put(comment);
  return comment;
}

export async function listComments(docId: string): Promise<DocComment[]> {
  return db.comments.where('docId').equals(docId).sortBy('createdAt');
}

export async function resolveComment(commentId: string): Promise<void> {
  await db.comments.update(commentId, { resolved: true });
}

export async function deleteComment(commentId: string): Promise<void> {
  await db.comments.delete(commentId);
}

// ─── Template Helpers ──────────────────────────────────────────────────────

export async function listTemplates(): Promise<DocTemplate[]> {
  return db.templates.toArray();
}

export async function seedDefaultTemplates(): Promise<void> {
  const existing = await db.templates.count();
  if (existing > 0) return;

  const templates: DocTemplate[] = [
    {
      id: 'tpl-meeting',
      name: 'Meeting Notes',
      description: 'Agenda, attendees, and action items',
      category: 'Collaboration',
      content: `<h1>Meeting Notes</h1><h2>Agenda</h2><ul><li>Topic 1</li><li>Topic 2</li><li>Topic 3</li></ul><h2>Attendees</h2><ul><li>Name — Role</li></ul><h2>Discussion</h2><p>Key points from the meeting...</p><h2>Action Items</h2><ul><li>Owner — Task — Due Date</li></ul><h2>Next Meeting</h2><p>Date / time TBD</p>`
    },
    {
      id: 'tpl-project-brief',
      name: 'Project Brief',
      description: 'Overview, goals, timeline, and stakeholders',
      category: 'Planning',
      content: `<h1>Project Brief</h1><h2>Overview</h2><p>A short description of the project and its purpose.</p><h2>Goals</h2><ul><li>Goal 1</li><li>Goal 2</li></ul><h2>Scope</h2><p>What is in scope and out of scope.</p><h2>Timeline</h2><ul><li><strong>Phase 1</strong> — Description — Date</li><li><strong>Phase 2</strong> — Description — Date</li></ul><h2>Stakeholders</h2><ul><li>Name — Role — Responsibility</li></ul><h2>Risks</h2><ul><li>Risk — Mitigation</li></ul>`
    },
    {
      id: 'tpl-sop',
      name: 'Standard Operating Procedure',
      description: 'Purpose, scope, steps, and references',
      category: 'Operations',
      content: `<h1>Standard Operating Procedure</h1><h2>Purpose</h2><p>What this procedure is designed to accomplish.</p><h2>Scope</h2><p>Who this procedure applies to and under what circumstances.</p><h2>Responsibilities</h2><ul><li>Role — Responsibility</li></ul><h2>Procedure</h2><ol><li>Step one</li><li>Step two</li><li>Step three</li></ol><h2>References</h2><ul><li>Reference document or link</li></ul>`
    },
    {
      id: 'tpl-tech-spec',
      name: 'Technical Spec',
      description: 'Summary, architecture, API, and decisions',
      category: 'Engineering',
      content: `<h1>Technical Specification</h1><h2>Summary</h2><p>One-paragraph description of what is being built and why.</p><h2>Background</h2><p>Context and motivation for this change.</p><h2>Architecture</h2><p>High-level design and component breakdown.</p><h2>API Design</h2><ul><li><code>GET /resource</code> — description</li><li><code>POST /resource</code> — description</li></ul><h2>Data Model</h2><p>Key entities and their fields.</p><h2>Decisions &amp; Trade-offs</h2><ul><li>Decision — Rationale</li></ul><h2>Open Questions</h2><ul><li>Question</li></ul>`
    },
    {
      id: 'tpl-weekly-report',
      name: 'Weekly Report',
      description: 'Highlights, blockers, and plans for next week',
      category: 'Reporting',
      content: `<h1>Weekly Report</h1><h2>Week of</h2><p>Date range</p><h2>Highlights</h2><ul><li>What was accomplished this week</li></ul><h2>Metrics</h2><ul><li>Metric — Value — Change</li></ul><h2>Blockers</h2><ul><li>Blocker — Owner — Status</li></ul><h2>Next Week</h2><ul><li>Planned task or goal</li></ul>`
    }
  ];

  await db.templates.bulkPut(templates);
}
