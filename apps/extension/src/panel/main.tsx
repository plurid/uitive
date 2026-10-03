import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { pattern } from '../../manifest.ts';
import type { PageReport } from '../messages.ts';

interface Status {
  origin: string | null;
  adapter: { id: string; label: string } | null;
  allowed: boolean;
  enabled: boolean;
  connectors: { name: string; label: string; secret: { test: string; live: string } }[];
}
type Reply<T> = { ok: true; value: T } | { ok: false; problem: string };

const worker = async <T,>(message: object): Promise<T> => {
  const reply = (await chrome.runtime.sendMessage(message)) as Reply<T> | undefined;
  if (!reply) throw new Error('The extension is unavailable');
  if (!reply.ok) throw new Error(reply.problem);
  return reply.value;
};

const page = async <T,>(tabId: number, message: object): Promise<T> => {
  const reply = (await chrome.tabs.sendMessage(tabId, message)) as Reply<T> | undefined;
  if (!reply) throw new Error('The page isn’t ready; reload it');
  if (!reply.ok) throw new Error(reply.problem);
  return reply.value;
};

function KeyField(props: {
  label: string;
  hint: string;
  name: string;
  present: boolean;
  onChange(): void;
}) {
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState('');
  const save = async () => {
    setProblem('');
    try {
      await worker({ kind: 'secret.set', name: props.name, value: value.trim() });
      setValue('');
      props.onChange();
    } catch (error) {
      setProblem((error as Error).message);
    }
  };
  return (
    <div>
      <div className="row">
        <strong>{props.label}</strong>
        {props.present ? (
          <>
            <span className="muted">saved</span>
            <button
              type="button"
              className="link"
              onClick={() =>
                void worker({ kind: 'secret.clear', name: props.name }).then(props.onChange)
              }
            >
              Remove
            </button>
          </>
        ) : null}
      </div>
      {props.present ? null : (
        <div className="row">
          <input
            type="password"
            autoComplete="off"
            aria-label={props.label}
            placeholder={props.hint}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="button" onClick={() => void save()} disabled={value.trim() === ''}>
            Save
          </button>
        </div>
      )}
      {problem ? <p className="bad">{problem}</p> : null}
    </div>
  );
}

