import { useEffect, useState, useRef } from 'react';
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
  MessageSquare
} from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { InviteModal } from './components/InviteModal';
import { CommentsPanel } from './components/CommentsPanel';
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
  saveComment,
  seedDefaultTemplates
} from './db/db';
import type { LocalDocument, LocalTeam, LocalFolder, DocTemplate } from './db/db';
import { 
  deriveKey, 
  encryptUpdate, 
  decryptUpdate, 
  generateRandomPassphrase, 
  parseInviteToken 
} from './crypto/crypto';
import { EncryptedWebrtcProvider } from './sync/webrtc-provider';
import type { ProviderStatus } from './sync/webrtc-provider';

function App() {
  // Navigation & User State
  const [username, setUsername] = useState(() => localStorage.getItem('vaultdocs_username') || '');
  const [activeTeam, setActiveTeam] = useState<LocalTeam | null>(null);
  const [teams, setTeams] = useState<LocalTeam[]>([]);
  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [folders, setFolders] = useState<LocalFolder[]>([]);
  
  // Collaborative Instances
  const [currentYDoc, setCurrentYDoc] = useState<Y.Doc | null>(null);
  const [currentProvider, setCurrentProvider] = useState<EncryptedWebrtcProvider | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({
    connected: false,
    synced: true,
    peerCount: 0,
    activePeers: []
  });

  // UI State
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Setup Wizard State
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamPassphrase, setNewTeamPassphrase] = useState('');
  const [setupMode, setSetupMode] = useState<'create' | 'join' | 'select' | null>(null);

  // Invite Parsing State
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteSecret, setInviteSecret] = useState<string | null>(null);
  const [inviteDetails, setInviteDetails] = useState<{ docTitle: string; teamId: string } | null>(null);

  // Refs for tracking active doc to prevent race conditions
  const activeDocIdRef = useRef<string | null>(null);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const refreshDocs = async (teamId: string) => {
    const docs = await listLocalDocuments(teamId);
    setDocuments(docs);
    return docs;
  };

  const refreshFolders = async (teamId: string) => {
    const f = await listFolders(teamId);
    setFolders(f);
  };

  // ─── 1. Parse URL hashes for invite tokens ───────────────────────────────

  useEffect(() => {
    const parseHash = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#/invite')) {
        const urlParams = new URLSearchParams(hash.substring(hash.indexOf('?')));
        const token = urlParams.get('token');
        const secret = urlParams.get('secret');
        if (token && secret) {
          try {
            const parsed = parseInviteToken(token, secret);
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
    parseHash();
    window.addEventListener('hashchange', parseHash);
    return () => window.removeEventListener('hashchange', parseHash);
  }, []);

  // ─── 2. Load teams & seed templates on mount ─────────────────────────────

  useEffect(() => {
    const loadTeams = async () => {
      if (!localStorage.getItem('vaultdocs_db_clean_v2')) {
        await db.documents.clear();
        localStorage.setItem('vaultdocs_db_clean_v2', 'true');
      }
      // Seed default templates once
      await seedDefaultTemplates();

      const allTeams = await listLocalTeams();
      setTeams(allTeams);
      const lastTeamId = localStorage.getItem('vaultdocs_last_team');
      const foundTeam = allTeams.find(t => t.teamId === lastTeamId) || allTeams[0];
      if (foundTeam) {
        setActiveTeam(foundTeam);
        localStorage.setItem('vaultdocs_last_team', foundTeam.teamId);
      } else {
        if (!inviteToken) setSetupMode('create');
      }
    };
    loadTeams();
  }, [inviteToken]);

  // ─── 3. Load docs + folders when team changes ────────────────────────────

  useEffect(() => {
    if (!activeTeam) { setDocuments([]); setFolders([]); return; }
    const load = async () => {
      const docs = await listLocalDocuments(activeTeam.teamId);
      setDocuments(docs);
      await refreshFolders(activeTeam.teamId);
      if (docs.length > 0) {
        if (!currentDocId || !docs.some(d => d.id === currentDocId)) {
          handleSelectDoc(docs[0].id);
        }
      } else {
        handleCreateDoc('Welcome to VaultDocs');
      }
    };
    load();
  }, [activeTeam]);

  // ─── 4. Provider cleanup ────────────────────────────────────────────────

  const cleanupProvider = () => {
    if (currentProvider) { currentProvider.destroy(); setCurrentProvider(null); }
    if (currentYDoc) { currentYDoc.destroy(); setCurrentYDoc(null); }
  };

  // ─── 5. Select doc ──────────────────────────────────────────────────────

  const handleSelectDoc = async (docId: string) => {
    if (!activeTeam) return;
    activeDocIdRef.current = docId;
    cleanupProvider();
    setCurrentDocId(docId);
    setIsCommentsOpen(false);
    setIsAuditOpen(false);

    const ydoc = new Y.Doc();
    setCurrentYDoc(ydoc);

    const localDoc = await db.documents.get(docId);
    if (localDoc && localDoc.encryptedState) {
      try {
        const decryptedState = decryptUpdate(localDoc.encryptedState, activeTeam.teamKey);
        Y.applyUpdate(ydoc, decryptedState);
      } catch {
        showToast('Error decrypting document. Incorrect cryptographic keys.');
      }
    }

    ydoc.on('update', async (_, origin) => {
      if (origin === currentProvider) return;
      const state = Y.encodeStateAsUpdate(ydoc);
      const encrypted = encryptUpdate(state, activeTeam.teamKey);
      await db.documents.update(docId, { encryptedState: encrypted, updatedAt: Date.now() });
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, updatedAt: Date.now() } : d));
    });

    const provider = new EncryptedWebrtcProvider(ydoc, docId, activeTeam.teamKey, username || 'Anonymous');
    setCurrentProvider(provider);
    provider.onStatus((status) => setProviderStatus(status));
  };

  // ─── 6. Create doc ──────────────────────────────────────────────────────

  const handleCreateDoc = async (initialTitle = 'Untitled Document', templateContent?: string) => {
    if (!activeTeam) return;
    const docId = 'doc-' + Math.random().toString(36).substring(2, 11);

    const tempYDoc = new Y.Doc();
    const ytitle = tempYDoc.getText('title');
    ytitle.insert(0, initialTitle);
    const state = Y.encodeStateAsUpdate(tempYDoc);
    const encrypted = encryptUpdate(state, activeTeam.teamKey);
    tempYDoc.destroy();

    const newDoc: LocalDocument = {
      id: docId,
      title: initialTitle,
      encryptedState: encrypted,
      teamId: activeTeam.teamId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await saveLocalDocument(newDoc);
    await addAuditEntry(docId, activeTeam.teamId, 'created', username || 'Anonymous', initialTitle);
    await refreshDocs(activeTeam.teamId);
    handleSelectDoc(docId);

    // If a template was selected, apply its content after editor mounts
    // (stored in sessionStorage so Editor can read it on mount)
    if (templateContent) {
      sessionStorage.setItem('vaultdocs_template_content', templateContent);
    }
  };

  // ─── 7. Delete doc ──────────────────────────────────────────────────────

  const handleDeleteDoc = async (docId: string) => {
    if (activeTeam) {
      await addAuditEntry(docId, activeTeam.teamId, 'deleted', username || 'Anonymous');
    }
    await deleteLocalDocument(docId);
    const docs = await refreshDocs(activeTeam?.teamId ?? '');
    if (currentDocId === docId) {
      cleanupProvider();
      setCurrentDocId(null);
      if (docs.length > 0) handleSelectDoc(docs[0].id);
    }
  };

  // ─── 8. Title change ────────────────────────────────────────────────────

  const handleTitleChange = async (newTitle: string) => {
    if (!currentDocId) return;
    await db.documents.update(currentDocId, { title: newTitle, updatedAt: Date.now() });
    setDocuments(prev => prev.map(d => d.id === currentDocId ? { ...d, title: newTitle, updatedAt: Date.now() } : d));
  };

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
    showToast(newLocked ? 'Document locked' : 'Document unlocked');
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
    const team: LocalTeam = { teamId, teamName: newTeamName.trim(), passphraseHash: pass, teamKey, createdAt: Date.now() };
    await saveLocalTeam(team);
    const allTeams = await listLocalTeams();
    setTeams(allTeams);
    setActiveTeam(team);
    localStorage.setItem('vaultdocs_last_team', team.teamId);
    setSetupMode(null);
    showToast(`Team "${team.teamName}" created successfully!`);
  };

  // ─── 15. Join Team ──────────────────────────────────────────────────────

  const handleJoinTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !inviteToken || !inviteSecret) { showToast('Username is required'); return; }
    try {
      localStorage.setItem('vaultdocs_username', username.trim());
      const parsed = parseInviteToken(inviteToken, inviteSecret);
      const team: LocalTeam = {
        teamId: parsed.teamId,
        teamName: `Shared Team (${parsed.teamId.substring(5, 9)})`,
        passphraseHash: inviteSecret,
        teamKey: parsed.teamKey,
        createdAt: Date.now()
      };
      await saveLocalTeam(team);
      const doc: LocalDocument = { id: parsed.docId, title: parsed.docTitle, encryptedState: null, teamId: parsed.teamId, createdAt: Date.now(), updatedAt: Date.now() };
      await saveLocalDocument(doc);
      const allTeams = await listLocalTeams();
      setTeams(allTeams);
      setActiveTeam(team);
      localStorage.setItem('vaultdocs_last_team', team.teamId);
      setInviteToken(null); setInviteSecret(null); setInviteDetails(null); setSetupMode(null);
      window.location.hash = '';
      handleSelectDoc(parsed.docId);
      showToast('Joined team successfully!');
    } catch {
      showToast('Failed to join team: cryptographic key derivation failed.');
    }
  };

  // ─── 16. Leave Team ─────────────────────────────────────────────────────

  const handleLeaveTeam = () => {
    if (confirm('Leave this team workspace? You will lose access to its E2EE keys locally.')) {
      cleanupProvider();
      setActiveTeam(null);
      setCurrentDocId(null);
      setSetupMode('create');
    }
  };

  // ─── Derived state ───────────────────────────────────────────────────────

  const activePeersList = providerStatus.activePeers.map(peerId => ({
    id: peerId,
    name: peerId.substring(5, 10),
    color: '#0066ff',
    online: true
  }));

  const currentDoc = documents.find(d => d.id === currentDocId);
  const currentDocTags = currentDoc?.tags || [];

  // ─── Setup Screen ───────────────────────────────────────────────────────

  if (setupMode || !activeTeam) {
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <div className="setup-logo">
            <img src="/logo.png" alt="VaultDocs" style={{ height: '48px', width: 'auto' }} />
          </div>
          <h2 className="setup-title">VaultDocs Setup</h2>
          <p className="setup-description">
            Zero-knowledge, peer-to-peer collaborative documents. Plaintext never touches a server.
          </p>

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

            {teams.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: '8px' }}
                onClick={() => { setActiveTeam(teams[0]); setSetupMode(null); }}
              >
                Back to Workspace
              </button>
            )}
          </form>
        </div>
        {toastMessage && <div className="toast-notification">{toastMessage}</div>}
      </div>
    );
  }

  // ─── Main Workspace ─────────────────────────────────────────────────────

  return (
    <div className="app-container">
      <Sidebar
        documents={documents}
        currentDocId={currentDocId}
        folders={folders}
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        onSelectDoc={handleSelectDoc}
        onCreateDoc={() => handleCreateDoc()}
        onDeleteDoc={handleDeleteDoc}
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
        peers={activePeersList}
        onLeaveTeam={handleLeaveTeam}
      />

      <main className={`main-content ${isCommentsOpen ? 'with-comments-panel' : ''}`}>
        <header className="workspace-header">
          <span className="header-doc-title">
            {currentDoc?.title || 'No Document Selected'}
            {currentDoc?.isLocked && <Lock size={13} style={{ marginLeft: '8px', color: 'var(--error-color)', verticalAlign: 'middle' }} />}
          </span>
          <div className="workspace-actions">
            {currentDocId && currentDoc && (
              <>
                <button
                  onClick={handleToggleLock.bind(null, currentDocId)}
                  className="btn-invite-outline"
                  title={currentDoc.isLocked ? 'Unlock document' : 'Lock document'}
                >
                  {currentDoc.isLocked ? <Unlock size={14} /> : <Lock size={14} />}
                  {currentDoc.isLocked ? 'Unlock' : 'Lock'}
                </button>
                <button
                  onClick={() => setIsAuditOpen(true)}
                  className="btn-invite-outline"
                  title="View audit log"
                >
                  <ClipboardList size={14} />
                  Audit
                </button>
                <button
                  onClick={() => setIsCommentsOpen(v => !v)}
                  className={`btn-invite-outline ${isCommentsOpen ? 'active' : ''}`}
                  title="Toggle comments"
                >
                  <MessageSquare size={14} />
                  Comments
                </button>
                <ExportMenu docTitle={currentDoc.title} />
                <button onClick={() => setIsInviteOpen(true)} className="btn-invite-outline">
                  <Share2 size={14} />
                  Share
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
        </div>

        <footer className="status-bar">
          <div className="status-left">
            <span className="status-indicator success">
              <ShieldCheck size={14} />
              Encrypted (AES-GCM)
            </span>
          </div>
          <div className="status-right">
            <span className={`status-indicator ${providerStatus.connected ? 'success' : 'warning'}`}>
              {providerStatus.connected ? (
                <><Wifi size={14} />Synced</>
              ) : (
                <><WifiOff size={14} />Offline</>
              )}
            </span>
            <span>Peers: <strong>{providerStatus.peerCount}</strong></span>
          </div>
        </footer>
      </main>

      {/* Modals */}
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
