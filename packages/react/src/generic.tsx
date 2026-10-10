'use client';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  buildPath,
  entityRoute,
  humanize,
  NONE,
  rowParam,
  stableStringify,
  timeOf,
  type ActionsProps,
  type AnyPage,
  type Uitive,
  type BoardProps,
  type ChartProps,
  type DataEntry,
  type DetailProps,
  type Element,
  type Field,
  type FormProps,
  type GenericName,
  type Group,
  type LinksProps,
  type ListProps,
  type ListValue,
  type MetricProps,
  type NoteProps,
  type PerformResult,
  type Query,
  type ResolvedSource,
  type Row,
  type RowAction,
  type TableProps,
  type TimelineProps,
} from '@plurid/uitive-core';
import { useQueries } from './hooks.js';
import type { ChartSeries, Kit, ListItem, TableColumn, TableRow } from './kit.js';
import { currencyOf, fieldLabel, paramsFrom, showsEvery } from './params.js';
import { previousOf } from './period.js';
import { Params, useUitive } from './provider.js';

interface Scope {
  client: Uitive;
  kit: Kit;
  page: AnyPage;
  element: Element;
  /** The key of the row the page is about. */
  current: string | undefined;
}

/** Draws one generic block from its props, its page's queries and the kit. */
export function GenericBlock({
  element,
  page,
  current,
}: {
  element: Element;
  page: AnyPage;
  current?: string;
}) {
  const { client, kit } = useUitive();
  const scope: Scope = { client, kit, page, element, current };
  switch (element.block as GenericName) {
    case 'table':
      return <TableBlock scope={scope} props={element.props as TableProps} />;
    case 'list':
      return <ListBlock scope={scope} props={element.props as ListProps} />;
    case 'detail':
      return <DetailBlock scope={scope} props={element.props as DetailProps} />;
    case 'metric':
      return <MetricBlock scope={scope} props={element.props as MetricProps} />;
    case 'chart':
      return <ChartBlock scope={scope} props={element.props as ChartProps} />;
    case 'timeline':
      return <TimelineBlock scope={scope} props={element.props as TimelineProps} />;
    case 'board':
      return <BoardBlock scope={scope} props={element.props as BoardProps} />;
    case 'form':
      return <FormBlock scope={scope} props={element.props as FormProps} />;
    case 'actions':
      return <ActionsBlock scope={scope} props={element.props as ActionsProps} />;
    case 'note':
      return <NoteBlock scope={scope} props={element.props as NoteProps} />;
    case 'links':
      return <LinksBlock scope={scope} props={element.props as LinksProps} />;
    default:
      return null;
  }
}

const queryOf = (page: AnyPage, name: string): Query | undefined =>
  page.data.find((entry) => entry.name === name)?.query;

const fieldOf = (client: Uitive, name: string): Field | undefined =>
  client.contract.path(name)?.field;

const numeric = (field: Field | undefined) => field?.type === 'number' || field?.type === 'money';

const scopeOf = (current: string | undefined) => (current === undefined ? {} : { current });

/** A query with more fields, for what row actions read. */
function withFields(query: Query, extra: readonly string[]): Query {
  const fields = [...new Set([...query.fields, ...extra])];
  return fields.length === query.fields.length ? query : { ...query, fields };
}

/** Fields row actions need: their `when` filters and `$row` params. */
function actionFields(client: Uitive, source: string, actions: readonly RowAction[]): string[] {
  const names: string[] = [];
  for (const entry of actions) {
    for (const filter of client.contract.actions[entry.action]?.when ?? [])
      names.push(filter.field);
    for (const set of entry.set) {
      if (set.value.startsWith('$row.')) names.push(`${source}.${set.value.slice(5)}`);
    }
  }
  return names.filter((name) => client.contract.path(name)?.source === source);
}

function status(kit: Kit, entry: DataEntry | undefined): ReactNode {
  if (!entry || (entry.status === 'loading' && !entry.result))
    return <kit.Status state="loading" />;
  if (entry.status === 'error' && !entry.result)
    return <kit.Status state="error" message={entry.error} />;
  return null;
}

/** Says so when a scan cap cut the result short. */
const partial = (kit: Kit, entry: DataEntry | undefined) =>
  entry?.result?.partial ? <kit.Status state="partial" /> : null;

