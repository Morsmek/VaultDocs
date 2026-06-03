import Dexie, { type Table } from 'dexie';

export interface LocalDocument {
  id: string;
  title: string;
  encryptedState: Uint8Array | null; // AES-256-GCM encrypted Yjs state update
  teamId: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalTeam {
  teamId: string;
  teamName: string;
  passphraseHash: string; // To verify if joining the same team
  teamKey: Uint8Array; // Derived AES key for this team
  createdAt: number;
}

class VaultDocsDatabase extends Dexie {
  documents!: Table<LocalDocument>;
  teams!: Table<LocalTeam>;

  constructor() {
    super('VaultDocsDatabase');
    this.version(1).stores({
      documents: 'id, teamId, updatedAt',
      teams: 'teamId, createdAt'
    });
  }
}

export const db = new VaultDocsDatabase();

// Helper functions for DB access
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
