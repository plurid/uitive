// The API reference, generated from the packages' declarations and JSDoc: `pnpm run docs` writes it
// to docs/api, and tools/tests/api.test.ts checks it is current and complete.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import ts from 'typescript';
import { ADVANCED, PAGES } from './api-pages.ts';
import { cell, inlineCode, slug } from './markdown.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
/** Where declarations would be emitted; nothing is ever written there. */
const OUT = join(root, '.api-declarations');

export type Kind = 'function' | 'class' | 'object' | 'constant' | 'interface' | 'type';

export interface Member {
  /** As a table shows it: `ask()`, `maxBody?`. */
  name: string;
  type: string;
  default?: string;
  summary: string;
}

export interface Entry {
  /** The exported name. */
  name: string;
  symbol: ts.Symbol;
  /** The package whose page documents it: where it is declared. */
  page: string;
  /** Every specifier that exports it, such as `@plurid/uitive-server/node`. */
  specifiers: string[];
  /** The declaring file, from the package's `src`, such as `contract.ts`. */
  module: string;
  /** The declaring file, from the repository's root. */
  source: string;
  kind: Kind;
  category: string;
  summary: string;
  tags: { name: string; text: string }[];
  signatures: string[];
  members: Member[];
  /** Members too wide for a table's type column: the declaration shows them instead. */
  wide: boolean;
  /** For interfaces and types: their type parameters, as declared. */
  typeParameters: string[];
  uses: ts.Symbol[];
}

export interface PackageInfo {
  name: string;
  description: string;
  peers: Readonly<Record<string, string>>;
  specifiers: string[];
}

export interface Problems {
  /** Public symbols without a summary. */
  undocumented: string[];
  /** Members of interfaces, classes and objects without a summary. */
  members: string[];
  /** Types public declarations use that aren't public themselves. */
  dangling: string[];
  categories: string[];
  links: string[];
  /** Signatures too long or tangled to read: give them explicit types. */
  long: string[];
}

export interface Model {
  entries: Entry[];
  packages: Map<string, PackageInfo>;
  problems: Problems;
}

interface Point {
  page: string;
  specifier: string;
  file: string;
}

const HOOKS = new Set([
  'connectedCallback',
  'disconnectedCallback',
  'attributeChangedCallback',
  'adoptedCallback',
  'observedAttributes',
]);

/** Interfaces whose every member is an option a person sets, so each needs a description. */

const fromRoot = (path: string) => relative(root, path).split('\\').join('/');

/** Every package's entry points, read from its `exports`, with what the pages need to know. */
function entryPoints(): { points: Point[]; packages: Map<string, PackageInfo> } {
  const points: Point[] = [];
  const packages = new Map<string, PackageInfo>();
  for (const dir of readdirSync(join(root, 'packages')).sort()) {
    const path = join(root, 'packages', dir, 'package.json');
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
      name: string;
      description?: string;
      peerDependencies?: Record<string, string>;
      exports: Record<string, string | { types: string }>;
    };
    const specifiers: string[] = [];
    for (const [key, value] of Object.entries(manifest.exports)) {
      // An entry without declarations, such as the CLI's binary for `npx uitive`, has no API.
      if (typeof value === 'string') continue;
      const base = value.types.replace(/^\.\/dist\//, '').replace(/\.d\.ts$/, '');
      const file = ['ts', 'tsx']
        .map((extension) => join(root, 'packages', dir, 'src', `${base}.${extension}`))
        .find((candidate) => existsSync(candidate));
      if (!file) throw new Error(`${manifest.name}: no source for ${key}`);
      const specifier = key === '.' ? manifest.name : `${manifest.name}${key.slice(1)}`;
      points.push({ page: dir, specifier, file });
      specifiers.push(specifier);
    }
    packages.set(dir, {
      name: manifest.name,
      description: manifest.description ?? '',
      peers: manifest.peerDependencies ?? {},
      specifiers,
    });
  }
  return { points, packages };
}