/** A row's value for a qualified field, drawn by the kit. */
function cell(scope: Scope, source: string, name: string, row: Row): ReactNode {
  const path = scope.client.contract.path(name);
  if (!path) return null;
  // Core projects money's currency beside it: the related row's for an amount one hop away.
  const currency =
    path.field.type === 'money' && path.field.currency !== undefined
      ? (row[`${source}.${path.via === undefined ? '' : `${path.via}.`}${path.field.currency}`] as
          string | undefined)
      : undefined;
  return (
    <scope.kit.Value field={path.field} value={row[name]} {...(currency ? { currency } : {})} />
  );
}

/** How a summary's numbers display: counts as numbers, money already in major units. */
function measureField(client: Uitive, query: Query): Field {
  const counted: Field = {
    name: 'count',
    type: 'number',
    label: 'Count',
    description: '',
    nullable: false,
    values: [],
    minor: false,
  };
  const { measure, of } = query.aggregate;
  if (measure === 'count' || measure === 'distinct' || of === NONE) return counted;
  const field = fieldOf(client, of);
  if (!field) return counted;
  if (field.type === 'time') return { ...field, unit: 'ms' };
  return { ...field, minor: false };
}

/** Each row's own page, when the contract has a route for its source. */
function opener(client: Uitive, source: ResolvedSource, link: 'none' | 'entity') {
  if (link !== 'entity') return undefined;
  const route = entityRoute(client.contract, source.id);
  if (route === undefined) return undefined;
  const param = client.contract.routes[route]?.key ?? 'id';
  return (key: string) => client.navigate({ route, params: { [param]: key } });
}

/** Whether an action's `when` allows a row, judged as queries filter. */
function allows(scope: Scope, action: string, row: Row): boolean {
  const when = scope.client.contract.actions[action]?.when;
  if (!when || when.length === 0) return true;
  return scope.client.data?.matches(when, row, scopeOf(scope.current)) ?? false;
}

interface Pending {
  action: string;
  /** What the run already has, as written: its row, `set` values and `$row` values. */
  raw: Record<string, unknown>;
  /** The same, parsed. */
  values: Record<string, unknown>;
}

interface Outcome {
  /** New for every run, so the kit's notice mounts afresh. */
  id: number;
  tone: 'success' | 'error';
  text: string;
}

let runs = 0;

const labelOf = (client: Uitive, action: string) =>
  client.contract.actions[action]?.label ?? action;

/** What a run says when it is over: its own message, else that it was done or not. */
function outcomeOf(label: string, result: PerformResult): Outcome | undefined {
  if (result.status === 'canceled') return undefined;
  const done = result.status === 'done';
  runs += 1;
  return {
    id: runs,
    tone: done ? 'success' : 'error',
    text: result.message ?? (done ? `${label}: done` : `${label}: not done`),
  };
}

