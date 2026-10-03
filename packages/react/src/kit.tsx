'use client';
import { useId, useState, type ComponentType, type ReactNode } from 'react';
import { formatValue, humanise, type Field } from '@plurid/uitive-core';

/** One column of a kit `Table`: the key its cells are under, its header, and how it aligns. */
export interface TableColumn {
  /** The key each row's cell for this column is under. */
  key: string;
  /** The column's header. */
  label: string;
  /** `end` for figures, so they line up. */
  align?: 'start' | 'end';
}

/** One row of a kit `Table`: its cells by column key, its actions, and how to open it. */
export interface TableRow {
  /** The row's key, for React and for actions. */
  key: string;
  /** The row's cells, by column key, already formatted. */
  cells: Readonly<Record<string, ReactNode>>;
  /** Buttons for the row's actions. */
  actions?: ReactNode;
  /** Opens the row's own page. */
  onOpen?: () => void;
}

/**
 * One item of a kit `List`: a title, optional details and a badge, its actions, and how to open it.
 */
export interface ListItem {
  /** The item's key, for React and for actions. */
  key: string;
  /** What the item is called. */
  title: ReactNode;
  /** A second line. */
  subtitle?: ReactNode;
  /** A detail beside the item, such as a time. */
  meta?: ReactNode;
  /** A badge, such as a status. */
  badge?: ReactNode;
  /** Buttons for the item's actions. */
  actions?: ReactNode;
  /** Opens the item's own page. */
  onOpen?: () => void;
}

/** One point of a chart series. */
export interface ChartPoint {
  /** A time in milliseconds, or a category. */
  x: number | string;
  /** The point's label, as people read it. */
  label: string;
  /** Its value. */
  y: number;
}

/** One series of a kit `Chart`, such as one value of a split. */
export interface ChartSeries {
  /** The series' name, for its legend. */
  name: string;
  /** Its points, in order. */
  points: readonly ChartPoint[];
}

/** What a value renderer gets: the field and its value, and the currency for money. */
export interface ValueProps {
  /** The field, with its type and meaning. */
  field: Field;
  /** The stored value, such as an amount in cents. */
  value: unknown;
  /** For money: the currency the value is in. */
  currency?: string;
}

/**
 * The presentational parts every generic block is drawn with. Map them to a design system once,
 * one at a time if need be, and Uitive's blocks look native.
 */
export interface Kit {
  /** Parts one above another, such as a form's fields and its button. */
  Stack: ComponentType<{ children?: ReactNode }>;
  /** A page's title, from its root section; the page's own heading. */
  Title: ComponentType<{ children?: ReactNode }>;
  /**
   * A page's section: its title, and its blocks laid out as a stack, a grid or columns. Map it to
   * the design system's container and heading; `depth` is 1 for a page's top-level sections.
   */
  Section: ComponentType<{
    title: string;
    layout: 'stack' | 'grid' | 'columns';
    depth: number;
    count: number;
    children?: ReactNode;
  }>;
  /** Parts side by side in columns, such as a detail block's fields or a board's columns. */
  Grid: ComponentType<{ children?: ReactNode; columns?: number }>;
  /** A framed part with an optional title, such as a note or a board's column. */
  Card: ComponentType<{ title?: string; children?: ReactNode }>;
  /** A section whose children show one at a time, each under its tab. */
  Tabs: ComponentType<{
    label?: string;
    tabs: readonly { id: string; title: string; content: ReactNode }[];
  }>;
  /** A run of text, plain, muted or strong. */
  Text: ComponentType<{ children?: ReactNode; tone?: 'muted' | 'strong' }>;
  /** Rows under column headers: the table block, with row actions in its cells. */
  Table: ComponentType<{
    columns: readonly TableColumn[];
    rows: readonly TableRow[];
    density?: 'comfortable' | 'compact';
    caption?: string;
  }>;
  /** Rows as a list, each with a title, a subtitle, a badge and its own actions. */
  List: ComponentType<{ items: readonly ListItem[] }>;
  /** One figure with its label: the metric block. */
  Stat: ComponentType<{
    label: string;
    value: ReactNode;
    /** Change against the previous period, as a fraction: 0.12 is 12% up. */
    change?: number;
    /** The number counts what loaded, so the true figure is at least this. */
    partial?: boolean;
  }>;
  /** Series drawn as lines, bars, areas or a pie. */
  Chart: ComponentType<{
    kind: 'line' | 'bar' | 'area' | 'pie';
    series: readonly ChartSeries[];
    stacked?: boolean;
    label?: string;
  }>;
  /** A short label with a tone, such as a status. */
  Badge: ComponentType<{ children?: ReactNode; tone?: 'neutral' | 'good' | 'warning' | 'bad' }>;
  /** One value, shown by its type, such as money with its currency or a reference by name. */
  Value: ComponentType<ValueProps>;
  /** A button: row actions, the actions block and dialogs use it. */
  Button: ComponentType<{
    children?: ReactNode;
    onClick?: () => void;
    tone?: 'primary' | 'plain' | 'danger';
    size?: 'small' | 'regular' | 'large';
    disabled?: boolean;
    type?: 'button' | 'submit';
  }>;
  /** A link to a route, followed through the application's router. */
  Link: ComponentType<{ href: string; children?: ReactNode; onClick?: () => void }>;
  /** A labelled input for one field, such as an action's param in a form. */
  Field: ComponentType<{
    field: Field;
    value: string;
    onChange: (value: string) => void;
    label?: string;
    required?: boolean;
  }>;
  /** A modal with a title, for confirmations and the forms of actions run from a row. */
  Dialog: ComponentType<{ title: string; children?: ReactNode; onClose: () => void }>;
  /**
   * What happened when an action ran from a generated page. Map it to the design system's toast or
   * alert: each run mounts a new one, so a toast can show itself on mount and render nothing.
   */
  Notice: ComponentType<{ tone: 'success' | 'error'; children?: ReactNode }>;
  /** What a block shows around or instead of data: no rows, loading, an error, or a partial result. */
  Status: ComponentType<{ state: 'empty' | 'loading' | 'error' | 'partial'; message?: string }>;
}

