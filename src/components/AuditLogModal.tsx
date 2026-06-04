import React, { useEffect, useState } from 'react';
import { X, FileText, Lock, Unlock, Trash2, MessageSquare, Pin, Tag, FolderInput, PenLine } from 'lucide-react';
import { listAuditEntries } from '../db/db';
import type { AuditEntry } from '../db/db';

interface AuditLogModalProps {
  docId: string;
  docTitle: string;
  onClose: () => void;
}

const actionIcon: Record<string, React.ReactNode> = {
  created:   <FileText size={14} />,
  edited:    <PenLine size={14} />,
  locked:    <Lock size={14} />,
  unlocked:  <Unlock size={14} />,
  deleted:   <Trash2 size={14} />,
  commented: <MessageSquare size={14} />,
  pinned:    <Pin size={14} />,
  unpinned:  <Pin size={14} />,
  tagged:    <Tag size={14} />,
  moved:     <FolderInput size={14} />
};

const actionColor: Record<string, string> = {
  created:   '#10b981',
  edited:    '#0066ff',
  locked:    '#ef4444',
  unlocked:  '#10b981',
  deleted:   '#ef4444',
  commented: '#f59e0b',
  pinned:    '#0066ff',
  unpinned:  '#718096',
  tagged:    '#0066ff',
  moved:     '#718096'
};

export const AuditLogModal: React.FC<AuditLogModalProps> = ({ docId, docTitle, onClose }) => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    if (docId) {
      listAuditEntries(docId).then(setEntries);
    }
  }, [docId]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getInitials = (name: string) => name.slice(0, 2).toUpperCase();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Audit Log</h3>
          <p className="modal-subtitle">{docTitle}</p>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="audit-timeline">
          {entries.length === 0 && (
            <div className="audit-empty">No activity recorded for this document yet.</div>
          )}
          {entries.map((entry, idx) => (
            <div key={entry.id} className="audit-entry">
              <div className="audit-entry-line">
                {idx < entries.length - 1 && <div className="audit-connector" />}
                <div
                  className="audit-icon"
                  style={{ color: actionColor[entry.action] || '#718096', borderColor: actionColor[entry.action] || '#718096' }}
                >
                  {actionIcon[entry.action] || <FileText size={14} />}
                </div>
              </div>
              <div className="audit-entry-body">
                <div className="audit-entry-header">
                  <div className="audit-avatar">{getInitials(entry.actor)}</div>
                  <div className="audit-entry-info">
                    <span className="audit-username">{entry.actor}</span>
                    <span className="audit-action">{entry.action}</span>
                    {entry.details && <span className="audit-detail">{JSON.stringify(entry.details)}</span>}
                  </div>
                  <span className="audit-time">{formatTime(entry.timestamp)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
