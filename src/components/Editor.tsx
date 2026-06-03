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
  Terminal 
} from 'lucide-react';

interface EditorProps {
  doc: Y.Doc;
  provider: any; // EncryptedWebrtcProvider
  username: string;
  onTitleChange: (newTitle: string) => void;
}

export const Editor: React.FC<EditorProps> = ({
  doc,
  provider,
  username,
  onTitleChange
}) => {
  const [title, setTitle] = useState('');

  // Sync title from Yjs
  useEffect(() => {
    const ytitle = doc.getText('title');
    setTitle(ytitle.toString());
    
    const handler = () => {
      const currentTitle = ytitle.toString();
      setTitle(currentTitle);
      onTitleChange(currentTitle);
    };
    
    ytitle.observe(handler);
    return () => {
      ytitle.unobserve(handler);
    };
  }, [doc, onTitleChange]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        // Disable history because Yjs handles undo/redo collaboration-wide
        history: false,
      } as any),
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
        placeholder: 'Start writing your zero-knowledge document...',
      }
    }
  }, [doc, provider]);

  // Cleanup editor on unmount
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="editor-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Sleek Fixed Format Toolbar */}
      <div className="editor-container" style={{ maxWidth: '780px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Sleek inline toolbar */}
        <div 
          className="static-toolbar" 
          style={{ 
            display: 'flex', 
            gap: '4px', 
            padding: '6px 8px', 
            backgroundColor: 'var(--bg-secondary)', 
            border: '1px solid var(--border-color)', 
            borderRadius: '8px',
            alignItems: 'center'
          }}
        >
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`toolbar-btn ${editor.isActive('bold') ? 'active' : ''}`}
            title="Bold"
          >
            <Bold size={15} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`toolbar-btn ${editor.isActive('italic') ? 'active' : ''}`}
            title="Italic"
          >
            <Italic size={15} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={`toolbar-btn ${editor.isActive('code') ? 'active' : ''}`}
            title="Inline Code"
          >
            <Code size={15} />
          </button>
          <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-color)', margin: '0 6px' }} />
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`toolbar-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
            title="Heading 1"
          >
            <Heading1 size={15} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`toolbar-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
            title="Heading 2"
          >
            <Heading2 size={15} />
          </button>
          <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-color)', margin: '0 6px' }} />
          <button
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={`toolbar-btn ${editor.isActive('blockquote') ? 'active' : ''}`}
            title="Blockquote"
          >
            <Quote size={15} />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={`toolbar-btn ${editor.isActive('codeBlock') ? 'active' : ''}`}
            title="Code Block"
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
        />

        <EditorContent editor={editor} />
      </div>
    </div>
  );
};