function Panel() {
  const [tabId, setTabId] = useState<number>();
  const [status, setStatus] = useState<Status>();
  const [report, setReport] = useState<
    PageReport & { failed?: { target: string; reason: string }[] }
  >();
  const [secrets, setSecrets] = useState<string[]>([]);
  const [usage, setUsage] = useState<{ reads: number; tokens: number; budget: number }>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [problem, setProblem] = useState('');

  const refresh = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    setTabId(tab.id);
    try {
      const found = await worker<Status>({ kind: 'site.status', tabId: tab.id });
      setStatus(found);
      setSecrets(await worker<string[]>({ kind: 'secret.status' }));
      setUsage(await worker({ kind: 'usage' }));
      if (found.enabled) {
        setReport(await page<PageReport>(tab.id, { kind: 'snapshot' }).catch(() => undefined));
      } else setReport(undefined);
    } catch (error) {
      setProblem((error as Error).message);
    }
  }, []);

  useEffect(() => {
    // The tab's state arrives like its later changes: from the browser, in a callback.
    const again = () => void refresh();
    const first = setTimeout(again, 0);
    chrome.tabs.onActivated.addListener(again);
    chrome.tabs.onUpdated.addListener(again);
    return () => {
      clearTimeout(first);
      chrome.tabs.onActivated.removeListener(again);
      chrome.tabs.onUpdated.removeListener(again);
    };
  }, [refresh]);

  const enableSite = async () => {
    if (!status?.origin || tabId === undefined) return;
    setProblem('');
    // The browser asks the person, for this one site only.
    const granted = await chrome.permissions.request({ origins: [pattern(status.origin)] });
    if (!granted) return;
    await worker({ kind: 'site.enable', origin: status.origin });
    await chrome.tabs.reload(tabId);
    setTimeout(() => void refresh(), 800);
  };

  const ask = async () => {
    if (tabId === undefined || text.trim() === '') return;
    setBusy(true);
    setProblem('');
    setAnswer('');
    try {
      const result = await page<{
        status: string;
        applied: number;
        candidates: string[];
        meta: { fellBack?: string; usage?: { input: number; output: number } } | null;
        report: PageReport;
      }>(tabId, { kind: 'ask', text: text.trim() });
      setReport(result.report);
      const tokens = result.meta?.usage ? result.meta.usage.input + result.meta.usage.output : 0;
      setAnswer(
        [
          result.status === 'done'
            ? `Done: ${result.applied} ${result.applied === 1 ? 'change' : 'changes'}.`
            : result.status === 'ambiguous'
              ? `Which did you mean: ${result.candidates.join(', ')}?`
              : 'That isn’t something this page allows.',
          tokens > 0 ? `${tokens.toLocaleString()} tokens.` : '',
          result.meta?.fellBack
            ? `The model didn’t answer (${result.meta.fellBack}), so simple commands were used.`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      setText('');
      setUsage(await worker({ kind: 'usage' }));
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (message: object) => {
    if (tabId === undefined) return;
    setReport(await page<PageReport>(tabId, message));
  };

  const [forgetting, setForgetting] = useState(false);
  const forget = async () => {
    setForgetting(false);
    await worker({ kind: 'forget' });
    if (tabId !== undefined) await chrome.tabs.reload(tabId);
    setTimeout(() => void refresh(), 800);
  };

  const [picking, setPicking] = useState('');
  const repair = async (anchor: string) => {
    if (tabId === undefined) return;
    setProblem('');
    setPicking(anchor);
    try {
      const result = await page<{ report: PageReport }>(tabId, { kind: 'pick', anchor });
      setReport(result.report);
    } catch (error) {
      if ((error as Error).message !== 'Cancelled') setProblem((error as Error).message);
    } finally {
      setPicking('');
    }
  };

  if (!status)
    return (
      <main>{problem ? <p className="bad">{problem}</p> : <p className="muted">Loading</p>}</main>
    );
  const anchors = Object.entries(report?.anchors ?? {});
  const missing = anchors.filter(([, state]) => state !== 'found');
  return (
    <main>
      <header className="row">
        <h1>Aptuitive</h1>
        <span className="muted">
          {status.adapter ? status.adapter.label : (status.origin ?? 'No page')}
        </span>
      </header>
      {problem ? <p className="bad">{problem}</p> : null}

      {!status.adapter ? (
        <p className="muted">There is no adapter for this site yet.</p>
      ) : !status.enabled ? (
        <section>
          <p>
            Aptuitive can reshape {status.adapter.label} on {status.origin}. It reads the
            page&apos;s structure, never its text, and changes nothing until you ask.
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={() => void enableSite()}>
              Enable on this site
            </button>
          </div>
        </section>
      ) : (
        <>
          <section>
            <h2>Ask</h2>
            <textarea
              aria-label="What would you like to change?"
              placeholder="For example: hide Connect and Billing, or make my home a morning check of failed payments, disputes and payouts"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void ask();
              }}
            />
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={busy || text.trim() === ''}
                onClick={() => void ask()}
              >
                {busy ? 'Working' : 'Ask'}
              </button>
              {answer ? <span className="muted">{answer}</span> : null}
            </div>
          </section>

          <section>
            <h2>Your interface</h2>
            {report && report.changes.length > 0 ? (
              <ul>
                {report.changes.map((change) => (
                  <li key={change.operation}>
                    <span>
                      {change.title}
                      <br />
                      <span className="muted">{change.reason}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void act({ kind: 'revert', operation: change.operation })}
                    >
                      Revert
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">The page as it ships. Ask for a change above.</p>
            )}
            <div className="row">
              <button
                type="button"
                onClick={() => void act({ kind: 'original', on: !report?.original })}
              >
                {report?.original ? 'Show my interface' : 'Show the original'}
              </button>
              <span className="muted">Alt+Shift+A on the page</span>
              {report && report.changes.length > 0 ? (
                <button type="button" className="link" onClick={() => void act({ kind: 'reset' })}>
                  Reset everything
                </button>
              ) : null}
            </div>
          </section>

          {report?.paused ? (
            <section>
              <p className="bad">{report.paused}</p>
              <div className="row">
                <button type="button" onClick={() => void act({ kind: 'resume' })}>
                  Resume
                </button>
              </div>
            </section>
          ) : null}

          <section>
            <h2>This page</h2>
            <p className="muted">
              {report ? `${report.route ?? 'An unmapped page'}, ${report.mode} mode. ` : ''}
              {anchors.length > 0
                ? `${anchors.length - missing.length} of ${anchors.length} parts found${missing.length > 0 ? `; not found: ${missing.map(([name, state]) => `${name} (${state})`).join(', ')}` : ''}.`
                : ''}
              {report && report.timing.syncs > 0
                ? ` Keeping up takes ${report.timing.p95} ms (95th percentile).`
                : ''}
            </p>
            {report?.failed && report.failed.length > 0 ? (
              <p className="bad">
                Couldn&apos;t apply:{' '}
                {report.failed.map((entry) => `${entry.target} (${entry.reason})`).join(', ')}.
              </p>
            ) : null}
            {missing.length > 0 ? (
              <div className="row">
                <span className="muted">Show Aptuitive where they are now:</span>
                {missing.map(([name]) => (
                  <button key={name} type="button" onClick={() => void repair(name)}>
                    Pick {name}
                  </button>
                ))}
              </div>
            ) : null}
            {picking ? <p className="muted">Click {picking} on the page; Esc cancels.</p> : null}
            {report && report.repairs.length > 0 ? (
              <div className="row">
                <span className="muted">Repaired on this device: {report.repairs.join(', ')}.</span>
                <button
                  type="button"
                  className="link"
                  onClick={() => void act({ kind: 'repairs.clear' })}
                >
                  Undo repairs
                </button>
              </div>
            ) : null}
          </section>

          <section>
            <h2>Keys</h2>
            <p className="muted">
              Kept in this browser only. The first model you have a key for plans what you ask:
              Claude, then OpenAI, then Gemini. Restricted keys read data for redesigned pages.
            </p>
            <KeyField
              label="Claude API key"
              hint="sk-ant-..."
              name="anthropic"
              present={secrets.includes('anthropic')}
              onChange={() => void refresh()}
            />
            <KeyField
              label="OpenAI API key"
              hint="sk-..."
              name="openai"
              present={secrets.includes('openai')}
              onChange={() => void refresh()}
            />
            <KeyField
              label="Gemini API key"
              hint="AIza..."
              name="google"
              present={secrets.includes('google')}
              onChange={() => void refresh()}
            />
            {status.connectors.map((connector) => (
              <KeyField
                key={connector.name}
                label={`${connector.label}, ${report?.mode ?? 'test'} mode (restricted, read only)`}
                hint={report?.mode === 'live' ? 'rk_live_...' : 'rk_test_...'}
                name={connector.secret[report?.mode ?? 'test']}
                present={secrets.includes(connector.secret[report?.mode ?? 'test'])}
                onChange={() => void refresh()}
              />
            ))}
            {usage ? (
              <p className="muted">
                This month: {usage.reads.toLocaleString()} of {usage.budget.toLocaleString()} reads,{' '}
                {usage.tokens.toLocaleString()} tokens.
              </p>
            ) : null}
          </section>

          <section>
            <h2>Your data</h2>
            <p className="muted">
              Your interfaces, repairs and usage counts stay in this browser; rows read from APIs
              stay in memory only.
            </p>
            {forgetting ? (
              <div className="row">
                <span>Erase everything Aptuitive keeps here, keys included?</span>
                <button type="button" className="primary" onClick={() => void forget()}>
                  Erase
                </button>
                <button type="button" onClick={() => setForgetting(false)}>
                  Keep it
                </button>
              </div>
            ) : (
              <div className="row">
                <button type="button" onClick={() => setForgetting(true)}>
                  Forget everything
                </button>
              </div>
            )}
          </section>

          <section>
            <details>
              <summary>What the last request sent</summary>
              <pre>
                {report?.lastRequest ? JSON.stringify(report.lastRequest, null, 2) : 'Nothing yet.'}
              </pre>
            </details>
          </section>
        </>
      )}
    </main>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Panel />
    </StrictMode>,
  );
}
