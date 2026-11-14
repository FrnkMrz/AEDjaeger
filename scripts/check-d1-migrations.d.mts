export function readAppliedMigrationNames(response: unknown): string[];
export function migrationFilesFromDirectory(entries: Array<{ name: string; isFile(): boolean }>): string[];
export function compareMigrationNames(localNames: string[], appliedNames: string[]): {
  pending: string[];
  unknown: string[];
};
