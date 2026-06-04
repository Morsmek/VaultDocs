import React, { useState, useEffect, useCallback } from 'react';
import { X, Check, MessageSquare, Trash2 } from 'lucide-react';
import { listComments, saveComment, resolveComment, deleteComment } from '../db/db';
import type { DocComment } from '../db/db';

interface CommentsPanelProps {
  docId: string;
  teamId: string;
  username: string;
  onClose: () => void;
  onCommentAdded?: () => void;
}

export const CommentsPanel: React.FC<CommentsPanelProps> = ({
  docId,
  username,
  onClose,
  onCommentAdded
}) => {
  const [comments, setComments] = useState<DocComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const loadComments = useCallback(async () => {
    const all = await listComments(docId);
    setComments(all);
  }, [docId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    await saveComment({
      id: 'comment-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
      docId,
      author: username,
      text: newComment.trim(),
      createdAt: Date.now()
    });
    setNewComment('');
    await loadComments();
    onCommentAdded?.();
  };

  const handleResolve = async (commentId: string) => {
    await resolveComment(commentId);
    await loadComments();
  };

  const handleDelete = async (commentId: string) => {
    await deleteComment(commentId);
    await loadComments();
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getInitials = (name: string) => name.slice(0, 2).toUpperCase();

  const visible = comments.filter(c => showResolved || !c.resolved);
  const resolvedCount = comments.filter(c => c.resolved).length;

  return (
    <div className="comments-panel">
      <div className="comments-panel-header">
        <div className="comments-panel-title">
          <MessageSquare size={15} />
          Comments
          {comments.length > 0 && (
            <span className="comments-count-badge">{comments.filter(c => !c.resolved).length}</span>
          )}
        </div>
        <button className="comments-close-btn" onClick={onClose} title="Close comments">
          <X size={16} />
        </button>
      </div>

      {/* Add comment form */}
      <form className="comment-form" onSubmit={handleSubmit}>
        <textarea
          className="comment-textarea"
          placeholder="Add a comment..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e as any);
          }}
        />
        <button type="submit" className="comment-submit-btn" disabled={!newComment.trim()}>
          Post comment
        </button>
      </form>

      {/* Filter toggle */}
      {resolvedCount > 0 && (
        <button
          className="show-resolved-btn"
          onClick={() => setShowResolved(v => !v)}
        >
          {showResolved ? 'Hide' : 'Show'} {resolvedCount} resolved
        </button>
      )}

      {/* Comment list */}
      <div className="comment-list">
        {visible.length === 0 && (
          <div className="comment-empty">No comments yet. Start the conversation.</div>
        )}
        {visible.map(comment => (
          <div key={comment.id} className={`comment-item ${comment.resolved ? 'resolved' : ''}`}>
            <div className="comment-avatar">
              {getInitials(comment.author)}
            </div>
            <div className="comment-body">
                <div className="comment-meta">
                  <span className="comment-author">{comment.author}</span>
                  <span className="comment-time">{formatTime(comment.createdAt)}</span>
              </div>
              <p className="comment-text">{comment.text}</p>
              <div className="comment-actions">
                {!comment.resolved && (
                  <button
                    className="comment-action-btn"
                    onClick={() => handleResolve(comment.id)}
                    title="Mark as resolved"
                  >
                    <Check size={12} />
                    Resolve
                  </button>
                )}
                {comment.resolved && (
                  <span className="comment-resolved-label">
                    <Check size={11} />
                    Resolved
                  </span>
                )}
                <button
                  className="comment-action-btn danger"
                  onClick={() => handleDelete(comment.id)}
                  title="Delete comment"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
