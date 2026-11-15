// Just enough of Node for the tests that read the shipped site files (and
// regenerate par.json), without pulling in @types/node.
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
  export function writeFileSync(path: URL | string, data: string): void;
}
declare const process: { env: Record<string, string | undefined> };
