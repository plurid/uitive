'use client';
import { useCallback, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import {
  buildPath,
  entityRoute,
  humanise,
  NONE,
  parseTime,
  parseValue,
  periodOf,
  rowParam,
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
import { useUitive } from './provider.js';

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

/** A row's value for a qualified field, drawn by the kit. */
function cell(scope: Scope, source: string, name: string, row: Row): ReactNode {
  const path = scope.client.contract.path(name);
  if (!path) return null;
  const currency =
    path.field.type === 'money' && path.via === undefined && path.field.currency !== undefined
      ? (row[`${source}.${path.field.currency}`] as string | undefined)
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

function matchesWhen(client: Uitive, action: string, row: Row): boolean {
  for (const filter of client.contract.actions[action]?.when ?? []) {
    const path = client.contract.path(filter.field);
    if (!path || !(filter.field in row)) continue;
    const actual = row[filter.field];
    const values = filter.values.map((value) => {
      const parsed = parseValue(path.field, value, { now: Date.now() });
      return parsed?.value;
    });
    const comparable = path.field.type === 'time' ? timeOf(path.field, actual) : actual;
    const empty = actual === null || actual === undefined || actual === '';
    const pass =
      filter.op === 'eq'
        ? comparable === values[0]
        : filter.op === 'ne'
          ? comparable !== values[0]
          : filter.op === 'in'
            ? values.includes(comparable as never)
            : filter.op === 'nin'
              ? !values.includes(comparable as never)
              : filter.op === 'empty'
                ? empty
                : filter.op === 'present'
                  ? !empty
                  : filter.op === 'gt'
                    ? (comparable as number) > (values[0] as number)
                    : filter.op === 'gte'
                      ? (comparable as number) >= (values[0] as number)
                      : filter.op === 'lt'
                        ? (comparable as number) < (values[0] as number)
                        : filter.op === 'lte'
                          ? (comparable as number) <= (values[0] as number)
                          : true;
    if (!pass) return false;
  }
  return true;
}

/** A param's value from its text: numbers, flags and enums as their types. */
function coerce(field: Field, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (field.type === 'number' || field.type === 'money')
    return value.trim() === '' ? undefined : Number(value);
  if (field.type === 'bool') return value === 'true';
  return value;
}

interface Pending {
  action: string;
  values: Record<string, unknown>;
  missing: readonly Field[];
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
  if (result.status === 'cancelled') return undefined;
  const done = result.status === 'done';
  runs += 1;
  return {
    id: runs,
    tone: done ? 'success' : 'error',
    text: result.message ?? (done ? `${label}: done` : `${label}: not done`),
  };
}

/** Runs actions from a generated interface, asking for whatever params are missing. */
function useRunner(scope: Scope) {
  const [pending, setPending] = useState<Pending | undefined>();
  const [outcome, setOutcome] = useState<Outcome | undefined>();
  const { client, element, current } = scope;
  const run = useCallback(
    async (
      action: string,
      set: readonly { param: string; value: string }[],
      row?: { source: string; key: string; data: Row },
    ) => {
      const fields = client.contract.params(action);
      const values: Record<string, unknown> = {};
      const own = rowParam(fields);
      if (row && own?.source === row.source) values[own.name] = row.key;
      for (const entry of set) {
        const field = fields.find((candidate) => candidate.name === entry.param);
        if (!field) continue;
        const raw = entry.value.startsWith('$row.')
          ? row?.data[`${row.source}.${entry.value.slice(5)}`]
          : entry.value === '$current'
            ? current
            : entry.value;
        values[field.name] = coerce(field, raw);
      }
      const missing = fields.filter(
        (field) =>
          !field.nullable && (values[field.name] === undefined || values[field.name] === ''),
      );
      if (missing.length > 0) {
        setPending({ action, values, missing });
        return;
      }
      const result = await client.perform(action as never, values as never, {
        element: element.id,
      });
      setOutcome(outcomeOf(labelOf(client, action), result));
    },
    [client, element.id, current],
  );
  const submit = async (filled: Record<string, unknown>) => {
    if (!pending) return;
    // The form closes first, so a confirmation can take its place.
    setPending(undefined);
    const result = await client.perform(pending.action as never, filled as never, {
      element: element.id,
      confirmed: true,
    });
    setOutcome(outcomeOf(labelOf(client, pending.action), result));
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
  return { run, dialog, notice };
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
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const { client, kit } = scope;
  const [values, setValues] = useState<Record<string, string>>({});
  const spec = client.contract.actions[pending.action];
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const filled = { ...pending.values };
    for (const field of pending.missing)
      filled[field.name] = coerce(field, values[field.name] ?? '');
    onSubmit(filled);
  };
  return (
    <kit.Dialog title={spec?.label ?? pending.action} onClose={onCancel}>
      <form onSubmit={submit}>
        <kit.Stack>
          {pending.missing.map((field) => (
            <kit.Field
              key={field.name}
              field={field}
              value={values[field.name] ?? ''}
              onChange={(value) => setValues((before) => ({ ...before, [field.name]: value }))}
              required
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
  run,
}: {
  scope: Scope;
  actions: readonly RowAction[];
  source: string;
  rowKey: string;
  row: Row;
  run: (
    action: string,
    set: RowAction['set'],
    row: { source: string; key: string; data: Row },
  ) => void;
}) {
  const visible = actions.filter((entry) => matchesWhen(scope.client, entry.action, row));
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
  const [entry, ...lookups] = useQueries(
    client,
    [query, ...lookupQueries],
    current === undefined ? {} : { current },
  );
  const { run, dialog, notice } = useRunner(scope);
  if (!query || !source)
    return <kit.Status state="error" message={`No query called ${props.data}`} />;
  const waiting = status(kit, entry);
  if (waiting) return waiting;
  const result = entry?.result;
  if (!result || result.rows.length === 0) return <kit.Status state="empty" />;
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
      {result.partial && <kit.Status state="partial" />}
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
  const [entry] = useQueries(client, [query], current === undefined ? {} : { current });
  const { run, dialog, notice } = useRunner(scope);
  if (!query || !source)
    return <kit.Status state="error" message={`No query called ${props.data}`} />;
  const waiting = status(kit, entry);
  if (waiting) return waiting;
  const result = entry?.result;
  if (!result || result.rows.length === 0) return <kit.Status state="empty" />;
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
      {result.partial && <kit.Status state="partial" />}
      {notice}
      {dialog}
    </>
  );
}

function DetailBlock({ scope, props }: { scope: Scope; props: DetailProps }) {
  const { client, kit, page, current } = scope;
  const query = queryOf(page, props.data);
  const [entry] = useQueries(client, [query], current === undefined ? {} : { current });
  if (!query) return <kit.Status state="error" message={`No query called ${props.data}`} />;
  const waiting = status(kit, entry);
  if (waiting) return waiting;
  const row = entry?.result?.rows[0];
  if (!row) return <kit.Status state="empty" />;
  return (
    <kit.Grid columns={props.columns}>
      {props.fields.map((name) => (
        <div key={name} className="uitive-detail-field">
          <kit.Text tone="muted">{fieldOf(client, name)?.label ?? name}</kit.Text>
          <kit.Text tone="strong">{cell(scope, query.source, name, row)}</kit.Text>
        </div>
      ))}
    </kit.Grid>
  );
}

/** The same query over the period before its time filter, for comparisons. */
function previousOf(client: Uitive, query: Query): Query | undefined {
  const period = periodOf(query, client.contract);
  if (!period) return undefined;
  const now = Date.now();
  const from = parseTime(period.from, { now });
  const to = period.to === undefined ? now : parseTime(period.to, { now });
  if (from === undefined || to === undefined || to <= from) return undefined;
  const span = to - from;
  return {
    ...query,
    filter: [
      ...query.filter.filter((entry) => entry.field !== period.field),
      { field: period.field, op: 'gte', values: [new Date(from - span).toISOString()] },
      { field: period.field, op: 'lt', values: [new Date(from).toISOString()] },
    ],
  };
}

function MetricBlock({ scope, props }: { scope: Scope; props: MetricProps }) {
  const { client, kit, page, current } = scope;
  const query = queryOf(page, props.data);
  const previous = props.compare === 'previous' && query ? previousOf(client, query) : undefined;
  const [entry, before] = useQueries(
    client,
    [query, previous],
    current === undefined ? {} : { current },
  );
  if (!query) return <kit.Status state="error" message={`No query called ${props.data}`} />;
  const waiting = status(kit, entry);
  if (waiting) return waiting;
  const group = entry?.result?.groups[0];
  const earlier = before?.result?.groups[0]?.value;
  const value = group?.value ?? null;
  const change =
    typeof value === 'number' && typeof earlier === 'number' && earlier !== 0
      ? (value - earlier) / earlier
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
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
        date,
      );
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
  const [entry] = useQueries(client, [query], current === undefined ? {} : { current });
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
        ? humanise(group.label)
        : group.label;
  const named = new Map<string, ChartSeries['points'][number][]>();
  for (const group of groups) {
    const name = query.aggregate.split === NONE ? '' : group.splitLabel;
    const points = named.get(name) ?? [];
    points.push({
      x: typeof group.by === 'number' ? group.by : String(group.by ?? group.label),
      label: label(group),
      y: group.value ?? 0,
    });
    named.set(name, points);
  }
  const series: ChartSeries[] = [...named].map(([name, points]) => ({ name, points }));
  return (
    <kit.Chart
      kind={props.kind}
      series={series}
      stacked={props.stacked}
      label={client.contract.source(query.source)?.label ?? ''}
    />
  );
}

function TimelineBlock({ scope, props }: { scope: Scope; props: TimelineProps }) {
  const { client, kit, page, current } = scope;
  const query = queryOf(page, props.data);
  const [entry] = useQueries(client, [query], current === undefined ? {} : { current });
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
    <kit.List
      items={rows.map((row) => ({
        key: String(row[`${source.id}.${source.key}`]),
        title: cell(scope, source.id, props.title, row),
        ...(props.detail === NONE ? {} : { subtitle: cell(scope, source.id, props.detail, row) }),
        meta: cell(scope, source.id, props.time, row),
      }))}
    />
  );
}

function BoardBlock({ scope, props }: { scope: Scope; props: BoardProps }) {
  const { client, kit, page, current } = scope;
  const query = queryOf(page, props.data);
  const [entry] = useQueries(client, [query], current === undefined ? {} : { current });
  if (!query) return <kit.Status state="error" message={`No query called ${props.data}`} />;
  const waiting = status(kit, entry);
  if (waiting) return waiting;
  const source = client.contract.source(query.source);
  const column = fieldOf(client, props.column);
  if (!source || !column) return <kit.Status state="empty" />;
  const rows = entry?.result?.rows ?? [];
  return (
    <kit.Grid columns={Math.min(column.values.length, 3)}>
      {column.values.map((value) => {
        const members = rows.filter((row) => row[props.column] === value);
        return (
          <kit.Card key={value} title={`${humanise(value)} (${members.length})`}>
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
  );
}

function FormBlock({ scope, props }: { scope: Scope; props: FormProps }) {
  const { client, kit, element, current } = scope;
  const spec = client.contract.actions[props.action];
  const fields = client.contract.params(props.action);
  const fixed = new Map(
    props.set.map((entry) => [entry.param, entry.value === '$current' ? current : entry.value]),
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Outcome | undefined>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const params: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = fixed.has(field.name) ? fixed.get(field.name) : values[field.name];
      if (raw !== undefined && raw !== '') params[field.name] = coerce(field, raw);
    }
    const result = await client.perform(props.action as never, params as never, {
      element: element.id,
      confirmed: true,
    });
    if (result.status === 'done') setValues({});
    setOutcome(outcomeOf(spec?.label ?? props.action, result));
  };
  return (
    <form onSubmit={submit}>
      <kit.Stack>
        {fields.map((field) =>
          fixed.has(field.name) ? (
            <kit.Text key={field.name} tone="muted">
              {`${field.label}: ${String(fixed.get(field.name) ?? '')}`}
            </kit.Text>
          ) : (
            <kit.Field
              key={field.name}
              field={field}
              value={values[field.name] ?? ''}
              onChange={(value) => setValues((before) => ({ ...before, [field.name]: value }))}
              required={!field.nullable}
            />
          ),
        )}
        <div>
          <kit.Button type="submit" tone={spec?.effect === 'destructive' ? 'danger' : 'primary'}>
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
  const listed = useSyncExternalStore(list === undefined ? silent : client.subscribe, read, read);
  const { run, dialog, notice } = useRunner(scope);
  const go = async (action: string, set: RowAction['set']) => {
    const spec = client.contract.actions[action];
    if (spec?.effect === undefined) {
      await client.perform(action as never, undefined, {
        element: element.id,
        surface: list ?? '',
      });
      // An action a route records leads to that route.
      const route = client.contract.routeIds.find(
        (id) => client.contract.routes[id]?.action === action,
      );
      if (route !== undefined) client.navigate({ route });
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
  const { client, kit } = scope;
  return (
    <nav className="uitive-links">
      {props.items.map((item) => {
        const route = client.contract.routes[item.route];
        const params = route?.entity === undefined ? {} : { [route.key ?? 'id']: item.entity };
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
