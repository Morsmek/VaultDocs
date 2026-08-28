import React, { useState, useRef, useEffect } from 'react';
import { Download, FileText, FileCode, ChevronDown } from 'lucide-react';

interface ExportMenuProps {
  docTitle: string;
}

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, '> $1\n\n')
    .replace(/<pre[^>]*>(.*?)<\/pre>/gis, '```\n$1\n```\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const ExportMenu: React.FC<ExportMenuProps> = ({ docTitle }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExportPDF = () => {
    const originalTitle = document.title;
    document.title = docTitle || 'VaultDocs Export';
    window.print();
    document.title = originalTitle;
    setOpen(false);
  };

  const handleExportMarkdown = () => {
    const editorEl = document.querySelector('.ProseMirror');
    if (!editorEl) return;
    const html = editorEl.innerHTML;
    const markdown = `# ${docTitle}\n\n${htmlToMarkdown(html)}`;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docTitle || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  return (
    <div className="export-menu" ref={ref}>
      <button className="btn-invite-outline" onClick={() => setOpen(v => !v)}>
        <Download size={14} />
        Export
        <ChevronDown size={12} style={{ marginLeft: '2px', opacity: 0.7 }} />
      </button>
      {open && (
        <div className="export-dropdown">
          <button className="export-option" onClick={handleExportPDF}>
            <FileText size={14} />
            <div>
              <span className="export-option-title">Export as PDF</span>
              <span className="export-option-desc">Print-ready PDF via browser</span>
            </div>
          </button>
          <button className="export-option" onClick={handleExportMarkdown}>
            <FileCode size={14} />
            <div>
              <span className="export-option-title">Export as Markdown</span>
              <span className="export-option-desc">Download .md file</span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
};
