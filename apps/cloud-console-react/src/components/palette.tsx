import { useMemo, useState } from 'react';
import { useRanked } from '@plurid/uitive-react';
import { byId } from '../catalogue.ts';
import { uitive } from '../client.ts';

interface PaletteProps {
  service: string | undefined;
  onOpen(id: string, typed: boolean): void;
  onRun(verb: string, typed: boolean): void;
  onAsk(text: string): void;
  onClose(): void;
}

interface Entry {
  key: string;
  label: string;
  detail: string;
  run(): void;
}

/** Search ranked by how this person works; anything else, they can simply ask for. */
export function Palette({ service, onOpen, onRun, onAsk, onClose }: PaletteProps) {
  const ranked = useRanked(uitive);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const typed = query.trim().length > 0;
  const here = service === undefined ? undefined : byId.get(service);

  const entries = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const found: Entry[] = [];
    for (const action of ranked) {
      const verb = here?.verbs.some((candidate) => candidate === action.id);
      const isService = byId.has(action.id);
      if (!isService && !verb) continue;
      if (wanted && !`${action.label} ${action.description}`.toLowerCase().includes(wanted))
        continue;
      found.push({
        key: action.id,
        label: isService ? action.label : `${action.label} · ${here?.label}`,
        detail: isService ? (action.group ?? '') : action.description,
        run: () => (isService ? onOpen(action.id, typed) : onRun(action.id, typed)),
      });
      if (found.length >= 8) break;
    }
    if (query.trim().split(/\s+/).length >= 2 || (wanted && found.length === 0)) {
      found.push({
        key: 'ask',
        label: `Ask: “${query.trim()}”`,
        detail: 'Change your console in your own words',
        run: () => onAsk(query.trim()),
      });
    }
    return found;
  }, [ranked, query, here, typed, onOpen, onRun, onAsk]);

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    entry.run();
  };

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        className="dialog palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          className="dialog-search"
          placeholder={
            here ? `Search, or act on ${here.label}…` : 'Search services, or ask for a change…'
          }
          value={query}
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={entries[active] ? `palette-${entries[active].key}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, entries.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            }
            if (event.key === 'Enter') choose(entries[active]);
          }}
        />
        <ul id="palette-results" className="results" role="listbox">
          {entries.map((entry, index) => (
            <li
              key={entry.key}
              id={`palette-${entry.key}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'result active' : 'result'}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(entry)}
            >
              <span>{entry.label}</span>
              <span className="faint">{entry.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
