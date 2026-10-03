/** Markdown helpers shared by `pnpm docs` and the documentation tests. Pure: no files, no network. */

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const MARKER = /^<!--\s*example:\s*(\S+?)\s*-->\s*$/;
const REGION = /^\s*(?:\/\/|<!--|\/\*)\s*#(region|endregion)\b\s*([\w-]*)/;

/** Code fence languages by file extension. */
export const LANGUAGES: Readonly<Record<string, string>> = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.json': 'json',
  '.html': 'html',
  '.css': 'css',
  '.sh': 'sh',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

export interface Fence {
  /** The info string's first word, such as `ts`; empty when there is none. */
  lang: string;
  /** Zero-based lines of the opening and closing fences. */
  start: number;
  end: number;
  code: string;
}

/** Fenced code blocks: where each opens and closes, its language and its text. */
export function fences(markdown: string): Fence[] {
  const lines = markdown.split('\n');
  const found: Fence[] = [];
  let open: { marker: string; lang: string; start: number } | undefined;
  lines.forEach((line, index) => {
    const match = FENCE.exec(line);
    if (!match) return;
    const marker = match[1] ?? '';
    const info = (match[2] ?? '').trim();
    if (!open) {
      open = { marker, lang: info.split(/\s+/)[0] ?? '', start: index };
    } else if (marker[0] === open.marker[0] && marker.length >= open.marker.length && info === '') {
      found.push({
        lang: open.lang,
        start: open.start,
        end: index,
        code: lines.slice(open.start + 1, index).join('\n'),
      });
      open = undefined;
    }
  });
  return found;
}

/** The document's lines, with those inside code fences blanked, so line numbers still match. */
export function prose(markdown: string): string[] {
  const lines = markdown.split('\n');
  for (const fence of fences(markdown)) {
    for (let index = fence.start; index <= fence.end; index++) lines[index] = '';
  }
  return lines;
}

/** Heading text without its inline markup, as GitHub reads it for anchors. */
export function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(`+)(.*?)\1/g, '$2')
    .replace(/(\*\*|\*)(.*?)\1/g, '$2')
    .trim();
}

/** A heading's anchor, as GitHub writes it. */
export function slug(text: string): string {
  return plain(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

export interface Heading {
  level: number;
  text: string;
  /** Its anchor, numbered as GitHub numbers repeats: `usage`, `usage-1`. */
  slug: string;
  /** One-based. */
  line: number;
}

/** The document's headings, outside code, with their anchors. */
export function headings(markdown: string): Heading[] {
  const counts = new Map<string, number>();
  return prose(markdown).flatMap((line, index) => {
    const match = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (!match) return [];
    const base = slug(match[2] ?? '');
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    return [
      {
        level: match[1]?.length ?? 1,
        text: match[2] ?? '',
        slug: seen === 0 ? base : `${base}-${seen}`,
        line: index + 1,
      },
    ];
  });
}

/** Every anchor a link may name in the document: its headings and `<a id>` or `<a name>`. */
export function anchors(markdown: string): Set<string> {
  const found = new Set(headings(markdown).map((heading) => heading.slug));
  for (const line of prose(markdown)) {
    for (const match of line.matchAll(/<a\s[^>]*?(?:id|name)="([^"]+)"/g)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return found;
}

export interface Link {
  href: string;
  /** One-based. */
  line: number;
}

/** Links and images outside code: inline, reference definitions, and HTML `href` or `src`. */
export function links(markdown: string): Link[] {
  const found: Link[] = [];
  prose(markdown).forEach((raw, index) => {
    const line = raw.replace(/(`+)(.*?)\1/g, '');
    const add = (href: string | undefined) => {
      if (href) found.push({ href, line: index + 1 });
    };
    for (const match of line.matchAll(
      /!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
    )) {
      add(match[1]);
    }
    add(/^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/.exec(line)?.[1]);
    for (const match of line.matchAll(/<(?:a|img|source)\s[^>]*?(?:href|src|srcset)="([^"\s]+)/g)) {
      add(match[1]);
    }
  });
  return found;
}

export interface Marker {
  /** The example's path from the repository's root. */
  path: string;
  region?: string;
  /** Zero-based. */
  line: number;
}

/** The `<!-- example: path#region -->` markers outside code. */
export function markers(markdown: string): Marker[] {
  return prose(markdown).flatMap((line, index) => {
    const match = MARKER.exec(line);
    if (!match) return [];
    const [path = '', region] = (match[1] ?? '').split('#');
    return [{ path, ...(region ? { region } : {}), line: index }];
  });
}

const extension = (path: string) => /\.[^./]+$/.exec(path)?.[0] ?? '';

/**
 * A source file's text as a guide shows it: the lines between `// #region name` and
 * `// #endregion` (or the whole file without region markers), dedented.
 */
export function region(source: string, name?: string): string {
  const lines = source.replace(/\n+$/, '').split('\n');
  let picked = lines;
  if (name !== undefined) {
    const start = lines.findIndex((line) => {
      const match = REGION.exec(line);
      return match?.[1] === 'region' && match[2] === name;
    });
    if (start === -1) throw new Error(`No region "${name}"`);
    let depth = 0;
    let end = -1;
    for (let index = start + 1; index < lines.length && end === -1; index++) {
      const kind = REGION.exec(lines[index] ?? '')?.[1];
      if (kind === 'region') depth++;
      else if (kind === 'endregion') {
        if (depth === 0) end = index;
        else depth--;
      }
    }
    if (end === -1) throw new Error(`Region "${name}" never ends`);
    picked = lines.slice(start + 1, end);
  }
  const kept = picked.filter((line) => !REGION.test(line));
  const indents = kept
    .filter((line) => line.trim() !== '')
    .map((line) => /^ */.exec(line)?.[0].length ?? 0);
  const indent = indents.length > 0 ? Math.min(...indents) : 0;
  return `${kept.map((line) => line.slice(indent)).join('\n')}\n`;
}

/** A fence long enough for the code inside it. */
const fenceFor = (code: string) =>
  '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((match) => match[0].length + 1)));

/**
 * Refreshes the code fence after each `<!-- example: path#region -->` marker with that example,
 * so code in the docs is code that compiles and runs. A marker without a fence gets one.
 */
export async function embedExamples(
  markdown: string,
  snippet: (path: string, region: string | undefined) => Promise<string>,
): Promise<string> {
  const lines = markdown.split('\n');
  const found = new Map(markers(markdown).map((marker) => [marker.line, marker]));
  const out: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    out.push(lines[index] ?? '');
    const marker = found.get(index);
    if (!marker) continue;
    const code = (await snippet(marker.path, marker.region)).replace(/\n+$/, '');
    let next = index + 1;
    while (next < lines.length && (lines[next] ?? '').trim() === '') next++;
    const open = FENCE.exec(lines[next] ?? '');
    if (open) {
      const opening = open[1] ?? '```';
      let close = next + 1;
      while (close < lines.length) {
        const match = FENCE.exec(lines[close] ?? '');
        const closing = match?.[1] ?? '';
        const bare = !match?.[2]?.trim();
        if (match && closing[0] === opening[0] && closing.length >= opening.length && bare) break;
        close++;
      }
      index = close;
    }
    const fence = fenceFor(code);
    out.push('', `${fence}${LANGUAGES[extension(marker.path)] ?? ''}`, ...code.split('\n'), fence);
  }
  return out.join('\n');
}

/** Text for a table cell: one line, with pipes escaped. */
export const cell = (text: string) =>
  text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();

/** Inline code that survives the backticks inside it. */
export function inlineCode(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}