/** One program over every entry point, configured like the repository's own tests. */
function createProgram(files: readonly string[]): ts.Program {
  const configPath = join(root, 'tools/config/tsconfig.tests.json');
  const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  const options: ts.CompilerOptions = {
    ...parsed.options,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    noEmitOnError: false,
    sourceMap: false,
    declarationMap: false,
    inlineSourceMap: false,
    inlineSources: false,
    composite: false,
    incremental: false,
    rootDir: root,
    outDir: OUT,
  };
  delete options.tsBuildInfoFile;
  return ts.createProgram(files, options);
}

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/** A declaration as its reader writes it: no `export` or `declare`, no `import("...")` paths. */
function print(node: ts.Node, file: ts.SourceFile): string {
  return printer
    .printNode(ts.EmitHint.Unspecified, node, file)
    .replace(/^(export\s+)?(default\s+)?(declare\s+)?/gm, '')
    .replace(/import\("[^"]+"\)\./g, '')
    .replace(/\bextends Base\b/g, 'extends HTMLElement');
}

/** Rewrites a node, such as to rename destructured parameters. */
function rewrite<T extends ts.Node>(node: T, visit: (node: ts.Node) => ts.Node | undefined): T {
  const result = ts.transform(node, [
    (context) => (top) => {
      const visitor = (child: ts.Node): ts.Node =>
        visit(child) ?? ts.visitEachChild(child, visitor, context);
      return ts.visitNode(top, visitor) as T;
    },
  ]);
  const [transformed] = result.transformed;
  result.dispose();
  return transformed as T;
}

/** Destructured parameters read as `props` for components, `options` otherwise. */
function nameParameters<T extends ts.Node>(node: T, component: boolean): T {
  return rewrite(node, (child) => {
    if (!ts.isParameter(child) || ts.isIdentifier(child.name)) return undefined;
    return ts.factory.updateParameterDeclaration(
      child,
      child.modifiers,
      child.dotDotDotToken,
      ts.factory.createIdentifier(component ? 'props' : 'options'),
      child.questionToken,
      child.type,
      undefined,
    );
  });
}

/** The top-level statements of an emitted declaration file that declare a name. */
function statementsNamed(file: ts.SourceFile, name: string): ts.Statement[] {
  return file.statements.filter((statement) => {
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
      );
    }
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      return statement.name?.text === name;
    }
    return false;
  });
}

const modifierFlags = (node: ts.Node) => ts.getCombinedModifierFlags(node as ts.Declaration);

const memberName = (member: ts.ClassElement | ts.TypeElement) =>
  member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
    ? member.name.text
    : member.name && ts.isPrivateIdentifier(member.name)
      ? '#'
      : '';

/** Whether a class member belongs in its documentation: public, or protected on an abstract class. */
function shown(member: ts.ClassElement, abstract: boolean): boolean {
  const name = memberName(member);
  if (name.startsWith('#') || HOOKS.has(name)) return false;
  if (ts.isConstructorDeclaration(member) && member.parameters.length === 0) return false;
  const flags = modifierFlags(member);
  if (flags & ts.ModifierFlags.Private) return false;
  return !(flags & ts.ModifierFlags.Protected) || abstract;
}

const docText = (parts: readonly ts.SymbolDisplayPart[] | undefined) =>
  ts.displayPartsToString([...(parts ?? [])]).trim();

const tagsOf = (symbol: ts.Symbol, checker: ts.TypeChecker) =>
  symbol.getJsDocTags(checker).map((tag) => ({ name: tag.name, text: docText(tag.text) }));

/** A type as its source spells it, on one line. */
const spelled = (node: ts.Node) => node.getText().replace(/\s+/g, ' ').trim();

function memberOf(property: ts.Symbol, checker: ts.TypeChecker): Member {
  const declaration = property.valueDeclaration ?? property.declarations?.[0];
  const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
  let method = false;
  let type: string;
  if (declaration && (ts.isMethodSignature(declaration) || ts.isMethodDeclaration(declaration))) {
    method = true;
    const parameters = declaration.parameters.map(spelled).join(', ');
    type = `(${parameters}) => ${declaration.type ? spelled(declaration.type) : 'void'}`;
  } else if (
    declaration &&
    (ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration)) &&
    declaration.type
  ) {
    type = spelled(declaration.type);
  } else {
    type = checker
      .typeToString(checker.getTypeOfSymbol(property), undefined, ts.TypeFormatFlags.NoTruncation)
      .replace(/import\("[^"]+"\)\./g, '');
  }
  const tags = tagsOf(property, checker);
  const fallback = tags.find((tag) => tag.name === 'default')?.text;
  return {
    name: `${property.name}${optional ? '?' : ''}${method ? '()' : ''}`,
    type,
    ...(fallback === undefined ? {} : { default: fallback }),
    summary: docText(property.getDocumentationComment(checker)),
  };
}