/** One run at a time from a block: a second press while one is in flight does nothing. */
function useFlight() {
  const flying = useRef(false);
  const [busy, setBusy] = useState(false);
  const fly = useCallback(async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
    if (flying.current) return undefined;
    flying.current = true;
    setBusy(true);
    try {
      return await task();
    } finally {
      flying.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, fly };
}

/**
 * Runs actions from a generated interface, asking for whatever params are missing. A run straight
 * from a button waits for the client's confirmation; a form that showed every param counts as
 * the yes, except for destructive runs, which always wait for their phrase.
 */
function useRunner(scope: Scope) {
  const [pending, setPending] = useState<Pending | undefined>();
  const [outcome, setOutcome] = useState<Outcome | undefined>();
  const { busy, fly } = useFlight();
  const { client, element, current } = scope;
  const perform = useCallback(
    (action: string, values: Record<string, unknown>, confirmed = false) =>
      fly(async () => {
        const result = await client.perform(action as never, values as never, {
          element: element.id,
          ...(confirmed ? { confirmed } : {}),
        });
        setOutcome(outcomeOf(labelOf(client, action), result));
      }),
    [client, element.id, fly],
  );
  const run = useCallback(
    async (
      action: string,
      set: readonly { param: string; value: string }[],
      row?: { source: string; key: string; data: Row },
    ) => {
      const fields = client.contract.params(action);
      const raw: Record<string, unknown> = {};
      const own = rowParam(fields);
      if (row && own?.source === row.source) raw[own.name] = row.key;
      for (const entry of set) {
        raw[entry.param] = entry.value.startsWith('$row.')
          ? row?.data[`${row.source}.${entry.value.slice(5)}`]
          : entry.value === '$current'
            ? current
            : entry.value;
      }
      const values = paramsFrom(fields, raw);
      if (fields.some((field) => !field.nullable && values[field.name] === undefined)) {
        setPending({ action, raw, values });
        return;
      }
      await perform(action, values);
    },
    [client, current, perform],
  );
  const submit = (filled: Record<string, unknown>, confirmed: boolean) => {
    if (!pending) return;
    // The form closes first, so a confirmation can take its place.
    setPending(undefined);
    void perform(pending.action, filled, confirmed);
  };
  const dialog = pending ? (
    <RunForm
      scope={scope}
      pending={pending}
      onCancel={() => setPending(undefined)}
      onSubmit={submit}
    />
  ) : null;
  const notice = outcome ? (
    <scope.kit.Notice key={outcome.id} tone={outcome.tone}>
      {outcome.text}
    </scope.kit.Notice>
  ) : null;
  return { run, busy, dialog, notice };
}

/** What a form's inputs send: checkboxes left alone are no, everything else as typed. */
function typedRaw(fields: readonly Field[], values: Readonly<Record<string, string>>) {
  const raw: Record<string, string> = {};
  for (const field of fields) {
    raw[field.name] =
      field.type === 'bool' ? String(values[field.name] === 'true') : (values[field.name] ?? '');
  }
  return raw;
}

function RunForm({
  scope,
  pending,
  onCancel,
  onSubmit,
}: {
  scope: Scope;
  pending: Pending;
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>, confirmed: boolean) => void;
}) {
  const { client, kit } = scope;
  const [values, setValues] = useState<Record<string, string>>({});
  const spec = client.contract.actions[pending.action];
  const fields = client.contract.params(pending.action);
  const known = fields.filter((field) => pending.values[field.name] !== undefined);
  const open = fields.filter((field) => pending.values[field.name] === undefined);
  const raw = { ...pending.raw, ...typedRaw(open, values) };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const params = paramsFrom(fields, raw);
    const typed = new Set(open.map((field) => field.name));
    onSubmit(params, showsEvery(fields, typed, raw, params));
  };
  return (
    <kit.Dialog title={spec?.label ?? pending.action} onClose={onCancel}>
      <form onSubmit={submit}>
        <kit.Stack>
          <Params kit={kit} fields={known} params={pending.values} />
          {open.map((field) => (
            <kit.Field
              key={field.name}
              field={field}
              label={fieldLabel(field, raw)}
              value={values[field.name] ?? ''}
              onChange={(value) => setValues((before) => ({ ...before, [field.name]: value }))}
              required={!field.nullable}
            />
          ))}
          <div className="uitive-dialog-actions">
            <kit.Button onClick={onCancel}>Cancel</kit.Button>
            <kit.Button type="submit" tone={spec?.effect === 'destructive' ? 'danger' : 'primary'}>
              {spec?.label ?? 'Run'}
            </kit.Button>
          </div>
        </kit.Stack>
      </form>
    </kit.Dialog>
  );
}

function RowButtons({
  scope,
  actions,
  source,
  rowKey,
  row,
  busy,
  run,
}: {
  scope: Scope;
  actions: readonly RowAction[];
  source: string;
  rowKey: string;
  row: Row;
  busy: boolean;
  run: (
    action: string,
    set: RowAction['set'],
    row: { source: string; key: string; data: Row },
  ) => void;
}) {
  const visible = actions.filter((entry) => allows(scope, entry.action, row));
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((entry) => {
        const spec = scope.client.contract.actions[entry.action];
        return (
          <scope.kit.Button
            key={entry.action}
            size="small"
            tone={spec?.effect === 'destructive' ? 'danger' : 'plain'}
            disabled={busy}
            onClick={() => run(entry.action, entry.set, { source, key: rowKey, data: row })}
          >
            {spec?.label ?? entry.action}
          </scope.kit.Button>
        );
      })}
    </>
  );
}