function Tabs({
  label,
  tabs,
}: {
  label?: string;
  tabs: readonly { id: string; title: string; content: ReactNode }[];
}) {
  const [active, setActive] = useState(0);
  const current = tabs[Math.min(active, tabs.length - 1)];
  return (
    <div className="uitive-tabs">
      {label && <h2 className="uitive-section-title">{label}</h2>}
      <div role="tablist" aria-label={label || undefined}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab === current}
            onClick={() => setActive(index)}
          >
            {tab.title}
          </button>
        ))}
      </div>
      {current && <div role="tabpanel">{current.content}</div>}
    </div>
  );
}

function Chart({
  kind,
  series,
  stacked,
  label,
}: {
  kind: 'line' | 'bar' | 'area' | 'pie';
  series: readonly ChartSeries[];
  stacked?: boolean;
  label?: string;
}) {
  const width = 320;
  const height = 140;
  const xs = [...new Set(series.flatMap((entry) => entry.points.map((point) => point.label)))];
  if (xs.length === 0) return <Status state="empty" />;
  const at = (entry: ChartSeries, x: string) =>
    entry.points.find((point) => point.label === x)?.y ?? 0;
  if (kind === 'pie') {
    const first = series[0];
    const total = first?.points.reduce((sum, point) => sum + Math.max(0, point.y), 0) ?? 0;
    let angle = -Math.PI / 2;
    return (
      <figure className="uitive-chart" data-kind="pie">
        <svg viewBox="-60 -60 120 120" role="img" aria-label={label}>
          {first?.points.map((point, index) => {
            const sweep = total === 0 ? 0 : (Math.max(0, point.y) / total) * Math.PI * 2;
            const start = angle;
            angle += sweep;
            const large = sweep > Math.PI ? 1 : 0;
            const path = `M0 0 L${50 * Math.cos(start)} ${50 * Math.sin(start)} A50 50 0 ${large} 1 ${50 * Math.cos(angle)} ${50 * Math.sin(angle)} Z`;
            return (
              <path key={point.label} d={path} data-series={index}>
                <title>{`${point.label}: ${point.y}`}</title>
              </path>
            );
          })}
        </svg>
        <figcaption>{first?.points.map((point) => point.label).join(', ')}</figcaption>
      </figure>
    );
  }
  const totals = xs.map((x) =>
    stacked
      ? series.reduce((sum, entry) => sum + at(entry, x), 0)
      : Math.max(...series.map((entry) => at(entry, x))),
  );
  const top = Math.max(1, ...totals);
  const step = width / xs.length;
  const y = (value: number) => height - (value / top) * (height - 8);
  return (
    <figure className="uitive-chart" data-kind={kind}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
      >
        {kind === 'bar'
          ? xs.flatMap((x, index) => {
              let base = 0;
              return series.map((entry, which) => {
                const value = at(entry, x);
                const barWidth = stacked ? step * 0.7 : (step * 0.7) / series.length;
                const left = index * step + step * 0.15 + (stacked ? 0 : which * barWidth);
                const bottom = stacked ? base : 0;
                if (stacked) base += value;
                return (
                  <rect
                    key={`${x}.${entry.name}`}
                    x={left}
                    y={y(bottom + value)}
                    width={barWidth}
                    height={Math.max(0, y(bottom) - y(bottom + value))}
                    data-series={which}
                  >
                    <title>{`${entry.name ? `${entry.name}, ` : ''}${x}: ${value}`}</title>
                  </rect>
                );
              });
            })
          : series.map((entry, which) => {
              const points = xs
                .map((x, index) => `${index * step + step / 2},${y(at(entry, x))}`)
                .join(' ');
              return kind === 'area' ? (
                <polygon
                  key={entry.name}
                  points={`${step / 2},${height} ${points} ${(xs.length - 0.5) * step},${height}`}
                  data-series={which}
                />
              ) : (
                <polyline key={entry.name} points={points} fill="none" data-series={which} />
              );
            })}
      </svg>
      <figcaption>
        <span>{xs[0]}</span>
        <span>{xs[xs.length - 1]}</span>
      </figcaption>
    </figure>
  );
}

