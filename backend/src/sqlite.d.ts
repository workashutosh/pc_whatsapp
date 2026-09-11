declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    function(name: string, fn: (...args: unknown[]) => unknown): void;
    close(): void;
  }

  export class StatementSync {
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }
}
