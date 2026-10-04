import { useState } from 'react';
import { categories, services } from '../catalog.ts';

interface CatalogProps {
  onOpen(id: string): void;
  onClose(): void;
}

/** Every service, one search away: overflow for the sidebar. */
export function Catalog({ onOpen, onClose }: CatalogProps) {
  const [query, setQuery] = useState('');
  const wanted = query.trim().toLowerCase();
  const matches = (label: string, description: string) =>
    wanted === '' || `${label} ${description}`.toLowerCase().includes(wanted);
  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        className="dialog catalog"
        role="dialog"
        aria-modal="true"
        aria-label="All services"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <div className="dialog-head">
          <h2>All services</h2>
          <span className="faint">
            {services.length} services in {categories.length} categories
          </span>
          <button type="button" className="close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <input
          className="dialog-search"
          placeholder="Filter services"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="catalog-grid">
          {categories.map((category) => {
            const shown = category.services.filter(([, label, description]) =>
              matches(label, description),
            );
            if (shown.length === 0) return null;
            return (
              <section key={category.id}>
                <h3>{category.label}</h3>
                {shown.map(([id, label]) => (
                  <button key={id} type="button" className="link" onClick={() => onOpen(id)}>
                    {label}
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
