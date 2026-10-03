import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { View, Via } from '@plurid/uitive-core';
import { UitiveProvider, Confirmations, useSurface, useView } from '@plurid/uitive-react';
import { byId, services, totalActions, verbs, type Verb } from './catalogue.ts';
import { uitive, handlers } from './client.ts';
import { Catalogue } from './components/catalogue.tsx';
import { Header } from './components/header.tsx';
import { Home } from './components/home.tsx';
import { ConsoleContext, type Console } from './console.tsx';
import { Palette } from './components/palette.tsx';
import { ServicePage } from './components/service-page.tsx';
import { Sidebar } from './components/sidebar.tsx';
import { Toasts, useToasts } from './components/toasts.tsx';
import type { QuickAction } from './contract.ts';
import { consoleKit } from './kit.tsx';
import { personas } from './personas.ts';

type Route = { page: 'home' } | { page: 'service'; id: string };
type Panel = 'none' | 'interface' | 'debug';

export function App() {
  const view = useView(uitive);
  const density = useSurface(uitive, 'density');
  const yours = useSurface(uitive, 'services');
  const [route, setRoute] = useState<Route>({ page: 'home' });
  const [catalogue, setCatalogue] = useState(false);
  const [palette, setPalette] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');
  const { toasts, push } = useToasts();
  const current = route.page === 'service' ? route.id : undefined;

  const here = useRef(current);
  useEffect(() => {
    here.current = current;
  }, [current]);

  // Runs from anywhere, the console's controls or a generated page, end up here.
  useEffect(() => {
    handlers.open = (id) => {
      uitive.setContext('service', id);
      setRoute({ page: 'service', id });
    };
    handlers.run = (verb) => {
      const service = here.current === undefined ? undefined : byId.get(here.current);
      const message = `${verbs[verb as Verb]?.[0] ?? verb}${service ? ` · ${service.label}` : ''} (simulated)`;
      push(message);
      return message;
    };
    handlers.navigate = (href) => {
      const match = /^\/services\/([^/?#]+)/.exec(href);
      if (match?.[1]) handlers.open(decodeURIComponent(match[1]));
      else if (href === '/') {
        uitive.setContext('service', undefined);
        setRoute({ page: 'home' });
      }
    };
  }, [push]);

  // The console's own controls run actions too, so usage is recorded without record() calls.
  const open = useCallback((id: string, via: Via, typed?: boolean) => {
    void uitive.perform(id, undefined, {
      origin: 'native',
      via,
      surface: 'services',
      ...(typed === undefined ? {} : { typed }),
    });
  }, []);

  const home = useCallback(() => {
    uitive.setContext('service', undefined);
    setRoute({ page: 'home' });
  }, []);

  const run = useCallback(async (verb: string, via: Via, typed?: boolean, on?: string) => {
    // An action on another service than the open one happens in that service's context.
    if (on !== undefined) uitive.setContext('service', on);
    await uitive.perform(verb, undefined, {
      origin: 'native',
      via,
      surface: 'serviceToolbar',
      ...(typed === undefined ? {} : { typed }),
    });
    if (on !== undefined) uitive.setContext('service', here.current);
  }, []);

  const runQuick = useCallback(
    async (quick: QuickAction) => {
      for (const step of quick.steps) {
        uitive.setContext('service', step.service);
        await uitive.perform(step.verb, undefined, {
          origin: 'native',
          via: 'shortcut',
          surface: 'serviceToolbar',
        });
      }
      uitive.setContext('service', here.current);
      push(`${quick.label}: ${quick.steps.length} steps simulated`);
    },
    [push],
  );

  const ask = useCallback((text: string) => void uitive.ask(text), []);
  const consoleValue = useMemo<Console>(
    () => ({
      view,
      current,
      open: (id, via) => open(id, via),
      run: (verb, via, service) => void run(verb, via, undefined, service),
      runQuick: (quick) => void runQuick(quick),
      ask: (text, options) => uitive.ask(text, options),
    }),
    [view, current, open, run, runQuick],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((shown) => !shown);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openService = current === undefined ? undefined : byId.get(current);
  const counts = {
    standard: `${services.length} services · ${totalActions.toLocaleString('en')} actions`,
    yours: `${yours.visible.length} services · ${openService ? 'this page' : 'home'} designed for you · everything else one search away`,
  };

  return (
    <UitiveProvider client={uitive} kit={consoleKit}>
      <ConsoleContext.Provider value={consoleValue}>
        <div className="console" data-density={density} data-view={view}>
          <Header
            view={view}
            counts={counts}
            panel={panel}
            onView={(next: View) => uitive.setView(next)}
            onSearch={() => setPalette(true)}
            onPanel={(next) => setPanel((shown) => (shown === next ? 'none' : next))}
            onHome={home}
          />
          <div className="console-body">
            <Sidebar
              view={view}
              current={current}
              onOpen={(id, via) => open(id, via)}
              onHome={home}
              onCatalogue={() => setCatalogue(true)}
            />
            <main className="console-main">
              {route.page === 'home' ? <Home /> : <ServicePage id={route.id} onHome={home} />}
            </main>
            {panel === 'interface' && (
              <aside className="side-panel" aria-label="Your interface">
                <uitive-your-interface client={uitive} />
              </aside>
            )}
          </div>
          {panel === 'debug' && (
            <div className="debug-dock">
              <uitive-debug client={uitive} personas={personas} />
            </div>
          )}
          {catalogue && (
            <Catalogue
              onOpen={(id) => {
                setCatalogue(false);
                open(id, view === 'standard' ? 'region' : 'overflow');
              }}
              onClose={() => setCatalogue(false)}
            />
          )}
          {palette && (
            <Palette
              service={current}
              onOpen={(id, typed) => open(id, 'palette', typed)}
              onRun={(verb, typed) => void run(verb, 'palette', typed)}
              onAsk={ask}
              onClose={() => setPalette(false)}
            />
          )}
          <uitive-banner client={uitive} />
          <Confirmations />
          <Toasts toasts={toasts} />
        </div>
      </ConsoleContext.Provider>
    </UitiveProvider>
  );
}
