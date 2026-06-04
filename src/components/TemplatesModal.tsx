import React, { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import { listTemplates } from '../db/db';
import type { DocTemplate } from '../db/db';

interface TemplatesModalProps {
  onClose: () => void;
  onSelectTemplate: (template: DocTemplate) => void;
}

const categoryColors: Record<string, string> = {
  'Collaboration': '#0066ff',
  'Planning':      '#10b981',
  'Operations':    '#f59e0b',
  'Engineering':   '#8b5cf6',
  'Reporting':     '#ef4444'
};

export const TemplatesModal: React.FC<TemplatesModalProps> = ({ onClose, onSelectTemplate }) => {
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  useEffect(() => {
    listTemplates().then(setTemplates);
  }, []);

  const categories = ['All', ...Array.from(new Set(templates.map(t => t.category)))];
  const visible = selectedCategory === 'All'
    ? templates
    : templates.filter(t => t.category === selectedCategory);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content templates-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Document Templates</h3>
          <p className="modal-subtitle">Choose a template to start with pre-filled structure</p>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Category filter */}
        <div className="template-categories">
          {categories.map(cat => (
            <button
              key={cat}
              className={`template-category-btn ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Template grid */}
        <div className="templates-grid">
          {visible.map(template => (
            <button
              key={template.id}
              className="template-card"
              onClick={() => onSelectTemplate(template)}
            >
              <div
                className="template-card-icon"
                style={{ backgroundColor: `${categoryColors[template.category] || '#0066ff'}14`, color: categoryColors[template.category] || '#0066ff' }}
              >
                <FileText size={20} />
              </div>
              <div className="template-card-body">
                <span
                  className="template-category-tag"
                  style={{ color: categoryColors[template.category] || '#0066ff', backgroundColor: `${categoryColors[template.category] || '#0066ff'}14` }}
                >
                  {template.category}
                </span>
                <h4 className="template-name">{template.name}</h4>
                <p className="template-description">{template.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
