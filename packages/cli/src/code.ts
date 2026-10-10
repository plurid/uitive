import ts from 'typescript';

/**
 * A string as a single-quoted TypeScript literal. Text from API descriptions and JSDoc can hold
 * anything, so every character a literal can't carry as it is gets escaped, as JSON does.
 */
export const quote = (value: string) =>
  `'${JSON.stringify(value)
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/'/g, "\\'")
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}'`;

/** An object key as written in code: bare when it can be, else quoted. */
export const property = (name: string) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : quote(name);

/** Text for a comment: on one line, so nothing after it can become code. */
export const oneLine = (value: string) => value.replace(/[\r\n\u2028\u2029]+/g, ' ');

/** What keeps generated code from parsing, if anything. */
export function syntaxErrors(code: string, fileName: string): string[] {
  const { diagnostics = [] } = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  });
  return diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
  );
}
