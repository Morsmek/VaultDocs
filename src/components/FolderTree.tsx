import React, { useState } from 'react';
import { FileText, Folder, FolderOpen, Plus, Trash2, Pin, Lock, ChevronRight } from 'lucide-react';
import type { LocalDocument, LocalFolder } from '../db/db';

interface FolderTreeProps {
  folders: LocalFolder[];
  documents: LocalDocument[];
  currentDocId: string | null;
  searchQuery: string;
  onSelectDoc: (id: string) => void;
  onDeleteDoc: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onTogglePin: (docId: string) => void;
  onToggleLock: (docId: string) => void;
  onMoveDoc: (docId: string, folderId: string | undefined) => void;
}

export const FolderTree: React.FC<FolderTreeProps> = ({
  folders,
  documents,
  currentDocId,
  searchQuery,
  onSelectDoc,
  onDeleteDoc,
  onDeleteFolder,
  onTogglePin,
  onToggleLock,
  onMoveDoc
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ docId: string; x: number; y: number } | null>(null);

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const filteredDocs = searchQuery
    ? documents.filter(d => d.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : documents;

  const pinnedDocs = filteredDocs.filter(d => d.isPinned);
  const unfiledDocs = filteredDocs.filter(d => !d.folderId && !d.isPinned);

  const handleContextMenu = (e: React.MouseEvent, docId: string) => {
    e.preventDefault();
    setContextMenu({ docId, x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  const DocItem = ({ doc }: { doc: LocalDocument }) => (
    <li
      className={`doc-item ${currentDocId === doc.id ? 'active' : ''}`}
      onClick={() => onSelectDoc(doc.id)}
      onContextMenu={(e) => handleContextMenu(e, doc.id)}
    >
      <div className="doc-item-title-wrapper">
        <FileText size={13} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
        <span className="doc-item-name">{doc.title || 'Untitled'}</span>
        <div className="doc-item-indicators">
          {doc.isLocked && <Lock size={10} className="indicator-lock" title="Locked" />}
          {doc.isPinned && <Pin size={10} className="indicator-pin" title="Pinned" />}
        </div>
        <span className="doc-item-info">{formatTime(doc.updatedAt)}</span>
      </div>
      {doc.tags && doc.tags.length > 0 && (
        <div className="tag-list">
          {doc.tags.map(tag => (
            <span key={tag} className="tag-badge">{tag}</span>
          ))}
        </div>
      )}
      <button
        className="btn-delete-doc"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm('Delete this document locally?')) onDeleteDoc(doc.id);
        }}
        title="Delete document"
      >
        <Trash2 size={13} />
      </button>
    </li>
  );

  return (
    <div className="folder-tree" onClick={closeContextMenu}>

      {/* Pinned section */}
      {pinnedDocs.length > 0 && (
        <div className="folder-section">
          <div className="folder-section-label">
            <Pin size={11} />
            Pinned
          </div>
          <ul className="doc-list">
            {pinnedDocs.map(doc => <DocItem key={doc.id} doc={doc} />)}
          </ul>
        </div>
      )}

      {/* Folders */}
      {folders.map(folder => {
        const folderDocs = filteredDocs.filter(d => d.folderId === folder.id && !d.isPinned);
        const isExpanded = expandedFolders.has(folder.id);

        return (
          <div key={folder.id} className="folder-section">
            <div
              className={`folder-item ${isExpanded ? 'expanded' : ''}`}
              onClick={() => toggleFolder(folder.id)}
            >
              <ChevronRight size={13} className={`folder-chevron ${isExpanded ? 'rotated' : ''}`} />
              {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
              <span className="folder-name">{folder.name}</span>
              <span className="folder-doc-count">{folderDocs.length}</span>
              <button
                className="btn-delete-doc"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete folder "${folder.name}"? Documents inside will be moved to All Documents.`)) {
                    onDeleteFolder(folder.id);
                  }
                }}
                title="Delete folder"
              >
                <Trash2 size={12} />
              </button>
            </div>
            {isExpanded && (
              <div className="folder-children">
                <ul className="doc-list">
                  {folderDocs.map(doc => <DocItem key={doc.id} doc={doc} />)}
                  {folderDocs.length === 0 && (
                    <div className="empty-folder-hint">Empty folder</div>
                  )}
                </ul>
              </div>
            )}
          </div>
        );
      })}

      {/* Unfiled documents */}
      {(unfiledDocs.length > 0 || folders.length === 0) && (
        <div className="folder-section">
          {folders.length > 0 && (
            <div className="folder-section-label">
              <FileText size={11} />
              All Documents
            </div>
          )}
          <ul className="doc-list">
            {unfiledDocs.map(doc => <DocItem key={doc.id} doc={doc} />)}
            {unfiledDocs.length === 0 && filteredDocs.length === 0 && (
              <div style={{ padding: '0 8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                {searchQuery ? 'No results found' : 'No documents yet'}
              </div>
            )}
          </ul>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (() => {
        const doc = documents.find(d => d.id === contextMenu.docId);
        if (!doc) return null;
        return (
          <div
            className="context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="context-menu-item" onClick={() => { onTogglePin(contextMenu.docId); closeContextMenu(); }}>
              <Pin size={13} />
              {doc.isPinned ? 'Unpin' : 'Pin to top'}
            </button>
            <button className="context-menu-item" onClick={() => { onToggleLock(contextMenu.docId); closeContextMenu(); }}>
              <Lock size={13} />
              {doc.isLocked ? 'Unlock document' : 'Lock document'}
            </button>
            <div className="context-menu-divider" />
            {folders.length > 0 && (
              <>
                <div className="context-menu-label">Move to folder</div>
                {doc.folderId && (
                  <button className="context-menu-item" onClick={() => { onMoveDoc(contextMenu.docId, undefined); closeContextMenu(); }}>
                    <Plus size={13} />
                    Remove from folder
                  </button>
                )}
                {folders.map(f => (
                  <button key={f.id} className="context-menu-item" onClick={() => { onMoveDoc(contextMenu.docId, f.id); closeContextMenu(); }}>
                    <Folder size={13} />
                    {f.name}
                  </button>
                ))}
                <div className="context-menu-divider" />
              </>
            )}
            <button className="context-menu-item danger" onClick={() => { if (confirm('Delete this document?')) { onDeleteDoc(contextMenu.docId); closeContextMenu(); } }}>
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        );
      })()}
    </div>
  );
};
