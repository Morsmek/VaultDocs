import React, { useState } from 'react';
import { FileText, Plus, Trash2, Users, LogOut, Folder, LayoutTemplate } from 'lucide-react';
import { SearchBar } from './SearchBar';
import type { LocalDocument, LocalFolder } from '../db/db';

interface SidebarProps {
  documents: LocalDocument[];
  folders: LocalFolder[];
  currentDocId: string | null;
  onSelectDoc: (id: string) => void;
  onCreateDoc: () => void;
  onDeleteDoc: (id: string) => void;
  onCreateFolder: (name: string) => void;
  onSelectFolder: (folderId: string | null) => void;
  onTogglePin: (docId: string, pinned: boolean) => void;
  onAddTag: (docId: string, tag: string) => void;
  onRemoveTag: (docId: string, tag: string) => void;
  onOpenTemplates: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  teamName: string;
  peers: { id: string; name: string; color: string; online: boolean }[];
  onLeaveTeam: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  documents,
  currentDocId,
  onSelectDoc,
  onCreateDoc,
  onDeleteDoc,
  onCreateFolder,
  onTogglePin,
  onAddTag,
  onRemoveTag,
  onOpenTemplates,
  searchQuery,
  onSearchChange,
  teamName,
  peers,
  onLeaveTeam
}) => {
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newTagMode, setNewTagMode] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      onCreateFolder(newFolderName.trim());
      setNewFolderName('');
      setNewFolderMode(false);
    }
  };

  const handleAddTag = (docId: string) => {
    if (newTag.trim()) {
      onAddTag(docId, newTag.trim());
      setNewTag('');
      setNewTagMode(null);
    }
  };

  const pinnedDocs = documents.filter(d => d.isPinned);
  const regularDocs = documents.filter(d => !d.isPinned);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img src="/logo.png" alt="VaultDocs" className="logo-image" />
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

      {/* Search Bar */}
      <div className="sidebar-search-container">
        <SearchBar value={searchQuery} onChange={onSearchChange} />
      </div>

      <div className="sidebar-action-container">
        <button onClick={onCreateDoc} className="btn-new-doc">
          <Plus size={16} />
          New Document
        </button>
      </div>

      {/* Sidebar Secondary Actions */}
      <div className="sidebar-secondary-actions">
        <button
          onClick={() => setNewFolderMode(!newFolderMode)}
          className="btn-sidebar-icon"
          title="Create folder"
        >
          <Folder size={14} />
        </button>
        <button
          onClick={onOpenTemplates}
          className="btn-sidebar-icon"
          title="Use template"
        >
          <LayoutTemplate size={14} />
        </button>
      </div>

      {/* New Folder Form */}
      {newFolderMode && (
        <div className="new-folder-form">
          <input
            type="text"
            placeholder="Folder name..."
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            className="new-folder-input"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') setNewFolderMode(false);
            }}
          />
          <button onClick={handleCreateFolder} className="btn-sidebar-icon">
            <Plus size={14} />
          </button>
        </div>
      )}

      {/* Folder Tree - commented out pending prop alignment */}

      {/* Pinned Documents Section */}
      {pinnedDocs.length > 0 && (
        <div className="doc-list-section">
          <h3 className="doc-list-title" style={{ color: 'var(--accent-color)' }}>Pinned</h3>
          <ul className="doc-list">
            {pinnedDocs.map((doc) => (
              <li
                key={doc.id}
                className={`doc-item ${currentDocId === doc.id ? 'active' : ''}`}
                onClick={() => onSelectDoc(doc.id)}
              >
                <div className="doc-item-title-wrapper">
                  <FileText size={15} style={{ flexShrink: 0 }} />
                  <span className="doc-item-name">{doc.title || 'Untitled'}</span>
                  <span className="doc-item-info">{formatTime(doc.updatedAt)}</span>
                </div>
                <button
                  className="btn-delete-doc"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(doc.id, false);
                  }}
                  title="Unpin"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Documents Section */}
      <div className="doc-list-section">
        <h3 className="doc-list-title">{teamName || 'Local Workspace'}</h3>
        <ul className="doc-list">
          {regularDocs.map((doc) => (
            <div key={doc.id}>
              <li
                className={`doc-item ${currentDocId === doc.id ? 'active' : ''}`}
                onClick={() => onSelectDoc(doc.id)}
              >
                <div className="doc-item-title-wrapper">
                  <FileText size={15} style={{ flexShrink: 0 }} />
                  <span className="doc-item-name">{doc.title || 'Untitled'}</span>
                  {doc.isLocked && <span style={{ color: 'var(--error-color)', fontSize: '10px' }}>🔒</span>}
                  <span className="doc-item-info">{formatTime(doc.updatedAt)}</span>
                </div>
                <button
                  className="btn-delete-doc"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Delete this document?')) {
                      onDeleteDoc(doc.id);
                    }
                  }}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </li>
              {/* Tags for this document */}
              {(doc.tags && doc.tags.length > 0 || newTagMode === doc.id) && (
                <div className="tag-list">
                  {doc.tags?.map(tag => (
                    <span key={tag} className="tag-badge">
                      {tag}
                      <button
                        className="tag-remove-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveTag(doc.id, tag);
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {newTagMode === doc.id && (
                    <input
                      type="text"
                      placeholder="New tag..."
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      className="tag-input"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddTag(doc.id);
                        if (e.key === 'Escape') {
                          setNewTagMode(null);
                          setNewTag('');
                        }
                      }}
                    />
                  )}
                  {newTagMode !== doc.id && (
                    <button
                      onClick={() => setNewTagMode(doc.id)}
                      className="tag-input"
                      style={{ cursor: 'pointer', padding: '2px 5px' }}
                    >
                      + Tag
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {regularDocs.length === 0 && pinnedDocs.length === 0 && (
            <div style={{ padding: '0 8px', fontSize: '12px', color: 'var(--text-muted)' }}>
              No documents yet
            </div>
          )}
        </ul>
      </div>

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
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Only you</span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
