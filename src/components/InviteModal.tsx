import React, { useEffect, useState } from 'react';
import { X, Copy, Check, AlertTriangle } from 'lucide-react';
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
  const [inviteSecret, setInviteSecret] = useState(() =>
    Math.random().toString(36).substring(2, 10).toUpperCase()
  );
  const [inviteUrl, setInviteUrl] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const generate = async () => {
      setGenerating(true);
      setError(null);
      try {
        const token = await createInviteToken(docId, docTitle, teamId, teamKey, inviteSecret);
        if (cancelled) return;
        const origin = window.location.origin + window.location.pathname;
        setInviteUrl(
          `${origin}#/invite?token=${encodeURIComponent(token)}&secret=${encodeURIComponent(inviteSecret)}`
        );
      } catch (e) {
        if (!cancelled) setError('Failed to generate invite token');
        console.error(e);
      } finally {
        if (!cancelled) setGenerating(false);
      }
    };

    generate();
    return () => {
      cancelled = true;
    };
  }, [isOpen, docId, docTitle, teamId, teamKey, inviteSecret]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!inviteUrl) return;
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
          <button className="btn-close-modal" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-description">
            Share this encrypted invite link with your teammates. They receive the workspace key and join the P2P sync room for this document.
          </p>

          <div
            style={{
              display: 'flex',
              gap: '8px',
              padding: '10px 12px',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              borderRadius: '8px',
              marginBottom: '16px',
              fontSize: '12px',
              lineHeight: 1.45,
              color: 'var(--text-secondary)'
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0, color: '#f59e0b', marginTop: 1 }} />
            <span>
              <strong style={{ color: 'var(--text-primary)' }}>Treat this link like a password.</strong>{' '}
              It embeds the cryptographic secret needed to decrypt workspace keys. Anyone with the full URL can join and read this document.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">
              Invite secret (embedded in link):{' '}
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-hover)' }}>{inviteSecret}</span>
            </label>
            <button
              className="btn-secondary"
              style={{ padding: '6px 12px', fontSize: '12px' }}
              onClick={regenerateSecret}
              type="button"
            >
              Regenerate Secret
            </button>
          </div>

          <div className="invite-link-box">
            <input
              type="text"
              readOnly
              value={generating ? 'Generating secure invite…' : error || inviteUrl}
              className="invite-input"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button className="btn-copy" onClick={handleCopy} title="Copy link" type="button" disabled={!inviteUrl}>
              {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            </button>
          </div>

          {inviteUrl && (
            <div className="qr-code-section">
              <div className="qr-code-container">
                <QRCodeSVG value={inviteUrl} size={140} level="M" includeMargin={false} />
              </div>
              <span className="qr-code-label">Scan to join on another device</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