/** The symbols a declaration's types name: its parameters, results, members and aliases. */
function referenced(declaration: ts.Declaration, checker: ts.TypeChecker): Set<ts.Symbol> {
  const found = new Set<ts.Symbol>();
  const add = (node: ts.Node) => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    if (symbol) found.add(symbol);
  };
  const visitType = (node: ts.Node | undefined) => {
    if (!node) return;
    const walk = (child: ts.Node) => {
      if (ts.isTypeReferenceNode(child)) {
        add(ts.isQualifiedName(child.typeName) ? child.typeName.right : child.typeName);
      } else if (ts.isTypeQueryNode(child)) {
        add(ts.isQualifiedName(child.exprName) ? child.exprName.right : child.exprName);
      }
      ts.forEachChild(child, walk);
    };
    walk(node);
  };
  const visitSignature = (node: ts.SignatureDeclaration) => {
    node.typeParameters?.forEach((parameter) => visitType(parameter.constraint));
    node.parameters.forEach((parameter) => visitType(parameter.type));
    visitType(node.type);
  };
  if (ts.isFunctionDeclaration(declaration)) visitSignature(declaration);
  else if (ts.isVariableDeclaration(declaration)) {
    visitType(declaration.type);
    const initializer = declaration.initializer;
    if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
      visitSignature(initializer);
    }
  } else if (ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration)) {
    declaration.typeParameters?.forEach((parameter) => visitType(parameter.constraint));
    for (const member of declaration.members) {
      // A class's private and lifecycle members are no reader's concern.
      if (ts.isClassDeclaration(declaration) && !shown(member as ts.ClassElement, true)) continue;
      if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member))
        visitType(member.type);
      else if (
        ts.isMethodSignature(member) ||
        ts.isMethodDeclaration(member) ||
        ts.isConstructorDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member)
      ) {
        if (ts.isClassDeclaration(declaration) && !shown(member as ts.ClassElement, true)) continue;
        visitSignature(member);
      }
    }
  } else if (ts.isTypeAliasDeclaration(declaration)) {
    declaration.typeParameters?.forEach((parameter) => visitType(parameter.constraint));
    visitType(declaration.type);
  }
  return found;
}

/** Named types an inferred type reaches, a few levels deep. */
function inferred(type: ts.Type, checker: ts.TypeChecker, found: Set<ts.Symbol>, depth = 0): void {
  if (depth > 3) return;
  if (type.aliasSymbol) found.add(type.aliasSymbol);
  type.aliasTypeArguments?.forEach((argument) => inferred(argument, checker, found, depth + 1));
  if (type.isUnionOrIntersection()) {
    for (const member of type.types) inferred(member, checker, found, depth + 1);
    return;
  }
  if (!(type.flags & ts.TypeFlags.Object)) return;
  const object = type as ts.ObjectType;
  if (object.objectFlags & ts.ObjectFlags.Reference) {
    for (const argument of checker.getTypeArguments(type as ts.TypeReference)) {
      inferred(argument, checker, found, depth + 1);
    }
  }
  const symbol = type.getSymbol();
  const anonymous =
    !symbol ||
    (symbol.flags &
      (ts.SymbolFlags.TypeLiteral |
        ts.SymbolFlags.ObjectLiteral |
        ts.SymbolFlags.Function |
        ts.SymbolFlags.Method)) !==
      0 ||
    symbol.name === '__type' ||
    symbol.name === '__function' ||
    symbol.name === '__object';
  if (!anonymous && symbol) {
    found.add(symbol);
    return;
  }
  for (const signature of type.getCallSignatures()) {
    for (const parameter of signature.getParameters()) {
      inferred(checker.getTypeOfSymbol(parameter), checker, found, depth + 1);
    }
    inferred(signature.getReturnType(), checker, found, depth + 1);
  }
  for (const property of type.getProperties()) {
    inferred(checker.getTypeOfSymbol(property), checker, found, depth + 1);
  }
}

