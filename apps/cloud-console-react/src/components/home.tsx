import { Page, useSurface } from '@plurid/aptuitive-react';
import { categories, services } from '../catalogue.ts';
import { aptuitive } from '../client.ts';
import { useConsole } from '../console.tsx';
import { components } from './blocks.tsx';

/** The home page as shipped: every service, all at once. */
function Everything() {
  const { open } = useConsole();
  return (
    <div className="catalogue-block">
      {categories.map((entry) => (
        <section key={entry.id} className="tile-section">
          <h2>{entry.label}</h2>
          <div className="tiles dense">
            {entry.services.map(([id, label, description]) => (
              <button key={id} type="button" className="tile" onClick={() => open(id, 'region')}>
                <span className="tile-title">{label}</span>
                <span className="tile-text">{description}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function Home() {
  const { view } = useConsole();
  const yours = useSurface(aptuitive, 'home');
  return (
    <div className="page">
      <div className="page-head">
        <h1>{view === 'standard' ? 'Console home' : 'Your console'}</h1>
        <p className="muted">
          {view === 'standard' ? (
            `${services.length} services in ${categories.length} categories. Pick one to get started.`
          ) : (
            <>
              Designed around how you work. Ask for any change with <kbd>⌘K</kbd>.
            </>
          )}
        </p>
      </div>
      {view === 'standard' ? <Everything /> : <Page value={yours} blocks={components} />}
    </div>
  );
}
