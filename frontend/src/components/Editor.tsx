import React, { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import * as Y from 'yjs';
import { 
  Bold, 
  Italic, 
  Code, 
  Heading1, 
  Heading2, 
  Quote, 
  Terminal,
  Lock
} from 'lucide-react';

interface EditorProps {
  doc: Y.Doc;
  provider: any; // EncryptedWebrtcProvider
  username: string;
  onTitleChange: (newTitle: string) => void;
  isLocked?: boolean;
  lockedBy?: string;
}

const WELCOME_HTML = `
  <h1>Welcome to VaultDocs!</h1>
  <p>This is your serverless, peer-to-peer, zero-knowledge collaborative workspace.</p>
  <p>Everything you write here is stored locally on your device via IndexedDB (offline-first) and syncs directly with teammates using WebRTC. All sync traffic is end-to-end encrypted before it leaves your browser using AES-256-GCM. The signaling server never sees your plaintext.</p>
`;

export const Editor: React.FC<EditorProps> = ({
  doc,
  provider,
  username,
  onTitleChange,
  isLocked = false,
  lockedBy
}) => {
  const [title, setTitle] = useState('');

  // Sync title from Yjs
  useEffect(() => {
    const ytitle = doc.getText('title');
    setTitle(ytitle.toString());
    
    const handler = () => {
      const currentTitle = ytitle.toString();
      setTitle(currentTitle);
      queueMicrotask(() => onTitleChange(currentTitle));
    };
    
    ytitle.observe(handler);
    return () => {
      ytitle.unobserve(handler);
    };
  }, [doc, onTitleChange]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isLocked) return;
    const val = e.target.value;
    setTitle(val);
    const ytitle = doc.getText('title');
    
    doc.transact(() => {
      ytitle.delete(0, ytitle.length);
      ytitle.insert(0, val);
    });
    onTitleChange(val);
  };

  // Configure TipTap Editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // TipTap v3: Collaboration owns undo/redo
        undoRedo: false,
      }),
      Collaboration.configure({
        document: doc,
      }),
      CollaborationCaret.configure({
        provider: provider,
        user: provider.awareness.getLocalState()?.user || {
          name: username,
          color: '#8b5cf6'
        }
      })
    ],
    editorProps: {
      attributes: {
        class: 'ProseMirror',
        'data-placeholder': 'Start writing your zero-knowledge document...',
      }
    },
    editable: !isLocked
  }, [doc, provider]);

  // Cleanup editor on unmount
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  // Sync editor editable state when lock changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isLocked);
    }
  }, [editor, isLocked]);

  // Apply template content or welcome seed once when empty
  useEffect(() => {
    if (!editor || !editor.isEmpty) return;

    const templateContent = sessionStorage.getItem('vaultdocs_template_content');
    if (templateContent) {
      sessionStorage.removeItem('vaultdocs_template_content');
      editor.commands.setContent(templateContent);
      return;
    }

    if (title === 'Welcome to VaultDocs') {
      editor.commands.setContent(WELCOME_HTML);
    }
  }, [editor, title]);

  if (!editor) return null;

  return (
    <div className="editor-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {isLocked && (
        <div className="lock-banner">
          <Lock size={14} />
          This document is locked{lockedBy ? ` by ${lockedBy}` : ''} on this device. Editing is disabled locally (lock is not yet synced to peers).
        </div>
      )}
      <div className="editor-container" style={{ maxWidth: '780px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        <div 
          className="static-toolbar" 
          style={{ 
            display: 'flex', 
            gap: '4px', 
            padding: '6px 8px', 
            backgroundColor: 'var(--bg-secondary)', 
            border: '1px solid var(--border-color)', 
            borderRadius: '8px',
            alignItems: 'center',
            opacity: isLocked ? 0.5 : 1,
            pointerEvents: isLocked ? 'none' : 'auto'
          }}
        >
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`toolbar-btn ${editor.isActive('bold') ? 'active' : ''}`}
            title="Bold"
            type="button"
          >
            <Bold size={15} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`toolbar-btn ${editor.isActive('italic') ? 'active' : ''}`}
            title="Italic"
            type="button"
          >
            <Italic size={15} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={`toolbar-btn ${editor.isActive('code') ? 'active' : ''}`}
            title="Inline Code"
            type="button"
          >
            <Code size={15} />
          </button>
          <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-color)', margin: '0 6px' }} />
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`toolbar-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
            title="Heading 1"
            type="button"
          >
            <Heading1 size={15} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`toolbar-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
            title="Heading 2"
            type="button"
          >
            <Heading2 size={15} />
          </button>
          <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-color)', margin: '0 6px' }} />
          <button
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={`toolbar-btn ${editor.isActive('blockquote') ? 'active' : ''}`}
            title="Blockquote"
            type="button"
          >
            <Quote size={15} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={`toolbar-btn ${editor.isActive('codeBlock') ? 'active' : ''}`}
            title="Code Block"
            type="button"
          >
            <Terminal size={15} />
          </button>
        </div>

        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder="Untitled Document"
          className="editor-title-input"
          readOnly={isLocked}
          style={isLocked ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
        />

        <EditorContent editor={editor} />
      </div>
    </div>
  );
};