/** Whether a symbol is declared in a package's sources, rather than a dependency or the language. */
const ours = (symbol: ts.Symbol) =>
  (symbol.declarations ?? []).some((declaration) =>
    /\/packages\/[^/]+\/src\//.test(declaration.getSourceFile().fileName.split('\\').join('/')),
  );

/** Reads every package's public API: what each export is, says and uses. */
export function apiModel(): Model {
  const { points, packages } = entryPoints();
  const program = createProgram(points.map((point) => point.file));
  const checker = program.getTypeChecker();
  const declarations = new Map<string, ts.SourceFile>();
  program.emit(
    undefined,
    (name, text) => {
      if (name.endsWith('.d.ts')) {
        declarations.set(
          normalize(name),
          ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true),
        );
      }
    },
    undefined,
    true,
  );
  const emitted = (source: string) =>
    declarations.get(normalize(join(OUT, relative(root, source)).replace(/\.tsx?$/, '.d.ts')));

  const problems: Problems = {
    undocumented: [],
    members: [],
    dangling: [],
    categories: [],
    links: [],
    long: [],
  };
  const bySymbol = new Map<ts.Symbol, Entry>();
  const entries: Entry[] = [];

  for (const point of points) {
    const file = program.getSourceFile(point.file);
    const module = file && checker.getSymbolAtLocation(file);
    if (!module) throw new Error(`No module for ${point.file}`);
    for (const exported of checker.getExportsOfModule(module)) {
      const symbol =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const existing = bySymbol.get(symbol);
      if (existing) {
        if (!existing.specifiers.includes(point.specifier))
          existing.specifiers.push(point.specifier);
        continue;
      }
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
      if (!declaration) continue;
      const source = declaration.getSourceFile().fileName;
      const match = /\/packages\/([^/]+)\/src\/(.+)$/.exec(source.split('\\').join('/'));
      if (!match) {
        problems.categories.push(
          `${point.specifier}: ${exported.name} isn't declared in a package's sources`,
        );
        continue;
      }
      const entry = describe(exported.name, symbol, declaration, checker, emitted, problems);
      entry.page = match[1] ?? point.page;
      entry.module = match[2] ?? '';
      entry.source = fromRoot(source);
      entry.specifiers.push(point.specifier);
      bySymbol.set(symbol, entry);
      entries.push(entry);
    }
  }

  // Categories, summaries with resolved links, and what each entry uses.
  const named = new Map<string, Entry[]>();
  for (const entry of entries) named.set(entry.name, [...(named.get(entry.name) ?? []), entry]);
  for (const entry of entries) {
    const config = PAGES[entry.page];
    const tagged = entry.tags.find((tag) => tag.name === 'category')?.text;
    const byModule = config?.categories.find((category) => category.modules.includes(entry.module));
    const category = tagged ?? byModule?.title;
    if (!config || !category || !config.categories.some((each) => each.title === category)) {
      problems.categories.push(`${entry.page}: ${entry.name} (${entry.module}) has no category`);
    }
    entry.category = category ?? ADVANCED;
    const parts = entry.symbol.getDocumentationComment(checker);
    let summary = '';
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index] as ts.SymbolDisplayPart;
      if (part.kind === 'link') continue;
      if (part.kind === 'linkName' || part.kind === 'linkText') {
        const name = part.text.trim();
        const target = named.get(name)?.[0];
        if (!target)
          problems.links.push(`${entry.page}: ${entry.name} links to ${name}, which isn't public`);
        summary += target
          ? `[${inlineCode(name)}](#link:${entries.indexOf(target)})`
          : inlineCode(name);
        continue;
      }
      summary += part.text;
    }
    entry.summary = summary.trim();
    if (!entry.summary)
      problems.undocumented.push(`${entry.page}: ${entry.name} (${entry.source})`);
    for (const member of entry.members) {
      if (!member.summary) {
        problems.members.push(`${entry.page}: ${entry.name}.${member.name} (${entry.source})`);
      }
    }
    const declaration = entry.symbol.valueDeclaration ?? entry.symbol.declarations?.[0];
    if (!declaration) continue;
    const uses = referenced(declaration, checker);
    const untyped =
      (ts.isFunctionDeclaration(declaration) && !declaration.type) ||
      (ts.isVariableDeclaration(declaration) && !declaration.type);
    if (untyped) inferred(checker.getTypeOfSymbol(entry.symbol), checker, uses);
    uses.delete(entry.symbol);
    entry.uses = [...uses].filter((symbol) => bySymbol.has(symbol));
    for (const symbol of uses) {
      if (bySymbol.has(symbol) || !ours(symbol) || symbol.flags & ts.SymbolFlags.TypeParameter)
        continue;
      const where = symbol.declarations?.[0]?.getSourceFile().fileName ?? '';
      if (/\.test\.tsx?$/.test(where)) continue;
      problems.dangling.push(
        `${entry.page}: ${entry.name} uses ${symbol.name} (${fromRoot(where)}), which isn't public`,
      );
    }
    // A declaration shows as it is; anything else that reads as a tangle needs an explicit type.
    if (entry.kind !== 'interface' && entry.kind !== 'class' && !entry.wide) {
      for (const signature of entry.signatures) {
        if (signature.includes('import(') || signature.replace(/\s+/g, ' ').length > 600) {
          problems.long.push(`${entry.page}: ${entry.name}`);
        }
      }
    }
  }
  return { entries, packages, problems };
}

