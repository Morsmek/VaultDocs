import React, { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { createInviteToken } from '../crypto/crypto';

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  docId: string;
  docTitle: string;
  teamId: string;
  teamKey: Uint8Array;
}

export const InviteModal: React.FC<InviteModalProps> = ({
  isOpen,
  onClose,
  docId,
  docTitle,
  teamId,
  teamKey
}) => {
  const [copied, setCopied] = useState(false);
  const [inviteSecret, setInviteSecret] = useState(() => {
    // Generate a random 8-character invitation secret code
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  });

  if (!isOpen) return null;

  // Generate cryptographic token
  const token = createInviteToken(docId, docTitle, teamId, teamKey, inviteSecret);
  
  // Construct the secure URL
  const origin = window.location.origin + window.location.pathname;
  const inviteUrl = `${origin}#/invite?token=${encodeURIComponent(token)}&secret=${encodeURIComponent(inviteSecret)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const regenerateSecret = () => {
    setInviteSecret(Math.random().toString(36).substring(2, 10).toUpperCase());
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Invite to Team</h3>
          <button className="btn-close-modal" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-description">
            Share this end-to-end encrypted invite link with your teammates. They will receive the shared document key and join the cryptographic sync room. No emails or passwords required!
          </p>

          <div className="form-group">
            <label className="form-label">Crypto Invite Secret: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-hover)' }}>{inviteSecret}</span></label>
            <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={regenerateSecret}>
              Regenerate One-time Secret
            </button>
          </div>

          <div className="invite-link-box">
            <input
              type="text"
              readOnly
              value={inviteUrl}
              className="invite-input"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button className="btn-copy" onClick={handleCopy} title="Copy link">
              {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            </button>
          </div>

          <div className="qr-code-section">
            <div className="qr-code-container">
              <QRCodeSVG value={inviteUrl} size={140} level="M" includeMargin={false} />
            </div>
            <span className="qr-code-label">Scan to join on another device</span>
          </div>
        </div>
      </div>
    </div>
  );
};