function Status({
  state,
  message,
}: {
  state: 'empty' | 'loading' | 'error' | 'partial';
  message?: string;
}) {
  const text =
    message ??
    {
      empty: 'Nothing here yet',
      loading: 'Loading',
      error: 'This could not load',
      partial: 'Showing what loaded so far',
    }[state];
  return (
    <div className="uitive-status" data-state={state} role={state === 'error' ? 'alert' : 'status'}>
      {text}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  label,
  required,
}: {
  field: Field;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
}) {
  const id = useId();
  const text = label ?? field.label;
  if (field.type === 'bool') {
    return (
      <label className="uitive-field" data-type="bool">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(event) => onChange(String(event.target.checked))}
        />
        <span>{text}</span>
      </label>
    );
  }
  return (
    <div className="uitive-field" data-type={field.type}>
      <label htmlFor={id}>{text}</label>
      {field.type === 'enum' ? (
        <select
          id={id}
          value={value}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" disabled>
            Choose
          </option>
          {field.values.map((option) => (
            <option key={option} value={option}>
              {humanise(option)}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.type === 'number' || field.type === 'money' ? 'number' : 'text'}
          step="any"
          value={value}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

/** Semantic HTML with `uitive-*` classes, themed through `--uitive-*` custom properties. */
export const defaultKit: Kit = {
  Stack: ({ children }) => <div className="uitive-stack">{children}</div>,
  Title: ({ children }) => <h1 className="uitive-page-title">{children}</h1>,
  Section: ({ title, layout, depth, count, children }) => (
    <section className="uitive-section" data-layout={layout} data-depth={depth}>
      {title && <h2 className="uitive-section-title">{title}</h2>}
      <div className="uitive-blocks" data-layout={layout} data-count={count}>
        {children}
      </div>
    </section>
  ),
  Grid: ({ children, columns }) => (
    <div className="uitive-grid" data-columns={columns}>
      {children}
    </div>
  ),
  Card: ({ title, children }) => (
    <section className="uitive-card">
      {title && <h3 className="uitive-card-title">{title}</h3>}
      {children}
    </section>
  ),
  Tabs,
  Text: ({ children, tone }) => (
    <p className="uitive-text" data-tone={tone}>
      {children}
    </p>
  ),
  Notice: ({ tone, children }) => (
    <p className="uitive-notice" data-tone={tone} role="status">
      {children}
    </p>
  ),
  Table: ({ columns, rows, density, caption }) => (
    <table className="uitive-table" data-density={density ?? 'comfortable'}>
      {caption && <caption>{caption}</caption>}
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" data-align={column.align}>
              {column.label}
            </th>
          ))}
          {rows.some((row) => row.actions) && (
            <th scope="col">
              <span className="uitive-hidden">Actions</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {columns.map((column, index) => (
              <td key={column.key} data-align={column.align}>
                {index === 0 && row.onOpen ? (
                  <button type="button" className="uitive-open" onClick={row.onOpen}>
                    {row.cells[column.key]}
                  </button>
                ) : (
                  row.cells[column.key]
                )}
              </td>
            ))}
            {row.actions !== undefined && <td className="uitive-row-actions">{row.actions}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  ),
  List: ({ items }) => (
    <ul className="uitive-list">
      {items.map((item) => (
        <li key={item.key}>
          <div className="uitive-list-main">
            {item.onOpen ? (
              <button type="button" className="uitive-open" onClick={item.onOpen}>
                {item.title}
              </button>
            ) : (
              <strong>{item.title}</strong>
            )}
            {item.subtitle && <span className="uitive-list-subtitle">{item.subtitle}</span>}
          </div>
          {item.meta && <span className="uitive-list-meta">{item.meta}</span>}
          {item.badge}
          {item.actions}
        </li>
      ))}
    </ul>
  ),
  Stat: ({ label, value, change, partial }) => (
    <div className="uitive-stat">
      <span className="uitive-stat-label">{label}</span>
      <strong className="uitive-stat-value">
        {partial && <span className="uitive-stat-least">at least </span>}
        {value}
      </strong>
      {change !== undefined && Number.isFinite(change) && (
        <span
          className="uitive-stat-change"
          data-direction={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}
        >
          {`${change > 0 ? '+' : ''}${Math.round(change * 100)}% on the period before`}
        </span>
      )}
    </div>
  ),
  Chart,
  Badge: ({ children, tone }) => (
    <span className="uitive-badge" data-tone={tone ?? 'neutral'}>
      {children}
    </span>
  ),
  Value: ({ field, value, currency }) => (
    <span className="uitive-value" data-type={field.type}>
      {formatValue(field, value, currency)}
    </span>
  ),
  Button: ({ children, onClick, tone, size, disabled, type }) => (
    <button
      type={type ?? 'button'}
      className="uitive-button"
      data-tone={tone ?? 'plain'}
      data-size={size ?? 'regular'}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  ),
  Link: ({ href, children, onClick }) => (
    <a
      className="uitive-link"
      href={href}
      onClick={(event) => {
        if (!onClick) return;
        event.preventDefault();
        onClick();
      }}
    >
      {children}
    </a>
  ),
  Field: FieldInput,
  Dialog: ({ title, children, onClose }) => {
    const id = useId();
    return (
      <div
        className="uitive-dialog-backdrop"
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <div className="uitive-dialog" role="dialog" aria-modal="true" aria-labelledby={id}>
          <h2 id={id} className="uitive-dialog-title">
            {title}
          </h2>
          {children}
        </div>
      </div>
    );
  },
  Status,
};

/** Value renderers by type (`money`) or by reference target (`ref:customers`). */
export type ValueRenderers = Readonly<Record<string, ComponentType<ValueProps>>>;

/**
 * A kit with some primitives replaced, and some value types drawn differently: start from the
 * default and swap in the design system's parts as they are mapped.
 */
export function createKit(overrides: Partial<Kit> & { values?: ValueRenderers } = {}): Kit {
  const { values, ...parts } = overrides;
  const kit: Kit = { ...defaultKit, ...parts };
  if (!values) return kit;
  const Base = kit.Value;
  return {
    ...kit,
    Value: (props) => {
      const Renderer =
        (props.field.source && values[`ref:${props.field.source}`]) || values[props.field.type];
      return Renderer ? <Renderer {...props} /> : <Base {...props} />;
    },
  };
}

/** The default kit's styles, as a string: for a `<style>`, or a shadow root. */
export const kitStyles = `
:where(.uitive-blocks) { display: grid; gap: var(--uitive-gap, 16px); }
:where(.uitive-blocks[data-layout='grid']) { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
:where(.uitive-blocks[data-layout='columns']) { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
:where(.uitive-blocks[data-layout='columns'][data-count='2']) { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
:where(.uitive-blocks[data-layout='columns'][data-count='3']) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 720px) { :where(.uitive-blocks[data-layout='columns']) { grid-template-columns: 1fr; } }
:where(.uitive-block) { min-width: 0; }
:where(.uitive-blocks[data-layout='grid'] > .uitive-block[data-block='metric'] .uitive-stat) { border: 1px solid var(--uitive-border, rgba(127, 127, 127, 0.3)); border-radius: var(--uitive-radius, 8px); padding: 12px 16px; background: var(--uitive-surface, transparent); }
.uitive-page, .uitive-stack { display: grid; gap: var(--uitive-gap, 16px); }
.uitive-grid { display: grid; gap: var(--uitive-gap, 16px); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.uitive-grid[data-columns='2'] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.uitive-grid[data-columns='3'] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.uitive-card { border: 1px solid var(--uitive-border, rgba(127, 127, 127, 0.3)); border-radius: var(--uitive-radius, 8px); padding: var(--uitive-gap, 16px); background: var(--uitive-surface, transparent); }
.uitive-card-title, .uitive-section-title, .uitive-dialog-title { margin: 0 0 8px; font-size: 1em; font-weight: 600; }
.uitive-text { margin: 0; } .uitive-text[data-tone='muted'] { opacity: 0.7; } .uitive-text[data-tone='strong'] { font-weight: 600; }
.uitive-notice { margin: 0; font-size: 0.9em; } .uitive-notice[data-tone='error'] { color: var(--uitive-bad, #c92a2a); }
.uitive-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.uitive-table th, .uitive-table td { padding: 8px; text-align: start; border-bottom: 1px solid var(--uitive-border, rgba(127, 127, 127, 0.25)); }
.uitive-table[data-density='compact'] th, .uitive-table[data-density='compact'] td { padding: 4px 8px; }
.uitive-table [data-align='end'] { text-align: end; }
.uitive-row-actions { white-space: nowrap; text-align: end; }
.uitive-open { all: unset; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.uitive-open:focus-visible, .uitive-button:focus-visible, .uitive-link:focus-visible { outline: 2px solid var(--uitive-accent, Highlight); outline-offset: 2px; }
.uitive-list { list-style: none; margin: 0; padding: 0; display: grid; }
.uitive-list li { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--uitive-border, rgba(127, 127, 127, 0.25)); }
.uitive-list-main { display: grid; flex: 1; min-width: 0; } .uitive-list-subtitle, .uitive-list-meta { opacity: 0.7; font-size: 0.9em; }
.uitive-stat { display: grid; gap: 4px; } .uitive-stat-label { opacity: 0.7; } .uitive-stat-value { font-size: 1.8em; font-variant-numeric: tabular-nums; }
.uitive-stat-least { font-size: 0.5em; font-weight: 400; opacity: 0.7; }
.uitive-stat-change[data-direction='up'] { color: var(--uitive-good, green); } .uitive-stat-change[data-direction='down'] { color: var(--uitive-bad, firebrick); }
.uitive-chart { margin: 0; } .uitive-chart svg { width: 100%; height: 140px; }
.uitive-chart rect, .uitive-chart polygon, .uitive-chart path { fill: var(--uitive-accent, currentColor); opacity: 0.8; }
.uitive-chart [data-series='1'] { opacity: 0.55; } .uitive-chart [data-series='2'] { opacity: 0.35; }
.uitive-chart polyline { stroke: var(--uitive-accent, currentColor); stroke-width: 2; fill: none; }
.uitive-chart figcaption { display: flex; justify-content: space-between; opacity: 0.7; font-size: 0.85em; }
.uitive-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.85em; background: var(--uitive-badge, rgba(127, 127, 127, 0.18)); }
.uitive-button { font: inherit; padding: 6px 12px; border-radius: var(--uitive-radius, 8px); border: 1px solid var(--uitive-border, rgba(127, 127, 127, 0.4)); background: transparent; color: inherit; cursor: pointer; }
.uitive-button[data-tone='primary'] { background: var(--uitive-accent, #3b5bdb); border-color: transparent; color: var(--uitive-on-accent, white); }
.uitive-button[data-tone='danger'] { background: var(--uitive-bad, #c92a2a); border-color: transparent; color: white; }
.uitive-button[data-size='small'] { padding: 2px 8px; font-size: 0.9em; } .uitive-button[data-size='large'] { padding: 12px 20px; font-size: 1.1em; }
.uitive-button:disabled { opacity: 0.5; cursor: not-allowed; }
.uitive-field { display: grid; gap: 4px; } .uitive-field[data-type='bool'] { display: flex; align-items: center; gap: 8px; }
.uitive-field input, .uitive-field select { font: inherit; padding: 6px 8px; border-radius: var(--uitive-radius, 8px); border: 1px solid var(--uitive-border, rgba(127, 127, 127, 0.4)); background: transparent; color: inherit; }
.uitive-dialog-backdrop { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, 0.4); z-index: 1000; }
.uitive-dialog { display: grid; gap: 12px; min-width: min(420px, 92vw); max-width: 92vw; padding: 20px; border-radius: var(--uitive-radius, 8px); background: var(--uitive-dialog, Canvas); color: var(--uitive-text, CanvasText); }
.uitive-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.uitive-params { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; } .uitive-params dt { opacity: 0.7; } .uitive-params dd { margin: 0; }
.uitive-status { padding: 12px; opacity: 0.75; } .uitive-status[data-state='error'] { color: var(--uitive-bad, firebrick); opacity: 1; }
.uitive-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.uitive-tabs [role='tablist'] { display: flex; gap: 4px; margin-bottom: 8px; }
.uitive-tabs [role='tab'] { font: inherit; padding: 4px 10px; border: 0; border-bottom: 2px solid transparent; background: none; color: inherit; cursor: pointer; }
.uitive-tabs [role='tab'][aria-selected='true'] { border-bottom-color: var(--uitive-accent, currentColor); }
`;