/** What an export is, its signatures and members, read from its declaration and emitted types. */
function describe(
  name: string,
  symbol: ts.Symbol,
  declaration: ts.Declaration,
  checker: ts.TypeChecker,
  emitted: (source: string) => ts.SourceFile | undefined,
  problems: Problems,
): Entry {
  const entry: Entry = {
    name,
    symbol,
    page: '',
    specifiers: [],
    module: '',
    source: '',
    kind: 'constant',
    category: '',
    summary: '',
    tags: tagsOf(symbol, checker),
    signatures: [],
    members: [],
    wide: false,
    typeParameters: [],
    uses: [],
  };
  if (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)) {
    entry.typeParameters = (declaration.typeParameters ?? []).map(spelled);
  }
  const declared = declaration.getSourceFile().fileName;
  const dts = emitted(declared);
  // An export may rename its declaration: `export { a as b }`.
  const named = (declaration as { name?: ts.Node }).name;
  const own = named && ts.isIdentifier(named) ? named.text : name;
  const statements = dts ? statementsNamed(dts, own) : [];
  if (!dts || statements.length === 0) {
    problems.categories.push(`${name}: no emitted declaration in ${fromRoot(declared)}`);
    return entry;
  }
  const component = /^[A-Z]/.test(name);
  const signatures = (nodes: readonly ts.Node[]) =>
    nodes.map((node) => print(nameParameters(node, component), dts).trim());

  if (ts.isFunctionDeclaration(declaration)) {
    entry.kind = 'function';
    entry.signatures = signatures(statements);
  } else if (ts.isClassDeclaration(declaration)) {
    entry.kind = 'class';
    const statement = statements[0] as ts.ClassDeclaration;
    const abstract = (modifierFlags(statement) & ts.ModifierFlags.Abstract) !== 0;
    const members = statement.members.filter((member) => shown(member, abstract));
    entry.signatures = signatures([
      ts.factory.updateClassDeclaration(
        statement,
        statement.modifiers,
        statement.name,
        statement.typeParameters,
        statement.heritageClauses,
        members,
      ),
    ]);
    const instance = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol));
    const statics = checker.getPropertiesOfType(checker.getTypeOfSymbol(symbol));
    entry.members = [...statics.filter((property) => property.name !== 'prototype'), ...instance]
      .filter((property) => {
        const node = property.valueDeclaration ?? property.declarations?.[0];
        // Only what this class declares: what it inherits is documented where it is declared.
        return (
          node &&
          ts.isClassElement(node) &&
          node.parent === declaration &&
          shown(node, abstract) &&
          !ts.isConstructorDeclaration(node)
        );
      })
      .map((property) => memberOf(property, checker));
  } else if (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)) {
    entry.kind = ts.isInterfaceDeclaration(declaration) ? 'interface' : 'type';
    const literal =
      ts.isInterfaceDeclaration(declaration) || ts.isTypeLiteralNode(declaration.type);
    if (literal) {
      entry.members = checker
        .getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))
        .filter(ours)
        .map((property) => memberOf(property, checker));
    }
    entry.wide = !literal || entry.members.some((member) => member.type.length > 90);
    if (entry.wide) entry.signatures = signatures(statements);
  } else if (ts.isVariableDeclaration(declaration)) {
    const statement = statements[0] as ts.VariableStatement;
    const variable = statement.declarationList.declarations[0] as ts.VariableDeclaration;
    const initializer = declaration.initializer;
    const typed = declaration.type !== undefined;
    if (variable.type && ts.isFunctionTypeNode(variable.type)) {
      entry.kind = 'function';
      const fn = ts.factory.createFunctionDeclaration(
        undefined,
        undefined,
        variable.name as ts.Identifier,
        variable.type.typeParameters,
        variable.type.parameters,
        variable.type.type,
        undefined,
      );
      entry.signatures = signatures([fn]);
    } else if (
      !typed &&
      initializer &&
      ts.isObjectLiteralExpression(initializer) &&
      initializer.properties.length > 0 &&
      initializer.properties.every(
        (property) =>
          ts.isMethodDeclaration(property) ||
          ts.isShorthandPropertyAssignment(property) ||
          (ts.isPropertyAssignment(property) &&
            (ts.isArrowFunction(property.initializer) ||
              ts.isFunctionExpression(property.initializer) ||
              ts.isIdentifier(property.initializer))),
      )
    ) {
      entry.kind = 'object';
      const methods: ts.TypeElement[] = [];
      const literal =
        variable.type && ts.isTypeLiteralNode(variable.type) ? variable.type : undefined;
      for (const member of literal?.members ?? []) {
        if (!ts.isPropertySignature(member) || !member.type) continue;
        const key = member.name as ts.PropertyName;
        const method = (node: ts.SignatureDeclarationBase) =>
          ts.factory.createMethodSignature(
            undefined,
            key,
            undefined,
            node.typeParameters,
            node.parameters,
            node.type,
          );
        if (ts.isFunctionTypeNode(member.type)) methods.push(method(member.type));
        else if (ts.isTypeQueryNode(member.type) && ts.isIdentifier(member.type.exprName)) {
          // `time: typeof time`: the overloads the emitted file declares.
          const overloads = statementsNamed(dts, member.type.exprName.text).filter(
            ts.isFunctionDeclaration,
          );
          methods.push(...overloads.map(method));
        }
      }
      entry.signatures = [
        print(
          ts.factory.createVariableStatement(
            undefined,
            ts.factory.createVariableDeclarationList(
              [
                ts.factory.createVariableDeclaration(
                  name,
                  undefined,
                  ts.factory.createTypeLiteralNode(methods),
                ),
              ],
              ts.NodeFlags.Const,
            ),
          ),
          dts,
        ).trim(),
      ];
      for (const property of checker.getPropertiesOfType(checker.getTypeOfSymbol(symbol))) {
        entry.members.push({ ...memberOf(property, checker), name: `${property.name}()` });
      }
    } else {
      entry.kind = 'constant';
      let text = print(statement, dts).trim();
      // Long strings show as strings: a prompt or a stylesheet doesn't belong in a reference.
      const initial =
        initializer && ts.isStringLiteralLike(initializer) ? initializer.text : undefined;
      if (initial !== undefined && (initial.length > 60 || initial.includes('\n'))) {
        text = `const ${name}: string;`;
      } else if (initializer && ts.isRegularExpressionLiteral(initializer)) {
        text = `const ${name}: RegExp = ${initializer.text};`;
      } else if (text.length > 300) {
        // A schema's inferred type is its whole shape: its kind says enough here.
        const type = checker.getTypeOfSymbol(symbol);
        const kind = (type.aliasSymbol ?? type.getSymbol())?.name ?? 'object';
        text = `const ${name}: ${kind};`;
      }
      entry.signatures = [text];
    }
  }
  return entry;
}