function TableBlock({ scope, props }: { scope: Scope; props: TableProps }) {
  const { client, kit, page, current } = scope;
  const base = queryOf(page, props.data);
  const source = base ? client.contract.source(base.source) : undefined;
  const query =
    base && source
      ? withFields(base, actionFields(client, source.id, props.rowActions))
      : undefined;
  const lookupQueries = props.lookups.map((lookup) => queryOf(page, lookup.data));
  const [entry, ...lookups] = useQueries(client, [query, ...lookupQueries], scopeOf(current));
  const { run, busy, dialog, notice } = useRunner(scope);
  if (!query || !source)
    return <kit.Status state="error" message={`No query called ${props.data}`} />;
  const result = entry?.result;
  // A run's notice and form stay while the rows reload after it.
  const waiting =
    status(kit, entry) ??
    (!result || result.rows.length === 0 ? <kit.Status state="empty" /> : null);
  if (waiting || !result) {
    return (
      <>
        {waiting}
        {notice}
        {dialog}
      </>
    );
  }
  const keyName = `${source.id}.${source.key}`;
  const open = opener(client, source, props.link);
  const figures = lookups.map(
    (lookup) => new Map((lookup?.result?.groups ?? []).map((group) => [String(group.by), group])),
  );
  const lookupFields = lookupQueries.map((lookupQuery) =>
    lookupQuery ? measureField(client, lookupQuery) : undefined,
  );
  const columns: TableColumn[] = [
    ...props.columns.map((name) => {
      const field = fieldOf(client, name);
      return {
        key: name,
        label: field?.label ?? name,
        align: numeric(field) ? ('end' as const) : ('start' as const),
      };
    }),
    ...props.lookups.map((lookup, index) => ({
      key: `lookup:${index}`,
      label: lookup.label,
      align: 'end' as const,
    })),
  ];
  const rows: TableRow[] = result.rows.map((row) => {
    const key = String(row[keyName]);
    const cells: Record<string, ReactNode> = {};
    for (const name of props.columns) cells[name] = cell(scope, source.id, name, row);
    figures.forEach((byKey, index) => {
      const group: Group | undefined = byKey.get(key);
      const field = lookupFields[index];
      cells[`lookup:${index}`] =
        group && field ? (
          <kit.Value
            field={field}
            value={group.value}
            {...(group.currency ? { currency: group.currency } : {})}
          />
        ) : null;
    });
    return {
      key,
      cells,
      ...(props.rowActions.length > 0
        ? {
            actions: (
              <RowButtons
                scope={scope}
                actions={props.rowActions}
                source={source.id}
                rowKey={key}
                row={row}
                busy={busy}
                run={run}
              />
            ),
          }
        : {}),
      ...(open ? { onOpen: () => open(key) } : {}),
    };
  });
  return (
    <>
      <kit.Table columns={columns} rows={rows} density={props.density} />
      {partial(kit, entry)}
      {notice}
      {dialog}
    </>
  );
}

function ListBlock({ scope, props }: { scope: Scope; props: ListProps }) {
  const { client, kit, page, current } = scope;
  const base = queryOf(page, props.data);
  const source = base ? client.contract.source(base.source) : undefined;
  const query =
    base && source
      ? withFields(base, actionFields(client, source.id, props.rowActions))
      : undefined;
  const [entry] = useQueries(client, [query], scopeOf(current));
  const { run, busy, dialog, notice } = useRunner(scope);
  if (!query || !source)
    return <kit.Status state="error" message={`No query called ${props.data}`} />;
  const result = entry?.result;
  const waiting =
    status(kit, entry) ??
    (!result || result.rows.length === 0 ? <kit.Status state="empty" /> : null);
  if (waiting || !result) {
    return (
      <>
        {waiting}
        {notice}
        {dialog}
      </>
    );
  }
  const keyName = `${source.id}.${source.key}`;
  const open = opener(client, source, props.link);
  const optional = (name: string, row: Row) =>
    name === NONE ? undefined : cell(scope, source.id, name, row);
  const items: ListItem[] = result.rows.map((row) => {
    const key = String(row[keyName]);
    const badge = optional(props.badge, row);
    return {
      key,
      title: cell(scope, source.id, props.title, row),
      ...(props.subtitle === NONE ? {} : { subtitle: optional(props.subtitle, row) }),
      ...(props.meta === NONE ? {} : { meta: optional(props.meta, row) }),
      ...(badge === undefined ? {} : { badge: <kit.Badge>{badge}</kit.Badge> }),
      ...(props.rowActions.length > 0
        ? {
            actions: (
              <RowButtons
                scope={scope}
                actions={props.rowActions}
                source={source.id}
                rowKey={key}
                row={row}
                busy={busy}
                run={run}
              />
            ),
          }
        : {}),
      ...(open ? { onOpen: () => open(key) } : {}),
    };
  });
  return (
    <>
      <kit.List items={items} />
      {partial(kit, entry)}
      {notice}
      {dialog}
    </>
  );
}

