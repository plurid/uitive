/** One node of an accessibility tree: what assistive technology, and Uitive, see of a page. */
export interface RoleNode {
  /** Its ARIA role, such as `button` or `navigation`. */
  role: string;
  /** The accessible name. */
  name: string;
  /** Flags such as `level=1` or `checked`. */
  attributes: Readonly<Record<string, string>>;
  /** Properties such as `url` for links and `placeholder` for text boxes. */
  properties: Readonly<Record<string, string>>;
  /** Text inside the node, such as a paragraph's. */
  text: string;
  /** The nodes inside it, in order. */
  children: RoleNode[];
}

interface Mutable {
  role: string;
  name: string;
  attributes: Record<string, string>;
  properties: Record<string, string>;
  text: string;
  children: Mutable[];
}

/** Reads a JSON-style string at the start of `rest`; returns it and what follows. */
function readString(rest: string): [string, string] | undefined {
  if (!rest.startsWith('"')) return undefined;
  for (let index = 1; index < rest.length; index++) {
    if (rest[index] === '\\') {
      index++;
      continue;
    }
    if (rest[index] === '"') {
      try {
        return [JSON.parse(rest.slice(0, index + 1)) as string, rest.slice(index + 1)];
      } catch {
        return [rest.slice(1, index), rest.slice(index + 1)];
      }
    }
  }
  return undefined;
}

const unquote = (value: string) => readString(value.trim())?.[0] ?? value.trim();

/**
 * Reads an ARIA snapshot, the YAML-like text Playwright's `ariaSnapshot()` writes:
 * `- role "name" [flag=value]: text`, nested by two spaces, with `/url:` style properties.
 */
export function parseAriaSnapshot(snapshot: string): RoleNode[] {
  const roots: Mutable[] = [];
  const stack: { depth: number; node: Mutable }[] = [];
  for (const line of snapshot.split('\n')) {
    const match = /^(\s*)- (.*)$/.exec(line);
    if (!match) continue;
    const depth = (match[1] ?? '').length;
    let rest = match[2] ?? '';
    while (stack.length > 0 && (stack.at(-1)?.depth ?? 0) >= depth) stack.pop();
    const parent = stack.at(-1)?.node;

    if (rest.startsWith('/')) {
      const colon = rest.indexOf(':');
      if (parent && colon > 0)
        parent.properties[rest.slice(1, colon)] = unquote(rest.slice(colon + 1));
      continue;
    }
    const role = /^[A-Za-z][\w-]*/.exec(rest)?.[0];
    if (!role) continue;
    rest = rest.slice(role.length);
    const node: Mutable = {
      role,
      name: '',
      attributes: {},
      properties: {},
      text: '',
      children: [],
    };
    if (rest.startsWith(' "')) {
      const read = readString(rest.slice(1));
      if (read) [node.name, rest] = read;
    }
    for (
      let flag = /^ \[([^\]=]+)(?:=([^\]]*))?\]/.exec(rest);
      flag;
      flag = /^ \[([^\]=]+)(?:=([^\]]*))?\]/.exec(rest)
    ) {
      node.attributes[flag[1] ?? ''] = flag[2] ?? 'true';
      rest = rest.slice(flag[0].length);
    }
    if (rest.startsWith(':')) {
      const inline = rest.slice(1).trim();
      if (inline !== '') node.text = unquote(inline);
    }
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push({ depth, node });
  }
  return roots;
}

/** Every node, depth first, with its ancestors. */
export function* walk(
  nodes: readonly RoleNode[],
  ancestors: readonly RoleNode[] = [],
): Generator<{ node: RoleNode; ancestors: readonly RoleNode[] }> {
  for (const node of nodes) {
    yield { node, ancestors };
    yield* walk(node.children, [...ancestors, node]);
  }
}

/** The text a node shows: its name, else its own and its children's text. */
export function textOf(node: RoleNode): string {
  if (node.name !== '') return node.name;
  return [node.text, ...node.children.map(textOf)].filter(Boolean).join(' ').trim();
}
