import React from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (query: string) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ value, onChange }) => {
  return (
    <div className="search-bar-wrapper">
      <Search size={14} className="search-icon" />
      <input
        type="text"
        className="search-input"
        placeholder="Search documents..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button className="search-clear-btn" onClick={() => onChange('')} title="Clear search">
          <X size={12} />
        </button>
      )}
    </div>
  );
};
