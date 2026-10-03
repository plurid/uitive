import { Page, useStandard, useSurface } from '@plurid/uitive-react';
import { byId } from '../catalogue.ts';
import { uitive } from '../client.ts';
import { useConsole } from '../console.tsx';

export function ServicePage({ id, onHome }: { id: string; onHome(): void }) {
  const { view } = useConsole();
  const yours = useSurface(uitive, 'servicePage', id);
  const standard = useStandard(uitive, 'servicePage', id);
  const service = byId.get(id);
  if (!service) return null;
  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <button type="button" className="link" onClick={onHome}>
          Console
        </button>
        <span aria-hidden="true">/</span>
        <span>{service.categoryLabel}</span>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{service.label}</span>
      </nav>
      <div className="page-head">
        <h1>{service.label}</h1>
        <p className="muted">{service.description}</p>
      </div>
      <Page value={view === 'standard' ? standard : yours} blocks={{}} context={id} current={id} />
      <p className="faint footnote">
        A demonstration: actions are simulated and nothing is created.
      </p>
    </div>
  );
}