const VALUES: readonly Kind[] = ['function', 'class', 'object', 'constant'];
const order = (a: Entry, b: Entry) =>
  Number(!VALUES.includes(a.kind)) - Number(!VALUES.includes(b.kind)) ||
  a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
  a.name.localeCompare(b.name);

const KIND_WORD: Readonly<Record<Kind, string>> = {
  function: 'function',
  class: 'class',
  object: 'object',
  constant: 'constant',
  interface: 'type',
  type: 'type',
};

/** Formats TypeScript as the repository's Prettier would, failing loudly on what doesn't parse. */
async function formatCode(code: string, where: string): Promise<string> {
  const filepath = join(root, 'docs/api/signature.ts');
  try {
    return (await format(code, { ...((await resolveConfig(filepath)) ?? {}), filepath })).trim();
  } catch (error) {
    throw new Error(`${where}: ${(error as Error).message}\n${code}`, { cause: error });
  }
}

/** The API pages, by path from the repository's root, formatted and ready to write. */
export async function renderApiPages(model: Model): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const pageOf = (page: string) => model.entries.filter((entry) => entry.page === page);
  const categoryAnchors = (page: string) =>
    new Set((PAGES[page]?.categories ?? []).map((category) => slug(category.title)));
  // A type named like a value (`Query` beside `query`), or an entry named like a category, gets
  // its kind in its heading, so every anchor stays unique.
  const heading = (entry: Entry) => {
    const clash =
      categoryAnchors(entry.page).has(slug(entry.name)) ||
      pageOf(entry.page).some(
        (other) =>
          other !== entry &&
          other.name.toLowerCase() === entry.name.toLowerCase() &&
          VALUES.includes(other.kind) &&
          !VALUES.includes(entry.kind),
      );
    return clash ? `${entry.name} ${KIND_WORD[entry.kind]}` : entry.name;
  };
  const anchors = new Map<Entry, string>(
    model.entries.map((entry) => [entry, slug(heading(entry))]),
  );
  const link = (target: Entry, from: string) =>
    `${target.page === from ? '' : `${target.page}.md`}#${anchors.get(target) ?? ''}`;
  const reference = (target: Entry, from: string) =>
    `[${inlineCode(target.name)}](${link(target, from)})`;
  const resolveLinks = (text: string, from: string) =>
    text.replace(/\(#link:(\d+)\)/g, (_, index: string) => {
      const target = model.entries[Number(index)];
      return target ? `(${link(target, from)})` : '()';
    });

  for (const [page, info] of model.packages) {
    const config = PAGES[page];
    if (!config) throw new Error(`No API page configuration for ${page}`);
    const entries = pageOf(page).sort(order);
    const lines: string[] = [
      `# ${info.name}`,
      '',
      `<!-- Generated by \`pnpm run docs\` from packages/${page}/src: edit the JSDoc there. -->`,
      '',
      config.intro,
      '',
    ];
    const peers = Object.entries(info.peers)
      .map(([name, range]) => `${inlineCode(name)} ${range}`)
      .join(', ');
    lines.push(
      `Install: ${inlineCode(`pnpm add ${info.name}`)}${peers ? `, with ${peers} as ${Object.keys(info.peers).length === 1 ? 'a peer' : 'peers'}` : ''}. Guides: ${config.guides
        .map((guide) => `[${guide.title}](../${guide.path})`)
        .join(', ')}.`,
      '',
    );
    const categories = config.categories
      .map((category) => ({
        ...category,
        entries: entries.filter((entry) => entry.category === category.title),
      }))
      .filter((category) => category.entries.length > 0);
    for (const category of categories) {
      lines.push(
        `- [${category.title}](#${slug(category.title)}): ${category.entries.map((entry) => reference(entry, page)).join(', ')}`,
      );
    }
    const reexported = model.entries
      .filter(
        (entry) =>
          entry.page !== page &&
          entry.specifiers.some((specifier) => info.specifiers.includes(specifier)),
      )
      .sort(order);
    if (reexported.length > 0) lines.push('- [Re-exported](#re-exported)');
    lines.push('');

    const seen = new Set<string>();
    const unique = (text: string) => {
      const anchor = slug(text);
      if (seen.has(anchor)) throw new Error(`${page}: two headings make #${anchor}`);
      seen.add(anchor);
    };
    for (const category of categories) {
      unique(category.title);
      lines.push(`## ${category.title}`, '');
      if (category.summary) lines.push(category.summary, '');
      const modules = [...new Set(category.entries.map((entry) => entry.source))].sort();
      lines.push(
        `Source: ${modules.map((source) => `[${inlineCode(source.split('/').slice(3).join('/'))}](../../${source})`).join(', ')}`,
        '',
      );
      for (const entry of category.entries) {
        unique(heading(entry));
        lines.push(`### ${heading(entry)}`, '');
        if (entry.summary) lines.push(resolveLinks(entry.summary, page), '');
        for (const tag of entry.tags) {
          if (tag.name === 'deprecated') lines.push(`**Deprecated.** ${tag.text}`, '');
          if (tag.name === 'see') lines.push(`See ${tag.text}.`, '');
        }
        if (entry.signatures.length > 0) {
          const code = await formatCode(entry.signatures.join('\n'), `${page}: ${entry.name}`);
          lines.push('```ts', code, '```', '');
        }
        const main = info.specifiers[0] ?? info.name;
        const elsewhere = entry.specifiers.filter((specifier) => specifier !== main);
        if (!entry.specifiers.includes(main) && entry.specifiers.length > 0) {
          lines.push(
            `Import from ${entry.specifiers.map((specifier) => inlineCode(specifier)).join(' or ')}.`,
            '',
          );
        } else if (elsewhere.length > 0) {
          lines.push(
            `Also exported by ${elsewhere.map((specifier) => inlineCode(specifier)).join(', ')}.`,
            '',
          );
        }
        const uses = entry.uses
          .map((symbol) => model.entries.find((other) => other.symbol === symbol))
          .filter((other): other is Entry => other !== undefined)
          .sort(order);
        if (uses.length > 0) {
          lines.push(`Uses: ${uses.map((other) => reference(other, page)).join(', ')}.`, '');
        }
        const parameters = entry.typeParameters;
        if (parameters.length > 0 && !entry.wide && entry.members.length > 0) {
          lines.push(
            `Type parameters: ${parameters.map((parameter) => inlineCode(parameter)).join(', ')}.`,
            '',
          );
        }
        const examples = entry.tags.filter((tag) => tag.name === 'example');
        for (const example of examples) lines.push(example.text, '');
        if (entry.members.length > 0) {
          const withDefaults = entry.members.some((member) => member.default !== undefined);
          const typed = !entry.wide && entry.kind !== 'object' && entry.kind !== 'class';
          const header = [
            entry.kind === 'interface' || entry.kind === 'type' ? 'Property' : 'Member',
          ];
          if (typed) header.push('Type');
          if (withDefaults) header.push('Default');
          header.push('Description');
          lines.push(`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`);
          for (const member of entry.members) {
            const row = [inlineCode(member.name)];
            if (typed) row.push(inlineCode(member.type));
            if (withDefaults) {
              const fallback = member.default;
              row.push(
                fallback === undefined
                  ? ''
                  : /^(['"`].*['"`]|-?\d[\d_.]*|true|false|null|undefined|\[.*\]|\{.*\}|[A-Za-z_$][\w$.]*(\(.*\))?)$/.test(
                        fallback,
                      )
                    ? inlineCode(fallback)
                    : fallback,
              );
            }
            row.push(member.summary);
            lines.push(`| ${row.map(cell).join(' | ')} |`);
          }
          lines.push('');
        }
      }
    }
    if (reexported.length > 0) {
      unique('Re-exported');
      lines.push('## Re-exported', '');
      const homes = [...new Set(reexported.map((entry) => entry.page))];
      for (const home of homes) {
        const name = model.packages.get(home)?.name ?? home;
        const listed = reexported.filter((entry) => entry.page === home);
        lines.push(
          `From [${inlineCode(name)}](${home}.md): ${listed.map((entry) => reference(entry, page)).join(', ')}.`,
          '',
        );
      }
    }
    const path = `docs/api/${page}.md`;
    const file = join(root, path);
    out.set(
      path,
      await format(lines.join('\n'), { ...((await resolveConfig(file)) ?? {}), filepath: file }),
    );
  }

  const index = [
    '# API reference',
    '',
    '<!-- Generated by `pnpm run docs`. -->',
    '',
    "Every package's public API, generated from its type declarations and JSDoc. The guides explain how the pieces fit; these pages say exactly what each one takes and returns.",
    '',
    '| Package | What it holds |',
    '| --- | --- |',
    ...[...model.packages].map(
      ([page, info]) => `| [${inlineCode(info.name)}](${page}.md) | ${cell(info.description)} |`,
    ),
    '',
  ];
  const indexPath = join(root, 'docs/api/README.md');
  out.set(
    'docs/api/README.md',
    await format(index.join('\n'), {
      ...((await resolveConfig(indexPath)) ?? {}),
      filepath: indexPath,
    }),
  );
  return out;
}
