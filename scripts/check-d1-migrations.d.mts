export function readAppliedMigrationNames(response: unknown): string[];
export function compareMigrationNames(localNames: string[], appliedNames: string[]): {
  pending: string[];
  unknown: string[];
};