function DetailBlock({ scope, props }: { scope: Scope; props: DetailProps }) {
  const { client, kit, page, current } = scope;
  const query = queryOf(page, props.data);
  const [entry] = useQueries(client, [query], scopeOf(current));
  if (!query) return <kit.Status state="error" message={`No query called ${props.data}`} />;
  const waiting = status(kit, entry);
  if (waiting) return waiting;
  const row = entry?.result?.rows[0];
  if (!row) return <kit.Status state="empty" />;
  return (
    <>
      <kit.Grid columns={props.columns}>
        {props.fields.map((name) => (
          <div key={name} className="uitive-detail-field">
            <kit.Text tone="muted">{fieldOf(client, name)?.label ?? name}</kit.Text>
            <kit.Text tone="strong">{cell(scope, query.source, name, row)}</kit.Text>
          </div>
        ))}
      </kit.Grid>
      {partial(kit, entry)}
    </>
  );
}

function MetricBlock({ scope, props }: { scope: Scope; props: MetricProps }) {
  const { client, kit, page, current } = scope;
  const query = queryOf(page, props.data);
  const [entry] = useQueries(client, [query], scopeOf(current));
  const at = entry?.result?.at;
  const key = query === undefined ? '' : stableStringify(query);
  // The same query gives the same comparison, so it is fetched once, then cached.
  const previous = useMemo(
    () =>
      props.compare === 'previous' && query ? previousOf(client.contract, query, at) : undefined,
    // The key stands for the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client.contract, key, props.compare, at],
  );
  const [before] = useQueries(client, [previous], scopeOf(current));
  if (!query) return <kit.Status state="error" message={`No query called ${props.data}`} />;
  const waiting = status(kit, entry);
  if (waiting) return waiting;
  const group = entry?.result?.groups[0];
  const earlier = before?.result?.groups[0];
  const value = group?.value ?? null;
  // A sum in one currency is never compared with a sum in another.
  const comparable = earlier?.currency === group?.currency;
  const change =
    typeof value === 'number' &&
    typeof earlier?.value === 'number' &&
    earlier.value !== 0 &&
    comparable
      ? (value - earlier.value) / earlier.value
      : undefined;
  return (
    <kit.Stat
      label={props.label}
      value={
        <kit.Value
          field={measureField(client, query)}
          value={value}
          {...(group?.currency ? { currency: group.currency } : {})}
        />
      }
      {...(change === undefined ? {} : { change })}
      partial={entry?.result?.partial ?? false}
    />
  );
}

/** A bucket's label: hours as times, days and weeks as dates, months, quarters and years. */
function bucketLabel(ms: number, bucket: Query['aggregate']['bucket']): string {
  const date = new Date(ms);
  switch (bucket) {
    case 'hour':
      return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date);
    case 'month':
      return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(date);
    case 'quarter':
      return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
    case 'year':
      return String(date.getUTCFullYear());
    default:
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }
}

function ChartBlock({ scope, props }: { scope: Scope; props: ChartProps }) {
  const { client, kit, page, current } = scope;
  const query = queryOf(page, props.data);
  const [entry] = useQueries(client, [query], scopeOf(current));
  if (!query) return <kit.Status state="error" message={`No query called ${props.data}`} />;
  const waiting = status(kit, entry);
  if (waiting) return waiting;
  const groups = entry?.result?.groups ?? [];
  if (groups.length === 0) return <kit.Status state="empty" />;
  const by = fieldOf(client, query.aggregate.by);
  const label = (group: Group) =>
    by?.type === 'time' && typeof group.by === 'number'
      ? bucketLabel(group.by, query.aggregate.bucket)
      : by?.type === 'enum'
        ? humanize(group.label)
        : group.label;
  const named = new Map<string, ChartSeries['points'][number][]>();
  for (const group of groups) {
    const name = query.aggregate.split === NONE ? '' : group.splitLabel;
    const points = named.get(name) ?? [];
    points.push({
      x: typeof group.by === 'number' ? group.by : String(group.by ?? group.label),
      label: label(group),
      y: group.value ?? 0,
      ...(group.currency === undefined ? {} : { currency: group.currency }),
    });
    named.set(name, points);
  }
  const series: ChartSeries[] = [...named].map(([name, points]) => ({ name, points }));
  return (
    <>
      <kit.Chart
        kind={props.kind}
        series={series}
        stacked={props.stacked}
        label={client.contract.source(query.source)?.label ?? ''}
      />
      {partial(kit, entry)}
    </>
  );
}

