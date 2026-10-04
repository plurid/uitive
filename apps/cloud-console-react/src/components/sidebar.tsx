import type { View, Via } from '@plurid/uitive-core';
import { useSurface } from '@plurid/uitive-react';
import { categories, services } from '../catalog.ts';
import { uitive } from '../client.ts';
import { MadeWith } from './made-with.tsx';

interface SidebarProps {
  view: View;
  current: string | undefined;
  /** Whether the drawer is open, on screens too narrow for the sidebar. */
  open: boolean;
  onOpen(id: string, via: Via): void;
  onHome(): void;
  onCatalog(): void;
}

export function Sidebar({ view, current, open, onOpen, onHome, onCatalog }: SidebarProps) {
  const yours = useSurface(uitive, 'services');
  return (
    <div className={open ? 'sidebar open' : 'sidebar'} id="services">
      <nav className="sidebar-nav" aria-label="Services">
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
            <button type="button" className="nav-item all" onClick={onCatalog}>
              All services <span className="count">{services.length}</span>
            </button>
          </section>
        )}
      </nav>
      <MadeWith />
    </div>
  );
}
