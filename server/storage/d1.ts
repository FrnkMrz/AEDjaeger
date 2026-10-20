/** Kleiner gemeinsamer D1-Typausschnitt für separat prüfbare Speicherregeln. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(columnName?: string): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
}

export interface D1Result<T> {
  success: boolean;
  meta?: { changes?: number };
  results?: T[];
}