function TimelineBlock({ scope, props }: { scope: Scope; props: TimelineProps }) {
  const { client, kit, page, current } = scope;
  const query = queryOf(page, props.data);
  const [entry] = useQueries(client, [query], scopeOf(current));
  if (!query) return <kit.Status state="error" message={`No query called ${props.data}`} />;
  const waiting = status(kit, entry);
  if (waiting) return waiting;
  const source = client.contract.source(query.source);
  const time = fieldOf(client, props.time);
  const rows = [...(entry?.result?.rows ?? [])].sort((a, b) =>
    time ? (timeOf(time, b[props.time]) ?? 0) - (timeOf(time, a[props.time]) ?? 0) : 0,
  );
  if (rows.length === 0 || !source) return <kit.Status state="empty" />;
  return (
    <>
      <kit.List
        items={rows.map((row) => ({
          key: String(row[`${source.id}.${source.key}`]),
          title: cell(scope, source.id, props.title, row),
          ...(props.detail === NONE ? {} : { subtitle: cell(scope, source.id, props.detail, row) }),
          meta: cell(scope, source.id, props.time, row),
        }))}
      />
      {partial(kit, entry)}
    </>
  );
}

function BoardBlock({ scope, props }: { scope: Scope; props: BoardProps }) {
  const { client, kit, page, current } = scope;
  const query = queryOf(page, props.data);
  const [entry] = useQueries(client, [query], scopeOf(current));
  if (!query) return <kit.Status state="error" message={`No query called ${props.data}`} />;
  const waiting = status(kit, entry);
  if (waiting) return waiting;
  const source = client.contract.source(query.source);
  const column = fieldOf(client, props.column);
  if (!source || !column) return <kit.Status state="empty" />;
  const rows = entry?.result?.rows ?? [];
  return (
    <>
      <kit.Grid columns={Math.min(column.values.length, 3)}>
        {column.values.map((value) => {
          const members = rows.filter((row) => row[props.column] === value);
          return (
            <kit.Card key={value} title={`${humanize(value)} (${members.length})`}>
              <kit.List
                items={members.map((row) => ({
                  key: String(row[`${source.id}.${source.key}`]),
                  title: cell(scope, source.id, props.title, row),
                  ...(props.meta === NONE ? {} : { meta: cell(scope, source.id, props.meta, row) }),
                }))}
              />
            </kit.Card>
          );
        })}
      </kit.Grid>
      {partial(kit, entry)}
    </>
  );
}

function FormBlock({ scope, props }: { scope: Scope; props: FormProps }) {
  const { client, kit, element, current } = scope;
  const spec = client.contract.actions[props.action];
  const fields = client.contract.params(props.action);
  const set: Record<string, unknown> = {};
  for (const entry of props.set)
    set[entry.param] = entry.value === '$current' ? current : entry.value;
  const [values, setValues] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Outcome | undefined>();
  const { busy, fly } = useFlight();
  const free = fields.filter((field) => !(field.name in set));
  const raw = { ...typedRaw(free, values), ...set };
  // What the form shows is what it sends: set values as parsed, money in its currency.
  const shown = paramsFrom(fields, raw);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const params = paramsFrom(fields, raw);
    const typed = new Set(free.map((field) => field.name));
    // Submitting a form that showed every value is the yes; otherwise the confirmation shows them.
    const confirmed = showsEvery(fields, typed, raw, params);
    void fly(async () => {
      const result = await client.perform(props.action as never, params as never, {
        element: element.id,
        ...(confirmed ? { confirmed } : {}),
      });
      if (result.status === 'done') setValues({});
      setOutcome(outcomeOf(spec?.label ?? props.action, result));
    });
  };
  return (
    <form onSubmit={submit}>
      <kit.Stack>
        {fields.map((field) => {
          if (field.name in set) {
            const currency = currencyOf(field, shown);
            return (
              <kit.Text key={field.name} tone="muted">
                {`${field.label}: `}
                <kit.Value
                  field={field}
                  value={shown[field.name]}
                  {...(currency === undefined ? {} : { currency })}
                />
              </kit.Text>
            );
          }
          return (
            <kit.Field
              key={field.name}
              field={field}
              label={fieldLabel(field, shown)}
              value={values[field.name] ?? ''}
              onChange={(value) => setValues((before) => ({ ...before, [field.name]: value }))}
              required={!field.nullable}
            />
          );
        })}
        <div>
          <kit.Button
            type="submit"
            tone={spec?.effect === 'destructive' ? 'danger' : 'primary'}
            disabled={busy}
          >
            {spec?.label ?? props.action}
          </kit.Button>
        </div>
        {outcome && (
          <kit.Notice key={outcome.id} tone={outcome.tone}>
            {outcome.text}
          </kit.Notice>
        )}
      </kit.Stack>
    </form>
  );
}

