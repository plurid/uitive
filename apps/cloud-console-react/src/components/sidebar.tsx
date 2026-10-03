import type { View, Via } from '@plurid/aptuitive-core';
import { useSurface } from '@plurid/aptuitive-react';
import { categories, services } from '../catalogue.ts';
import { aptuitive } from '../client.ts';

interface SidebarProps {
  view: View;
  current: string | undefined;
  onOpen(id: string, via: Via): void;
  onHome(): void;
  onCatalogue(): void;
}

export function Sidebar({ view, current, onOpen, onHome, onCatalogue }: SidebarProps) {
  const yours = useSurface(aptuitive, 'services');
  return (
    <nav className="sidebar" aria-label="Services">
      <button
        type="button"
        className={current === undefined ? 'nav-item active' : 'nav-item'}
        onClick={onHome}
      >
        {view === 'standard' ? 'Console home' : 'Your console'}
      </button>

      {view === 'standard' ? (
        categories.map((category) => (
          <section key={category.id} className="nav-group">
            <h2 className="nav-heading">{category.label}</h2>
            {category.services.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={current === id ? 'nav-item active' : 'nav-item'}
                onClick={() => onOpen(id, 'region')}
              >
                {label}
              </button>
            ))}
          </section>
        ))
      ) : (
        <section className="nav-group">
          <h2 className="nav-heading">Your services</h2>
          {yours.visible.map((service) => (
            <button
              key={service.id}
              type="button"
              className={current === service.id ? 'nav-item active' : 'nav-item'}
              onClick={() => onOpen(service.id, 'region')}
            >
              <span>{service.label}</span>
              {service.pinned && <span className="marker">pinned</span>}
              {service.moved && !service.pinned && <span className="marker new">new</span>}
            </button>
          ))}
          <button type="button" className="nav-item all" onClick={onCatalogue}>
            All services <span className="count">{services.length}</span>
          </button>
        </section>
      )}
    </nav>
  );
}
