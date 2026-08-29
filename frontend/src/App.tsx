import { useEffect, useState, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { 
  Wifi, 
  WifiOff, 
  Share2, 
  ShieldCheck,
  UserPlus,
  Lock,
  Unlock,
  ClipboardList,
  MessageSquare,
  MessageCircle,
  Moon,
  Sun,
  Menu,
  X,
  Loader2
} from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { InviteModal } from './components/InviteModal';
import { CommentsPanel } from './components/CommentsPanel';
import { ChatPanel } from './components/ChatPanel';
import { AuditLogModal } from './components/AuditLogModal';
import { TemplatesModal } from './components/TemplatesModal';
import { ExportMenu } from './components/ExportMenu';
import { 
  db, 
  listLocalDocuments, 
  listLocalTeams, 
  saveLocalDocument, 
  saveLocalTeam, 
  deleteLocalDocument,
  createFolder,
  listFolders,
  deleteFolder,
  addAuditEntry,
  seedDefaultTemplates,
  leaveTeamAndWipeLocal
} from './db/db';
import type { LocalDocument, LocalTeam, LocalFolder, DocTemplate } from './db/db';
import { 
  deriveKey, 
  encryptUpdate, 
  decryptUpdate, 
  generateRandomPassphrase, 
  parseInviteToken 
} from './crypto/crypto';
import { EncryptedWebrtcProvider, buildRoomName } from './sync/webrtc-provider';
import type { ProviderStatus, PeerUser } from './sync/webrtc-provider';
import { WorkspaceSync, recordToDoc, docToRecord } from './sync/workspace-sync';
import type { WorkspaceDocRecord } from './sync/workspace-sync';

const DEFAULT_STATUS: ProviderStatus = {
  connected: false,
  synced: true,
  peerCount: 0,
  activePeers: [],
  phase: 'offline'
};

function App() {
  const [username, setUsername] = useState(() => localStorage.getItem('vaultdocs_username') || '');
  const [activeTeam, setActiveTeam] = useState<LocalTeam | null>(null);
  const [teams, setTeams] = useState<LocalTeam[]>([]);
  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [folders, setFolders] = useState<LocalFolder[]>([]);
  
  const [currentYDoc, setCurrentYDoc] = useState<Y.Doc | null>(null);
  const [currentProvider, setCurrentProvider] = useState<EncryptedWebrtcProvider | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>(DEFAULT_STATUS);
  const [peerUsers, setPeerUsers] = useState<PeerUser[]>([]);

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('vaultdocs_theme') === 'dark' ? 'dark' : 'light'
  );
  
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamPassphrase, setNewTeamPassphrase] = useState('');
  const [setupMode, setSetupMode] = useState<'create' | 'join' | 'select' | null>(null);

  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteSecret, setInviteSecret] = useState<string | null>(null);
  const [inviteDetails, setInviteDetails] = useState<{ docTitle: string; teamId: string } | null>(null);

  const activeDocIdRef = useRef<string | null>(null);
  const providerRef = useRef<EncryptedWebrtcProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const wsSyncRef = useRef<WorkspaceSync | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const toggleTheme = () => {
    setTheme(current => {
      const next = current === 'light' ? 'dark' : 'light';
      localStorage.setItem('vaultdocs_theme', next);
      return next;
    });
  };

  const refreshDocs = async (teamId: string) => {
    const docs = await listLocalDocuments(teamId);
    setDocuments(docs);
    wsSyncRef.current?.pushDocuments(docs);
    return docs;
  };

  const refreshFolders = async (teamId: string) => {
    const f = await listFolders(teamId);
    setFolders(f);
  };

  // ─── 1. Parse URL hashes for invite tokens ───────────────────────────────

  useEffect(() => {
    const parseHash = async () => {
      const hash = window.location.hash;
      if (hash.startsWith('#/invite')) {
        const q = hash.indexOf('?');
        if (q < 0) return;
        const urlParams = new URLSearchParams(hash.substring(q));
        const token = urlParams.get('token');
        const secret = urlParams.get('secret');
        if (token && secret) {
          try {
            const parsed = await parseInviteToken(token, secret);
            setInviteToken(token);
            setInviteSecret(secret);
            setInviteDetails({ docTitle: parsed.docTitle, teamId: parsed.teamId });
            setSetupMode('join');
          } catch {
            showToast('Invalid or corrupted invite token');
          }
        }
      }
    };
    const onHashChange = () => { void parseHash(); };
    void parseHash();
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [showToast]);

  // ─── 2. Load teams & seed templates on mount ─────────────────────────────

  useEffect(() => {
    const loadTeams = async () => {
      if (!localStorage.getItem('vaultdocs_db_clean_v2')) {
        await db.documents.clear();
        localStorage.setItem('vaultdocs_db_clean_v2', 'true');
      }
      await seedDefaultTemplates();

      const allTeams = await listLocalTeams();
      setTeams(allTeams);
      const lastTeamId = localStorage.getItem('vaultdocs_last_team');
      const foundTeam = allTeams.find(t => t.teamId === lastTeamId) || allTeams[0];
      if (foundTeam) {
        setActiveTeam(foundTeam);
        localStorage.setItem('vaultdocs_last_team', foundTeam.teamId);
      } else {
        // Functional update: parseHash may have set 'join' while teams were
        // still loading — a stale inviteToken closure must not clobber it.
        setSetupMode(prev => prev ?? 'create');
      }
    };
    loadTeams();
  }, [inviteToken]);

  // ─── 3. Load docs + folders when team changes ────────────────────────────

  useEffect(() => {
    if (!activeTeam) {
      setDocuments([]);
      setFolders([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const docs = await listLocalDocuments(activeTeam.teamId);
      if (cancelled) return;
      setDocuments(docs);
      await refreshFolders(activeTeam.teamId);
      if (docs.length > 0) {
        if (!currentDocId || !docs.some(d => d.id === currentDocId)) {
          await handleSelectDoc(docs[0].id, activeTeam);
        }
      } else {
        await handleCreateDoc('Welcome to VaultDocs', undefined, activeTeam);
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeam?.teamId]);

  // ─── 3b. Workspace-level sync (document list mirroring) ──────────────────

  const mergeRemoteRecords = useCallback(async (teamId: string, records: WorkspaceDocRecord[]) => {
    const localFolders = await listFolders(teamId);
    const folderIds = new Set(localFolders.map(f => f.id));
    let changed = false;

    for (const rec of records) {
      const local = await db.documents.get(rec.id);
      if (rec.deleted) {
        if (local && rec.updatedAt >= local.updatedAt) {
          await deleteLocalDocument(rec.id);
          changed = true;
        }
        continue;
      }
      const differs = local
        ? rec.updatedAt > local.updatedAt ||
          (rec.updatedAt === local.updatedAt &&
            JSON.stringify(rec) !== JSON.stringify(docToRecord(local)))
        : true;
      if (!differs) continue;

      const doc = recordToDoc(rec);
      // Folders are local-only for now; drop dangling references.
      if (doc.folderId && !folderIds.has(doc.folderId)) delete doc.folderId;
      await saveLocalDocument(doc);
      changed = true;
    }

    if (changed) {
      const docs = await listLocalDocuments(teamId);
      setDocuments(docs);
    }
  }, []);

  useEffect(() => {
    if (!activeTeam) return;
    const team = activeTeam;
    const sync = new WorkspaceSync(team.teamId, team.teamKey, username || 'Anonymous', (records) => {
      void mergeRemoteRecords(team.teamId, records);
    });
    wsSyncRef.current = sync;
    // Push whatever we already have so rejoining peers converge.
    void listLocalDocuments(team.teamId).then(docs => sync.pushDocuments(docs));
    return () => {
      if (wsSyncRef.current === sync) wsSyncRef.current = null;
      sync.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeam?.teamId]);

  // ─── 4. Provider cleanup ────────────────────────────────────────────────

  const cleanupProvider = useCallback(() => {
    if (providerRef.current) {
      providerRef.current.destroy();
      providerRef.current = null;
    }
    if (ydocRef.current) {
      ydocRef.current.destroy();
      ydocRef.current = null;
    }
    setCurrentProvider(null);
    setCurrentYDoc(null);
    setProviderStatus(DEFAULT_STATUS);
    setPeerUsers([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => cleanupProvider(), [cleanupProvider]);

  // ─── 5. Select doc ──────────────────────────────────────────────────────

  const handleSelectDoc = async (docId: string, teamOverride?: LocalTeam) => {
    const team = teamOverride || activeTeam;
    if (!team) return;
    activeDocIdRef.current = docId;
    cleanupProvider();
    setCurrentDocId(docId);
    setIsCommentsOpen(false);
    setIsChatOpen(false);
    setIsAuditOpen(false);

    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    setCurrentYDoc(ydoc);

    const localDoc = await db.documents.get(docId);
    if (activeDocIdRef.current !== docId) {
      ydoc.destroy();
      return;
    }

    if (localDoc?.encryptedState) {
      try {
        const decryptedState = decryptUpdate(localDoc.encryptedState, team.teamKey);
        Y.applyUpdate(ydoc, decryptedState);
      } catch {
        showToast('Error decrypting document. Incorrect cryptographic keys.');
      }
    }

    ydoc.on('update', async (_update, origin) => {
      if (activeDocIdRef.current !== docId) return;
      if (origin === providerRef.current) return;
      const state = Y.encodeStateAsUpdate(ydoc);
      const encrypted = encryptUpdate(state, team.teamKey);
      await db.documents.update(docId, { encryptedState: encrypted, updatedAt: Date.now() });
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, updatedAt: Date.now() } : d));
    });

    const roomName = buildRoomName(team.teamId, docId);
    const provider = new EncryptedWebrtcProvider(ydoc, roomName, team.teamKey, username || 'Anonymous');
    providerRef.current = provider;
    setCurrentProvider(provider);
    provider.onStatus((status) => {
      if (providerRef.current === provider) setProviderStatus(status);
    });
    provider.onPeerUsers((users) => {
      if (providerRef.current === provider) setPeerUsers(users);
    });
  };

  // ─── 6. Create doc ──────────────────────────────────────────────────────

  const handleCreateDoc = async (
    initialTitle = 'Untitled Document',
    templateContent?: string,
    teamOverride?: LocalTeam
  ) => {
    const team = teamOverride || activeTeam;
    if (!team) return;
    const docId = 'doc-' + Math.random().toString(36).substring(2, 11);

    const tempYDoc = new Y.Doc();
    const ytitle = tempYDoc.getText('title');
    ytitle.insert(0, initialTitle);
    const state = Y.encodeStateAsUpdate(tempYDoc);
    const encrypted = encryptUpdate(state, team.teamKey);
    tempYDoc.destroy();

    const newDoc: LocalDocument = {
      id: docId,
      title: initialTitle,
      encryptedState: encrypted,
      teamId: team.teamId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await saveLocalDocument(newDoc);
    await addAuditEntry(docId, team.teamId, 'created', username || 'Anonymous', initialTitle);
    await refreshDocs(team.teamId);

    if (templateContent) {
      sessionStorage.setItem('vaultdocs_template_content', templateContent);
    }

    await handleSelectDoc(docId, team);
  };

  // ─── 7. Delete doc ──────────────────────────────────────────────────────

  const handleDeleteDoc = async (docId: string) => {
    if (!activeTeam) return;

    await addAuditEntry(docId, activeTeam.teamId, 'deleted', username || 'Anonymous');
    await deleteLocalDocument(docId);
    wsSyncRef.current?.pushDelete(docId);
    const docs = await refreshDocs(activeTeam.teamId);
    if (currentDocId === docId) {
      cleanupProvider();
      setCurrentDocId(null);
      if (docs.length > 0) await handleSelectDoc(docs[0].id);
    }
  };

  // ─── 8. Title change ────────────────────────────────────────────────────

  const handleTitleChange = useCallback(async (newTitle: string) => {
    if (!currentDocId) return;
    await db.documents.update(currentDocId, { title: newTitle, updatedAt: Date.now() });
    setDocuments(prev => prev.map(d => d.id === currentDocId ? { ...d, title: newTitle, updatedAt: Date.now() } : d));
    const doc = await db.documents.get(currentDocId);
    if (doc) wsSyncRef.current?.pushDocuments([doc]);
  }, [currentDocId]);

  // ─── 9. Folder management ───────────────────────────────────────────────

  const handleCreateFolder = async (name: string) => {
    if (!activeTeam) return;
    await createFolder(name, activeTeam.teamId);
    await refreshFolders(activeTeam.teamId);
    showToast(`Folder "${name}" created`);
  };

  const handleDeleteFolder = async (folderId: string) => {
    await deleteFolder(folderId);
    if (activeTeam) await refreshFolders(activeTeam.teamId);
  };

  const handleMoveDoc = async (docId: string, folderId: string | undefined) => {
    await db.documents.update(docId, { folderId });
    if (activeTeam) {
      await refreshDocs(activeTeam.teamId);
      const folderName = folderId ? folders.find(f => f.id === folderId)?.name : 'All Documents';
      await addAuditEntry(docId, activeTeam.teamId, 'moved', username || 'Anonymous', `to ${folderName}`);
    }
  };

  // ─── 10. Pin / Lock ─────────────────────────────────────────────────────

  const handleTogglePin = async (docId: string) => {
    const doc = documents.find(d => d.id === docId);
    if (!doc || !activeTeam) return;
    const newPinned = !doc.isPinned;
    await db.documents.update(docId, { isPinned: newPinned });
    await addAuditEntry(docId, activeTeam.teamId, newPinned ? 'pinned' : 'unpinned', username || 'Anonymous');
    await refreshDocs(activeTeam.teamId);
    showToast(newPinned ? 'Document pinned' : 'Document unpinned');
  };

  const handleToggleLock = async (docId: string) => {
    const doc = documents.find(d => d.id === docId);
    if (!doc || !activeTeam) return;
    const newLocked = !doc.isLocked;
    await db.documents.update(docId, { isLocked: newLocked, lockedBy: newLocked ? (username || 'Anonymous') : undefined });
    await addAuditEntry(docId, activeTeam.teamId, newLocked ? 'locked' : 'unlocked', username || 'Anonymous');
    await refreshDocs(activeTeam.teamId);
    showToast(
      newLocked
        ? 'Document locked on this device (not synced to peers yet)'
        : 'Document unlocked'
    );
  };

  // ─── 11. Tags ───────────────────────────────────────────────────────────

  const handleAddTag = async (docId: string, tag: string) => {
    const doc = documents.find(d => d.id === docId);
    if (!doc || !activeTeam) return;
    const existing = doc.tags || [];
    if (existing.includes(tag)) return;
    const tags = [...existing, tag];
    await db.documents.update(docId, { tags });
    await addAuditEntry(docId, activeTeam.teamId, 'tagged', username || 'Anonymous', tag);
    await refreshDocs(activeTeam.teamId);
  };

  const handleRemoveTag = async (docId: string, tag: string) => {
    const doc = documents.find(d => d.id === docId);
    if (!doc) return;
    const tags = (doc.tags || []).filter(t => t !== tag);
    await db.documents.update(docId, { tags });
    if (activeTeam) await refreshDocs(activeTeam.teamId);
  };

  // ─── 12. Templates ──────────────────────────────────────────────────────

  const handleSelectTemplate = async (template: DocTemplate) => {
    setIsTemplatesOpen(false);
    await handleCreateDoc(template.name, template.content);
  };

  // ─── 13. Comment added audit ────────────────────────────────────────────

  const handleCommentAdded = async () => {
    if (!currentDocId || !activeTeam) return;
    await addAuditEntry(currentDocId, activeTeam.teamId, 'commented', username || 'Anonymous');
  };

  // ─── 14. Create Team ────────────────────────────────────────────────────

  const handleCreateTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !newTeamName.trim()) {
      showToast('Username and Team Name are required');
      return;
    }
    localStorage.setItem('vaultdocs_username', username.trim());
    const pass = newTeamPassphrase.trim() || generateRandomPassphrase();
    const teamId = 'team-' + Math.random().toString(36).substring(2, 11);
    const teamKey = await deriveKey(pass, teamId);
    const team: LocalTeam = {
      teamId,
      teamName: newTeamName.trim(),
      passphraseHash: pass,
      teamKey,
      createdAt: Date.now()
    };
    await saveLocalTeam(team);
    const allTeams = await listLocalTeams();
    setTeams(allTeams);
    setActiveTeam(team);
    localStorage.setItem('vaultdocs_last_team', team.teamId);
    setSetupMode(null);
    setNewTeamName('');
    setNewTeamPassphrase('');
    showToast(`Team "${team.teamName}" created successfully!`);
  };

  // ─── 15. Join Team ──────────────────────────────────────────────────────

  const handleJoinTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !inviteToken || !inviteSecret) {
      showToast('Username is required');
      return;
    }
    try {
      localStorage.setItem('vaultdocs_username', username.trim());
      const parsed = await parseInviteToken(inviteToken, inviteSecret);
      const team: LocalTeam = {
        teamId: parsed.teamId,
        teamName: `Shared Team (${parsed.teamId.substring(5, 9)})`,
        passphraseHash: inviteSecret,
        teamKey: parsed.teamKey,
        createdAt: Date.now()
      };
      await saveLocalTeam(team);
      const doc: LocalDocument = {
        id: parsed.docId,
        title: parsed.docTitle,
        encryptedState: null,
        teamId: parsed.teamId,
        // Placeholder timestamps: the real record arrives via workspace sync
        // and must win over this stub (never push a null-state record over it).
        createdAt: 0,
        updatedAt: 0
      };
      await saveLocalDocument(doc);
      const allTeams = await listLocalTeams();
      setTeams(allTeams);
      setActiveTeam(team);
      localStorage.setItem('vaultdocs_last_team', team.teamId);
      setInviteToken(null);
      setInviteSecret(null);
      setInviteDetails(null);
      setSetupMode(null);
      window.location.hash = '';
      await handleSelectDoc(parsed.docId, team);
      showToast('Joined team successfully!');
    } catch {
      showToast('Failed to join team: invite decryption failed.');
    }
  };

  // ─── 16. Leave / switch team ────────────────────────────────────────────

  const handleLeaveTeam = async () => {
    if (!activeTeam) return;
    if (!confirm('Leave this workspace? Local E2EE keys and documents for this team will be deleted from this browser.')) {
      return;
    }
    const teamId = activeTeam.teamId;
    cleanupProvider();
    setCurrentDocId(null);
    await leaveTeamAndWipeLocal(teamId);
    const allTeams = await listLocalTeams();
    setTeams(allTeams);
    if (allTeams.length > 0) {
      setActiveTeam(allTeams[0]);
      localStorage.setItem('vaultdocs_last_team', allTeams[0].teamId);
      setSetupMode(null);
    } else {
      setActiveTeam(null);
      localStorage.removeItem('vaultdocs_last_team');
      setSetupMode('create');
    }
    showToast('Left workspace');
  };

  const handleSwitchTeam = (teamId: string) => {
    const team = teams.find(t => t.teamId === teamId);
    if (!team || team.teamId === activeTeam?.teamId) return;
    cleanupProvider();
    setCurrentDocId(null);
    setActiveTeam(team);
    localStorage.setItem('vaultdocs_last_team', team.teamId);
    setSetupMode(null);
  };

  // ─── Derived state ───────────────────────────────────────────────────────

  const activePeersList = peerUsers.map(p => ({
    id: p.peerId,
    name: p.name,
    color: p.color,
    online: true
  }));

  const currentDoc = documents.find(d => d.id === currentDocId);
  const currentDocTags = currentDoc?.tags || [];

  const statusLabel = (() => {
    if (providerStatus.lastError && !providerStatus.connected) {
      return { text: 'Signaling offline', className: 'warning', icon: 'off' as const };
    }
    if (providerStatus.phase === 'synced' && providerStatus.peerCount > 0) {
      return { text: `Synced · ${providerStatus.peerCount} peer${providerStatus.peerCount === 1 ? '' : 's'}`, className: 'success', icon: 'on' as const };
    }
    if (providerStatus.peerCount > 0) {
      return { text: `Connecting peers… (${providerStatus.peerCount})`, className: 'warning', icon: 'load' as const };
    }
    if (providerStatus.connected) {
      return { text: 'Online · waiting for peers', className: 'success', icon: 'on' as const };
    }
    return { text: 'Offline · local only', className: 'warning', icon: 'off' as const };
  })();

  // ─── Setup Screen ───────────────────────────────────────────────────────

  if (setupMode || !activeTeam) {
    return (
      <div className={`setup-screen theme-${theme}`}>
        <button className="theme-toggle setup-theme-toggle" onClick={toggleTheme} type="button" title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
        </button>
        <div className="setup-card">
          <div className="setup-logo">
            <img src="/logo.png" alt="VaultDocs" className="logo-dark" style={{ height: '48px', width: 'auto' }} />
            <img src="/logo-light.png" alt="VaultDocs" className="logo-light" style={{ height: '48px', width: 'auto' }} />
          </div>
          <h2 className="setup-title">VaultDocs Setup</h2>
          <p className="setup-description">
            Zero-knowledge, peer-to-peer collaborative documents. Plaintext never touches a server.
          </p>

          {teams.length > 0 && setupMode !== 'join' && (
            <div style={{ marginBottom: '20px' }}>
              <label className="form-label">Open existing workspace</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {teams.map(t => (
                  <button
                    key={t.teamId}
                    type="button"
                    className="btn-secondary"
                    style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                    onClick={() => handleSwitchTeam(t.teamId)}
                  >
                    {t.teamName}
                  </button>
                ))}
              </div>
              <div style={{ margin: '16px 0', borderTop: '1px solid var(--border-color)' }} />
              <p className="form-label" style={{ marginBottom: '8px' }}>Or create a new workspace</p>
            </div>
          )}

          <form onSubmit={setupMode === 'join' ? handleJoinTeamSubmit : handleCreateTeamSubmit} className="setup-form">
            <div className="form-group">
              <label className="form-label">Your Username</label>
              <input
                type="text"
                placeholder="e.g. Alice"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="form-input"
                required
              />
            </div>

            {setupMode === 'join' && inviteDetails ? (
              <div style={{ marginTop: '10px' }}>
                <div style={{ padding: '12px', backgroundColor: 'var(--accent-light)', border: '1px solid rgba(0,102,255,0.2)', borderRadius: '8px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 600, color: 'var(--accent-color)', display: 'block', marginBottom: '4px' }}>Invitation Details</span>
                  <p style={{ fontSize: '13px', fontWeight: 600 }}>Joining: {inviteDetails.docTitle || 'Untitled'}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Team ID: {inviteDetails.teamId}</p>
                </div>
                <button type="submit" className="btn-submit">
                  <UserPlus size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                  Accept Invite &amp; Sync
                </button>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label">Team Workspace Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Marketing Team"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Workspace Password (Optional)</label>
                  <input
                    type="password"
                    placeholder="Leave blank to generate secure key"
                    value={newTeamPassphrase}
                    onChange={(e) => setNewTeamPassphrase(e.target.value)}
                    className="form-input"
                  />
                </div>
                <button type="submit" className="btn-submit">
                  Create Encrypted Workspace
                </button>
              </>
            )}
          </form>
        </div>
        {toastMessage && <div className="toast-notification">{toastMessage}</div>}
      </div>
    );
  }

  // ─── Main Workspace ─────────────────────────────────────────────────────

  return (
    <div className={`app-container theme-${theme}`}>
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
      
      <div className={`sidebar-wrapper ${sidebarOpen ? 'open' : ''}`}>
        <Sidebar
          documents={documents}
          currentDocId={currentDocId}
          folders={folders}
          searchQuery={searchQuery}
          onSearch={setSearchQuery}
          onSelectDoc={(id) => { void handleSelectDoc(id); setSidebarOpen(false); }}
          onCreateDoc={() => { void handleCreateDoc(); setSidebarOpen(false); }}
          onDeleteDoc={(id) => { void handleDeleteDoc(id); }}
          onCreateFolder={handleCreateFolder}
          onDeleteFolder={handleDeleteFolder}
          onTogglePin={handleTogglePin}
          onToggleLock={handleToggleLock}
          onMoveDoc={handleMoveDoc}
          onOpenTemplates={() => setIsTemplatesOpen(true)}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          currentDocTags={currentDocTags}
          teamName={activeTeam.teamName}
          teams={teams}
          activeTeamId={activeTeam.teamId}
          onSwitchTeam={handleSwitchTeam}
          peers={activePeersList}
          onLeaveTeam={() => { void handleLeaveTeam(); }}
        />
      </div>

      <main className={`main-content ${isCommentsOpen ? 'with-comments-panel' : ''} ${isChatOpen ? 'with-chat-panel' : ''}`}>
        <header className="workspace-header">
          <button 
            className="mobile-menu-btn" 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
            type="button"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          
          <span className="header-doc-title">
            {currentDoc?.title || 'No Document Selected'}
            {currentDoc?.isLocked && <Lock size={13} style={{ marginLeft: '8px', color: 'var(--error-color)', verticalAlign: 'middle' }} />}
          </span>
          <div className="workspace-actions">
            <button
              onClick={toggleTheme}
              className="btn-invite-outline theme-toggle"
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
              type="button"
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            >
              {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
              <span className="btn-text">{theme === 'light' ? 'Dark' : 'Light'}</span>
            </button>
            {currentDocId && currentDoc && (
              <>
                <button
                  onClick={() => { void handleToggleLock(currentDocId); }}
                  className="btn-invite-outline"
                  title={currentDoc.isLocked ? 'Unlock document' : 'Lock document'}
                  type="button"
                >
                  {currentDoc.isLocked ? <Unlock size={14} /> : <Lock size={14} />}
                  <span className="btn-text">{currentDoc.isLocked ? 'Unlock' : 'Lock'}</span>
                </button>
                <button
                  onClick={() => setIsAuditOpen(true)}
                  className="btn-invite-outline"
                  title="View audit log"
                  type="button"
                >
                  <ClipboardList size={14} />
                  <span className="btn-text">Audit</span>
                </button>
                <button
                  onClick={() => { setIsCommentsOpen(v => !v); setIsChatOpen(false); }}
                  className={`btn-invite-outline ${isCommentsOpen ? 'active' : ''}`}
                  title="Toggle comments"
                  type="button"
                >
                  <MessageSquare size={14} />
                  <span className="btn-text">Comments</span>
                </button>
                <button
                  onClick={() => { setIsChatOpen(v => !v); setIsCommentsOpen(false); }}
                  className={`btn-invite-outline ${isChatOpen ? 'active' : ''}`}
                  title="Toggle document chat"
                  type="button"
                >
                  <MessageCircle size={14} />
                  <span className="btn-text">Chat</span>
                </button>
                <ExportMenu docTitle={currentDoc.title} />
                <button onClick={() => setIsInviteOpen(true)} className="btn-invite-outline" type="button">
                  <Share2 size={14} />
                  <span className="btn-text">Share</span>
                </button>
              </>
            )}
          </div>
        </header>

        <div className="editor-and-comments">
          <div className="editor-area">
            {currentDocId && currentYDoc && currentProvider ? (
              <Editor
                doc={currentYDoc}
                provider={currentProvider}
                username={username}
                onTitleChange={handleTitleChange}
                isLocked={currentDoc?.isLocked}
                lockedBy={currentDoc?.lockedBy}
              />
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                Select or create a document to start writing.
              </div>
            )}
          </div>

          {isCommentsOpen && currentDocId && (
            <CommentsPanel
              docId={currentDocId}
              teamId={activeTeam.teamId}
              username={username}
              onClose={() => setIsCommentsOpen(false)}
              onCommentAdded={handleCommentAdded}
            />
          )}
          {isChatOpen && currentYDoc && (
            <ChatPanel
              doc={currentYDoc}
              username={username}
              onClose={() => setIsChatOpen(false)}
            />
          )}
        </div>

        <footer className="status-bar">
          <div className="status-left">
            <span className="status-indicator success">
              <ShieldCheck size={14} />
              Encrypted (AES-GCM)
            </span>
          </div>
          <div className="status-right">
            <span className={`status-indicator ${statusLabel.className}`} title={providerStatus.lastError || undefined}>
              {statusLabel.icon === 'on' && <Wifi size={14} />}
              {statusLabel.icon === 'off' && <WifiOff size={14} />}
              {statusLabel.icon === 'load' && <Loader2 size={14} className="spin" />}
              {statusLabel.text}
            </span>
            <span>Peers: <strong>{providerStatus.peerCount}</strong></span>
          </div>
        </footer>
      </main>

      {currentDoc && (
        <InviteModal
          isOpen={isInviteOpen}
          onClose={() => setIsInviteOpen(false)}
          docId={currentDoc.id}
          docTitle={currentDoc.title}
          teamId={activeTeam.teamId}
          teamKey={activeTeam.teamKey}
        />
      )}

      {isAuditOpen && currentDoc && (
        <AuditLogModal
          docId={currentDoc.id}
          docTitle={currentDoc.title}
          onClose={() => setIsAuditOpen(false)}
        />
      )}

      {isTemplatesOpen && (
        <TemplatesModal
          onClose={() => setIsTemplatesOpen(false)}
          onSelectTemplate={handleSelectTemplate}
        />
      )}

      {toastMessage && <div className="toast-notification">{toastMessage}</div>}
    </div>
  );
}

export default App;