const silent = () => () => {};

function ActionsBlock({ scope, props }: { scope: Scope; props: ActionsProps }) {
  const { client, kit, element } = scope;
  const list = props.list === NONE ? undefined : props.list;
  const read = useCallback(
    () => (list === undefined ? undefined : (client.surface(list as never) as ListValue)),
    [client, list],
  );
  // Servers draw the standard list, so hydration matches; the person's own follows.
  const standard = useCallback(
    () => (list === undefined ? undefined : (client.standard(list as never) as ListValue)),
    [client, list],
  );
  const listed = useSyncExternalStore(
    list === undefined ? silent : client.subscribe,
    read,
    standard,
  );
  const { run, busy, dialog, notice } = useRunner(scope);
  const go = async (action: string, set: RowAction['set']) => {
    const spec = client.contract.actions[action];
    if (spec?.effect === undefined) {
      // An action a route records leads to that route, and arriving records it.
      const route = client.contract.routeIds.find(
        (id) => client.contract.routes[id]?.action === action,
      );
      if (route !== undefined) {
        client.navigate({ route });
        return;
      }
      await client.perform(action as never, undefined, {
        element: element.id,
        ...(list === undefined ? {} : { surface: list }),
      });
      return;
    }
    await run(action, set);
  };
  const buttons = [
    ...(listed?.visible ?? []).map((view) => ({
      action: view.id as string,
      set: [] as RowAction['set'],
    })),
    ...props.items,
  ];
  return (
    <div className="uitive-actions" data-size={props.size}>
      {buttons.map((entry, index) => {
        const spec = client.contract.actions[entry.action];
        return (
          <kit.Button
            key={`${entry.action}.${index}`}
            size={props.size}
            tone={spec?.effect === 'destructive' ? 'danger' : 'plain'}
            disabled={busy && spec?.effect !== undefined}
            onClick={() => void go(entry.action, entry.set)}
          >
            {spec?.label ?? entry.action}
          </kit.Button>
        );
      })}
      {notice}
      {dialog}
    </div>
  );
}

function NoteBlock({ scope, props }: { scope: Scope; props: NoteProps }) {
  const { kit } = scope;
  return (
    <kit.Card {...(props.title ? { title: props.title } : {})}>
      <kit.Text>{props.text}</kit.Text>
    </kit.Card>
  );
}

function LinksBlock({ scope, props }: { scope: Scope; props: LinksProps }) {
  const { client, kit, current } = scope;
  return (
    <nav className="uitive-links">
      {props.items.map((item) => {
        const route = client.contract.routes[item.route];
        let params: Record<string, string> = {};
        if (route?.entity !== undefined) {
          // `$current` is the page's row; planners never see rows, so they never name one.
          const key = item.entity.trim().toLowerCase() === '$current' ? current : item.entity;
          if (key === undefined || key.trim() === '') return null;
          params = { [route.key ?? 'id']: key };
        }
        const href = buildPath(client.contract, item.route, params) ?? '#';
        return (
          <kit.Link
            key={`${item.route}.${item.label}`}
            href={href}
            onClick={() => client.navigate({ route: item.route, params })}
          >
            {item.label}
          </kit.Link>
        );
      })}
    </nav>
  );
}
