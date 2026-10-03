import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { formatLikeProject } from './format.js';
import { folderOf } from './folder.js';
import { kebab } from './openapi.js';

/** Where `generate blocks` writes, in a project that keeps Uitive's files in `uitive/`; commands use the project's own folder (`folderOf`). */
export const BLOCKS = 'uitive/blocks.generated.ts';

/** One prop of a component, as a block's schema holds it. */
export interface BlockProp {
  /** The prop's name. */
  name: string;
  /** The zod schema, as code. */
  schema: string;
  /** What the prop is, from its JSDoc. */
  description: string;
  /** The component's default, when it has one: the planner must now always give a value. */
  fallback?: string;
}

/** A component read as a block: where it lives, what it is called, and its props. */
export interface ComponentBlock {
  /** The block's name in the contract, such as `orderSummary`. */
  name: string;
  /** The component's export name. */
  component: string;
  /** The file it comes from. */
  file: string;
  /** What people call it. */
  label: string;
  /** What it shows, for people and models. */
  description: string;
  /** The props a page may set, as data. */
  props: BlockProp[];
  /** Props an adapter supplies, such as callbacks and children. */
  adapter: { name: string; reason: string }[];
}

/** What reading components gives: the blocks, and the components that couldn't become one. */
export interface BlocksResult {
  /** Each component, as a block. */
  blocks: ComponentBlock[];
  /** Components whose props can't become a schema: fix or wrap them. */
  problems: string[];
}

/** Reads `file#Export` specifiers into blocks, with the project's compiler settings. */
export function readBlocks(specifiers: readonly string[], cwd: string): BlocksResult {
  const targets = specifiers.map((specifier) => {
    const [path = '', name = ''] = specifier.split('#');
    return { file: resolve(cwd, path), name, specifier };
  });
  const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json');
  const config = configPath
    ? ts.parseJsonConfigFileContent(
        ts.readConfigFile(configPath, ts.sys.readFile).config,
        ts.sys,
        dirname(configPath),
      ).options
    : {};
  const program = ts.createProgram(
    targets.map((target) => target.file),
    { jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, ...config, noEmit: true },
  );
  const checker = program.getTypeChecker();
  const blocks: ComponentBlock[] = [];
  const problems: string[] = [];

  for (const target of targets) {
    const source = program.getSourceFile(target.file);
    const module = source && checker.getSymbolAtLocation(source);
    if (!source || !module) {
      problems.push(`${target.specifier}: can't read ${relative(cwd, target.file)}`);
      continue;
    }
    if (!target.name) {
      problems.push(`${target.specifier}: name the component, as file#Component`);
      continue;
    }
    const symbol = checker.getExportsOfModule(module).find((entry) => entry.name === target.name);
    if (!symbol) {
      problems.push(`${target.specifier}: ${relative(cwd, target.file)} exports no ${target.name}`);
      continue;
    }
    const type = checker.getTypeOfSymbolAtLocation(symbol, source);
    const signature = type.getCallSignatures()[0] ?? type.getConstructSignatures()[0];
    const parameter = signature?.parameters[0];
    if (!signature || !parameter) {
      problems.push(`${target.specifier}: not a component that takes props`);
      continue;
    }
    const propsType = checker.getTypeOfSymbolAtLocation(parameter, source);
    const defaults = defaultsOf(symbol);
    const props: BlockProp[] = [];
    const adapter: ComponentBlock['adapter'] = [];
    const before = problems.length;
    for (const prop of checker.getPropertiesOfType(propsType)) {
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const propType = checker.getTypeOfSymbolAtLocation(prop, source);
      const description = ts.displayPartsToString(prop.getDocumentationComment(checker)).trim();
      const documented = prop
        .getJsDocTags(checker)
        .find((tag) => tag.name === 'default')
        ?.text?.map((part) => part.text)
        .join('')
        .trim();
      const mapped = schemaOf(checker, propType);
      if ('adapter' in mapped) {
        adapter.push({ name: prop.name, reason: mapped.adapter });
        continue;
      }
      if ('error' in mapped) {
        problems.push(`${target.specifier}: prop ${prop.name} is ${mapped.error}`);
        continue;
      }
      const fallback = defaults.get(prop.name) ?? documented;
      props.push({
        name: prop.name,
        schema: mapped.schema,
        description,
        ...(optional && fallback !== undefined ? { fallback } : {}),
      });
    }
    // A block with a prop no schema can hold would misrepresent the component: leave it out.
    if (problems.length > before) continue;
    const name = target.name.charAt(0).toLowerCase() + target.name.slice(1);
    const docs = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
    blocks.push({
      name,
      component: target.name,
      file: relative(cwd, target.file),
      label: kebab(target.name)
        .replace(/-/g, ' ')
        .replace(/^./, (first) => first.toUpperCase()),
      description: docs || `The ${kebab(target.name).replace(/-/g, ' ')} component`,
      props,
      adapter,
    });
  }
  return { blocks, problems };
}

