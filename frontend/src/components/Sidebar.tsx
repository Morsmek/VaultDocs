import React, { useState } from 'react';
import { Plus, Users, LogOut, FolderPlus, LayoutTemplate, Tag, X } from 'lucide-react';
import type { LocalDocument, LocalFolder, LocalTeam } from '../db/db';
import { SearchBar } from './SearchBar';
import { FolderTree } from './FolderTree';

interface SidebarProps {
  documents: LocalDocument[];
  currentDocId: string | null;
  folders: LocalFolder[];
  searchQuery: string;
  onSearch: (q: string) => void;
  onSelectDoc: (id: string) => void;
  onCreateDoc: () => void;
  onDeleteDoc: (id: string) => void;
  onCreateFolder: (name: string) => void;
  onDeleteFolder: (id: string) => void;
  onTogglePin: (docId: string) => void;
  onToggleLock: (docId: string) => void;
  onMoveDoc: (docId: string, folderId: string | undefined) => void;
  onOpenTemplates: () => void;
  onAddTag: (docId: string, tag: string) => void;
  onRemoveTag: (docId: string, tag: string) => void;
  currentDocTags: string[];
  teamName: string;
  teams: LocalTeam[];
  activeTeamId: string;
  onSwitchTeam: (teamId: string) => void;
  peers: { id: string; name: string; color: string; online: boolean }[];
  onLeaveTeam: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  documents,
  currentDocId,
  folders,
  searchQuery,
  onSearch,
  onSelectDoc,
  onCreateDoc,
  onDeleteDoc,
  onCreateFolder,
  onDeleteFolder,
  onTogglePin,
  onToggleLock,
  onMoveDoc,
  onOpenTemplates,
  onAddTag,
  onRemoveTag,
  currentDocTags,
  teamName,
  teams,
  activeTeamId,
  onSwitchTeam,
  peers,
  onLeaveTeam
}) => {
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [tagInput, setTagInput] = useState('');

  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    onCreateFolder(newFolderName.trim());
    setNewFolderName('');
    setShowNewFolderInput(false);
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagInput.trim() && currentDocId) {
      onAddTag(currentDocId, tagInput.trim().toLowerCase());
      setTagInput('');
    }
  };

  return (
    <aside className="sidebar">
      {/* Logo header */}
      <div className="sidebar-header">
        <img src="/logo.png" alt="VaultDocs" className="logo-image logo-dark" />
        <img src="/logo-light.png" alt="VaultDocs" className="logo-image logo-light" />
        <div style={{ flex: 1 }} />
        <button
          onClick={onLeaveTeam}
          className="btn-delete-doc"
          title="Leave current team"
          style={{ opacity: 1 }}
        >
          <LogOut size={16} />
        </button>
      </div>

      {/* Action buttons */}
      <div className="sidebar-action-container">
        <button onClick={onCreateDoc} className="btn-new-doc">
          <Plus size={15} />
          New Document
        </button>
        <div className="sidebar-secondary-actions">
          <button
            className="btn-sidebar-icon"
            onClick={() => setShowNewFolderInput(v => !v)}
            title="New folder"
          >
            <FolderPlus size={15} />
          </button>
          <button
            className="btn-sidebar-icon"
            onClick={onOpenTemplates}
            title="Templates"
          >
            <LayoutTemplate size={15} />
          </button>
        </div>
      </div>

      {/* New folder input */}
      {showNewFolderInput && (
        <form className="new-folder-form" onSubmit={handleCreateFolder}>
          <input
            autoFocus
            type="text"
            className="new-folder-input"
            placeholder="Folder name..."
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setShowNewFolderInput(false)}
          />
          <button type="submit" className="btn-sidebar-icon" title="Create folder">
            <Plus size={13} />
          </button>
        </form>
      )}

      {/* Search */}
      <div className="sidebar-search-container">
        <SearchBar value={searchQuery} onChange={onSearch} />
      </div>

      {/* Team name + document tree */}
      <div className="doc-list-section">
        {teams.length > 1 ? (
          <select
            className="team-switcher"
            value={activeTeamId}
            onChange={(e) => onSwitchTeam(e.target.value)}
            title="Switch workspace"
            aria-label="Switch workspace"
          >
            {teams.map((t) => (
              <option key={t.teamId} value={t.teamId}>
                {t.teamName}
              </option>
            ))}
          </select>
        ) : (
          <h3 className="doc-list-title">{teamName || 'Local Workspace'}</h3>
        )}
        <FolderTree
          folders={folders}
          documents={documents}
          currentDocId={currentDocId}
          searchQuery={searchQuery}
          onSelectDoc={onSelectDoc}
          onDeleteDoc={onDeleteDoc}
          onDeleteFolder={onDeleteFolder}
          onTogglePin={onTogglePin}
          onToggleLock={onToggleLock}
          onMoveDoc={onMoveDoc}
        />
      </div>

      {/* Tags for current doc */}
      {currentDocId && (
        <div className="sidebar-tags-section">
          <div className="tags-section-header">
            <Tag size={11} />
            <span>Tags</span>
          </div>
          <div className="tags-list-row">
            {currentDocTags.map(tag => (
              <span key={tag} className="tag-badge">
                {tag}
                <button
                  className="tag-remove-btn"
                  onClick={() => onRemoveTag(currentDocId, tag)}
                  title="Remove tag"
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
          <input
            type="text"
            className="tag-input"
            placeholder="Add tag, press Enter..."
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleAddTag}
          />
        </div>
      )}

      {/* Footer — teammates */}
      <div className="sidebar-footer">
        <div className="members-section">
          <h4 className="members-title">
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Users size={12} />
              Active Teammates ({peers.length})
            </span>
          </h4>
          <div className="members-avatars">
            {peers.map((peer) => {
              const initials = peer.name ? peer.name.slice(0, 2).toUpperCase() : '??';
              return (
                <div key={peer.id} className="avatar-wrapper" title={peer.name}>
                  <div
                    className="member-avatar"
                    style={{ backgroundColor: peer.color || 'var(--accent-color)' }}
                  >
                    {initials}
                  </div>
                  <div className={`avatar-status-dot ${peer.online ? '' : 'offline'}`} />
                </div>
              );
            })}
            {peers.length === 0 && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Only you — share to collaborate
              </span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
