import React from 'react';
import { FileText, Plus, Trash2, Users, LogOut } from 'lucide-react';
import type { LocalDocument } from '../db/db';

interface SidebarProps {
  documents: LocalDocument[];
  currentDocId: string | null;
  onSelectDoc: (id: string) => void;
  onCreateDoc: () => void;
  onDeleteDoc: (id: string) => void;
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
  teamName,
  peers,
  onLeaveTeam
}) => {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

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

      <div className="sidebar-action-container">
        <button onClick={onCreateDoc} className="btn-new-doc">
          <Plus size={16} />
          New Document
        </button>
      </div>

      <div className="doc-list-section">
        <h3 className="doc-list-title">{teamName || 'Local Workspace'}</h3>
        <ul className="doc-list">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className={`doc-item ${currentDocId === doc.id ? 'active' : ''}`}
              onClick={() => onSelectDoc(doc.id)}
            >
              <div className="doc-item-title-wrapper">
                <FileText size={15} style={{ flexShrink: 0 }} />
                <span>{doc.title || 'Untitled'}</span>
                <span className="doc-item-info">{formatTime(doc.updatedAt)}</span>
              </div>
              <button
                className="btn-delete-doc"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('Are you sure you want to delete this document locally?')) {
                    onDeleteDoc(doc.id);
                  }
                }}
                title="Delete document"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
          {documents.length === 0 && (
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