/** Defaults written in the component's destructured props, such as `variant = 'compact'`. */
function defaultsOf(symbol: ts.Symbol): Map<string, string> {
  const found = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isObjectBindingPattern(node)) {
      for (const element of node.elements) {
        if (element.initializer && ts.isIdentifier(element.propertyName ?? element.name)) {
          found.set(
            (element.propertyName ?? element.name).getText(),
            element.initializer.getText(),
          );
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const declaration of symbol.declarations ?? []) {
    const first = ts.isFunctionDeclaration(declaration)
      ? declaration.parameters[0]
      : ts.isVariableDeclaration(declaration) && declaration.initializer
        ? (() => {
            let parameter: ts.ParameterDeclaration | undefined;
            const find = (node: ts.Node): void => {
              if (parameter) return;
              if (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
                parameter = node.parameters[0];
              else ts.forEachChild(node, find);
            };
            find(declaration.initializer);
            return parameter;
          })()
        : undefined;
    if (first) visit(first.name);
  }
  return found;
}

type Mapped = { schema: string } | { adapter: string } | { error: string };

const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function schemaOf(checker: ts.TypeChecker, type: ts.Type, depth = 0): Mapped {
  const text = checker.typeToString(type);
  if (
    /^(React\.)?(ReactNode|ReactElement|JSX\.Element)\b/.test(text) ||
    /ReactElement</.test(text)
  ) {
    return { adapter: 'content from the application' };
  }
  // What's optional or nullable must now always be given; the component's default is documented.
  const members = (type.isUnion() ? type.types : [type]).filter(
    (member) =>
      (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) === 0,
  );
  if (members.length > 0 && members.every((member) => member.getCallSignatures().length > 0)) {
    return { adapter: 'a function' };
  }
  if (members.length > 0 && members.every((member) => member.isStringLiteral())) {
    return {
      schema: `z.enum([${members.map((member) => quote((member as ts.StringLiteralType).value)).join(', ')}])`,
    };
  }
  if (
    members.length > 0 &&
    members.every((member) => (member.flags & ts.TypeFlags.BooleanLike) !== 0)
  ) {
    return { schema: 'z.boolean()' };
  }
  if (members.length === 1) {
    const [only] = members as [ts.Type];
    if (only.flags & ts.TypeFlags.String) return { schema: 'z.string()' };
    if (only.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral))
      return { schema: 'z.number()' };
    if (checker.isArrayType(only) && depth === 0) {
      const [element] = checker.getTypeArguments(only as ts.TypeReference);
      if (element) {
        const inner = schemaOf(checker, element, depth + 1);
        if ('schema' in inner) return { schema: `z.array(${inner.schema})` };
        return 'adapter' in inner ? inner : { error: `a list of ${checker.typeToString(element)}` };
      }
    }
    if (only.flags & ts.TypeFlags.Any || only.flags & ts.TypeFlags.Unknown) {
      return { error: 'untyped' };
    }
    if (only.flags & ts.TypeFlags.Object) return { adapter: 'an object the application supplies' };
  }
  if (members.length > 0 && members.every((member) => member.isNumberLiteral())) {
    return { schema: 'z.number()' };
  }
  return { error: `${text}, a union a schema can't hold; split the prop or wrap the component` };
}

/** Writes blocks as a module of block specs, ready to spread into a contract's `blocks`. */
export function emitBlocks(
  blocks: readonly ComponentBlock[],
  core = '@plurid/uitive-core',
): string {
  const entries = blocks.map((entry) => {
    const props = entry.props
      .map((prop) => {
        const note = [
          prop.description,
          prop.fallback === undefined ? '' : `The component's default: ${prop.fallback}.`,
        ]
          .filter(Boolean)
          .join(' ');
        return `      ${prop.name}: ${prop.schema}${note ? `.describe(${quote(note)})` : ''},`;
      })
      .join('\n');
    const supplied =
      entry.adapter.length === 0
        ? ''
        : `  // The adapter supplies ${entry.adapter.map((prop) => `${prop.name} (${prop.reason})`).join(', ')}.\n`;
    return `${supplied}  ${entry.name}: block({
    label: ${quote(entry.label)},
    description: ${quote(entry.description)},
    props: z.object({
${props}
    }),
  }),`;
  });
  return [
    "// Generated by `uitive generate blocks` from the components' props.",
    '// Regenerate after changing them; `uitive generate blocks --check` reports drift.',
    `import { block } from ${quote(core)};`,
    "import { z } from 'zod';",
    '',
    'export const blocks = {',
    entries.join('\n'),
    '};',
    '',
  ].join('\n');
}

/** What `generate blocks` takes: the components, where to write, and whether only to check. */
export interface GenerateBlocksOptions {
  /** `file#Component` for each component. */
  components: readonly string[];
  /** The project's root. @default process.cwd() */
  cwd?: string;
  /** Where to write. @default 'blocks.generated.ts' in the project's Uitive folder */
  out?: string;
  /** Reports whether the file is up to date, without writing it. */
  check?: boolean;
}

/**
 * Generates block specs from components' TypeScript props and writes them, or reports drift with
 * `check`.
 */
export async function generateBlocks(options: GenerateBlocksOptions) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const file = resolve(cwd, options.out ?? `${await folderOf(cwd)}/blocks.generated.ts`);
  const result = readBlocks(options.components, cwd);
  const code = await formatLikeProject(emitBlocks(result.blocks), file, cwd);
  const current = await readFile(file, 'utf8').catch(() => undefined);
  const drift = current !== code;
  const write = !options.check && result.problems.length === 0;
  if (write && drift) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, code);
  }
  return {
    file: relative(cwd, file),
    written: write && drift,
    drift,
    blocks: result.blocks.map(({ name, component, props, adapter }) => ({
      name,
      component,
      props: props.map((prop) => prop.name),
      adapter: adapter.map((prop) => prop.name),
    })),
    problems: result.problems,
  };
}
