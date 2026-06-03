import { useEffect, useState, useRef } from 'react';
import * as Y from 'yjs';
import { 
  Lock, 
  Wifi, 
  WifiOff, 
  Share2, 
  ShieldCheck,
  UserPlus
} from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { InviteModal } from './components/InviteModal';
import { 
  db, 
  listLocalDocuments, 
  listLocalTeams, 
  saveLocalDocument, 
  saveLocalTeam, 
  deleteLocalDocument 
} from './db/db';
import type { LocalDocument, LocalTeam } from './db/db';
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
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

  // 1. Toast Helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // 2. Parse URL hashes for invite tokens
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
            setInviteDetails({
              docTitle: parsed.docTitle,
              teamId: parsed.teamId
            });
            setSetupMode('join');
          } catch (e) {
            showToast('Invalid or corrupted invite token');
          }
        }
      }
    };

    parseHash();
    window.addEventListener('hashchange', parseHash);
    return () => window.removeEventListener('hashchange', parseHash);
  }, []);

  // 3. Load teams & active team on mount
  useEffect(() => {
    const loadTeams = async () => {
      const allTeams = await listLocalTeams();
      setTeams(allTeams);
      
      const lastTeamId = localStorage.getItem('vaultdocs_last_team');
      const foundTeam = allTeams.find(t => t.teamId === lastTeamId) || allTeams[0];
      
      if (foundTeam) {
        setActiveTeam(foundTeam);
        localStorage.setItem('vaultdocs_last_team', foundTeam.teamId);
      } else {
        // No teams exist yet, prompt setup mode unless user is currently joining via invite link
        if (!inviteToken) {
          setSetupMode('create');
        }
      }
    };
    loadTeams();
  }, [inviteToken]);

  // 4. Load documents when active team changes
  useEffect(() => {
    if (!activeTeam) {
      setDocuments([]);
      return;
    }

    const loadDocs = async () => {
      const docs = await listLocalDocuments(activeTeam.teamId);
      setDocuments(docs);
      
      // If we have documents, select the first one. Otherwise, create a default one
      if (docs.length > 0) {
        // Ensure we don't automatically override a specifically selected document
        if (!currentDocId || !docs.some(d => d.id === currentDocId)) {
          handleSelectDoc(docs[0].id);
        }
      } else {
        handleCreateDoc('Welcome to VaultDocs');
      }
    };

    loadDocs();
  }, [activeTeam]);

  // 5. Cleanup current provider on document change or unmount
  const cleanupProvider = () => {
    if (currentProvider) {
      currentProvider.destroy();
      setCurrentProvider(null);
    }
    if (currentYDoc) {
      currentYDoc.destroy();
      setCurrentYDoc(null);
    }
  };

  // 6. Select document and initialize collaborative E2EE WebRTC sync
  const handleSelectDoc = async (docId: string) => {
    if (!activeTeam) return;
    
    // Set refs and clean up previous connection
    activeDocIdRef.current = docId;
    cleanupProvider();
    setCurrentDocId(docId);

    // Initialize Yjs Doc
    const ydoc = new Y.Doc();
    setCurrentYDoc(ydoc);

    // Load from local IndexedDB first (Local-first persistence)
    const localDoc = await db.documents.get(docId);
    if (localDoc && localDoc.encryptedState) {
      try {
        const decryptedState = decryptUpdate(localDoc.encryptedState, activeTeam.teamKey);
        Y.applyUpdate(ydoc, decryptedState);
      } catch (err) {
        showToast('Error decrypting document. Incorrect cryptographic keys.');
      }
    }

    // Bind local doc changes to automatically update Dexie database (encrypted)
    ydoc.on('update', async (_, origin) => {
      // Avoid circular updates from our own provider
      if (origin === currentProvider) return;

      const state = Y.encodeStateAsUpdate(ydoc);
      const encrypted = encryptUpdate(state, activeTeam.teamKey);
      
      await db.documents.update(docId, {
        encryptedState: encrypted,
        updatedAt: Date.now()
      });

      // Update local React list state
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, updatedAt: Date.now() } : d));
    });

    // Initialize E2EE WebRTC Provider
    const provider = new EncryptedWebrtcProvider(
      ydoc,
      docId,
      activeTeam.teamKey,
      username || 'Anonymous'
    );
    
    setCurrentProvider(provider);

    // Track status
    provider.onStatus((status) => {
      setProviderStatus(status);
    });
  };

  // 7. Handle creation of a new document
  const handleCreateDoc = async (initialTitle = 'Untitled Document') => {
    if (!activeTeam) return;

    const docId = 'doc-' + Math.random().toString(36).substring(2, 11);
    
    // Initialize temporary empty YDoc state
    const tempYDoc = new Y.Doc();
    const ytitle = tempYDoc.getText('title');
    ytitle.insert(0, initialTitle);
    const yText = tempYDoc.getText('default');
    if (initialTitle === 'Welcome to VaultDocs') {
      yText.insert(0, 'Welcome to VaultDocs! This is your serverless, peer-to-peer, zero-knowledge collaborative workspace.\n\nEverything you write here is stored locally on your device via IndexedDB (offline-first) and syncs directly with teammates using WebRTC. All sync traffic is end-to-end encrypted before it leaves your browser using AES-256-GCM. The signaling server never sees your plaintext.');
    }
    
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
    
    // Refresh documents list
    const docs = await listLocalDocuments(activeTeam.teamId);
    setDocuments(docs);
    
    // Select the new doc
    handleSelectDoc(docId);
  };

  // 8. Handle document deletion
  const handleDeleteDoc = async (docId: string) => {
    await deleteLocalDocument(docId);
    
    const docs = await listLocalDocuments(activeTeam?.teamId);
    setDocuments(docs);

    if (currentDocId === docId) {
      cleanupProvider();
      setCurrentDocId(null);
      if (docs.length > 0) {
        handleSelectDoc(docs[0].id);
      }
    }
  };

  // 9. Sync title updates from Editor back to document list
  const handleTitleChange = async (newTitle: string) => {
    if (!currentDocId) return;
    
    await db.documents.update(currentDocId, {
      title: newTitle,
      updatedAt: Date.now()
    });

    setDocuments(prev => prev.map(d => d.id === currentDocId ? { ...d, title: newTitle, updatedAt: Date.now() } : d));
  };

  // 10. Wizard: Create New Team
  const handleCreateTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !newTeamName.trim()) {
      showToast('Username and Team Name are required');
      return;
    }

    localStorage.setItem('vaultdocs_username', username.trim());
    
    // If no passphrase is set, generate a secure random one
    const pass = newTeamPassphrase.trim() || generateRandomPassphrase();
    const teamId = 'team-' + Math.random().toString(36).substring(2, 11);
    
    // Derive symmetric encryption key
    const teamKey = await deriveKey(pass, teamId);

    const team: LocalTeam = {
      teamId,
      teamName: newTeamName.trim(),
      passphraseHash: pass, // Using passphrase directly for team invites
      teamKey,
      createdAt: Date.now()
    };

    await saveLocalTeam(team);
    
    const allTeams = await listLocalTeams();
    setTeams(allTeams);
    setActiveTeam(team);
    localStorage.setItem('vaultdocs_last_team', team.teamId);
    
    setSetupMode(null);
    showToast(`Team "${team.teamName}" created successfully!`);
  };

  // 11. Wizard: Join Team via invite token
  const handleJoinTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !inviteToken || !inviteSecret) {
      showToast('Username is required');
      return;
    }

    try {
      localStorage.setItem('vaultdocs_username', username.trim());
      
      const parsed = parseInviteToken(inviteToken, inviteSecret);
      
      // Save team credentials to DB
      const team: LocalTeam = {
        teamId: parsed.teamId,
        teamName: `Shared Team (${parsed.teamId.substring(5, 9)})`,
        passphraseHash: inviteSecret,
        teamKey: parsed.teamKey,
        createdAt: Date.now()
      };

      await saveLocalTeam(team);
      
      // Save the shared document structure placeholder
      const doc: LocalDocument = {
        id: parsed.docId,
        title: parsed.docTitle,
        encryptedState: null, // Let it sync from other peers
        teamId: parsed.teamId,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await saveLocalDocument(doc);
      
      // Update states
      const allTeams = await listLocalTeams();
      setTeams(allTeams);
      setActiveTeam(team);
      localStorage.setItem('vaultdocs_last_team', team.teamId);
      
      // Clear invite details
      setInviteToken(null);
      setInviteSecret(null);
      setInviteDetails(null);
      setSetupMode(null);
      
      // Clean query string / hash
      window.location.hash = '';
      
      // Select the joined document
      handleSelectDoc(parsed.docId);
      showToast('Joined team successfully!');
    } catch (err) {
      showToast('Failed to join team: cryptographic key derivation failed.');
    }
  };

  // 12. Leave current team / Reset
  const handleLeaveTeam = () => {
    if (confirm('Leave this team workspace? You will lose access to its E2EE keys locally.')) {
      cleanupProvider();
      setActiveTeam(null);
      setCurrentDocId(null);
      setSetupMode('create');
    }
  };

  // 13. Map peer status for Sidebar display
  const activePeersList = providerStatus.activePeers.map(peerId => {
    return {
      id: peerId,
      name: peerId.substring(5, 10), // Simple fallback or use awareness username
      color: '#c084fc',
      online: true
    };
  });

  // Render Setup Screen
  if (setupMode || !activeTeam) {
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <div className="setup-logo">
            <Lock size={32} />
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
                <div style={{ padding: '12px', backgroundColor: 'var(--accent-light)', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: '8px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 600, color: 'var(--accent-hover)', display: 'block', marginBottom: '4px' }}>Invitation Details</span>
                  <p style={{ fontSize: '13px', fontWeight: 600 }}>Joining document: <span style={{ color: '#fff' }}>{inviteDetails.docTitle || 'Untitled'}</span></p>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Team ID: {inviteDetails.teamId}</p>
                </div>
                <button type="submit" className="btn-submit">
                  <UserPlus size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                  Accept Invite & Sync
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
                onClick={() => {
                  setActiveTeam(teams[0]);
                  setSetupMode(null);
                }}
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

  // Render Main Workspace
  const currentDoc = documents.find(d => d.id === currentDocId);

  return (
    <div className="app-container">
      <Sidebar
        documents={documents}
        currentDocId={currentDocId}
        onSelectDoc={handleSelectDoc}
        onCreateDoc={() => handleCreateDoc()}
        onDeleteDoc={handleDeleteDoc}
        teamName={activeTeam.teamName}
        peers={activePeersList}
        onLeaveTeam={handleLeaveTeam}
      />

      <main className="main-content">
        <header className="workspace-header">
          <span className="header-doc-title">
            {currentDoc?.title || 'No Document Selected'}
          </span>
          <div className="workspace-actions">
            {currentDocId && (
              <button onClick={() => setIsInviteOpen(true)} className="btn-invite-outline">
                <Share2 size={14} />
                Share
              </button>
            )}
          </div>
        </header>

        {currentDocId && currentYDoc && currentProvider ? (
          <Editor
            doc={currentYDoc}
            provider={currentProvider}
            username={username}
            onTitleChange={handleTitleChange}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            Select or create a document to start writing.
          </div>
        )}

        <footer className="status-bar">
          <div className="status-left">
            <span className="status-indicator success">
              <ShieldCheck size={14} />
              🔒 Encrypted (AES-GCM)
            </span>
          </div>
          <div className="status-right">
            <span className={`status-indicator ${providerStatus.connected ? 'success' : 'warning'}`}>
              {providerStatus.connected ? (
                <>
                  <Wifi size={14} />
                  ⚡ Synced
                </>
              ) : (
                <>
                  <WifiOff size={14} />
                  📴 Offline
                </>
              )}
            </span>
            <span>
              Connected Peers: <strong style={{ color: '#fff' }}>{providerStatus.peerCount}</strong>
            </span>
          </div>
        </footer>
      </main>

      {/* Invite Share Modal */}
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

      {/* Toast notifications */}
      {toastMessage && <div className="toast-notification">{toastMessage}</div>}
    </div>
  );
}

export default App;
