import type { View } from '@plurid/uitive-core';

interface HeaderProps {
  view: View;
  counts: { standard: string; yours: string };
  panel: 'none' | 'interface' | 'debug';
  onView(view: View): void;
  onSearch(): void;
  onPanel(panel: 'interface' | 'debug'): void;
  onHome(): void;
  nav: boolean;
  onMenu(): void;
}

export function Header({
  view,
  counts,
  panel,
  onView,
  onSearch,
  onPanel,
  onHome,
  nav,
  onMenu,
}: HeaderProps) {
  return (
    <header className="header">
      {/* Narrow screens only: the sidebar becomes a drawer behind this. */}
      <button
        type="button"
        className="menu-button"
        aria-label="Services"
        aria-expanded={nav}
        aria-controls="services"
        onClick={onMenu}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <button type="button" className="brand" onClick={onHome}>
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Acme Cloud</span>
        <span className="brand-tag">fictional</span>
      </button>

      <button
        type="button"
        className="search"
        aria-label="Search services and actions"
        onClick={onSearch}
      >
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.4-4.4" />
        </svg>
        <span>Search services and actions</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="view-switch">
        <div className="segmented" role="radiogroup" aria-label="Interface">
          {(['standard', 'yours'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={view === option}
              className={view === option ? 'segment active' : 'segment'}
              onClick={() => onView(option)}
            >
              {option === 'standard' ? 'Standard' : 'Yours'}
            </button>
          ))}
        </div>
        <span className="view-count">{view === 'standard' ? counts.standard : counts.yours}</span>
      </div>

      <div className="header-actions">
        <button
          type="button"
          className={panel === 'interface' ? 'header-button active' : 'header-button'}
          aria-pressed={panel === 'interface'}
          onClick={() => onPanel('interface')}
        >
          Your interface
        </button>
        <button
          type="button"
          className={panel === 'debug' ? 'header-button active' : 'header-button'}
          aria-pressed={panel === 'debug'}
          onClick={() => onPanel('debug')}
        >
          Debug
        </button>
      </div>
    </header>
  );
}
