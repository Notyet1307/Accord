export type PersistenceRow = Record<string, unknown>;

export function parsePersistenceRow(value: unknown, label: string): PersistenceRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} is not a persistence row`);
  }
  return value as PersistenceRow;
}

export function requireString(row: PersistenceRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new TypeError(`${column} must be a persisted string`);
  }
  return value;
}

export function requireInteger(row: PersistenceRow, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${column} must be a persisted safe integer`);
  }
  return value;
}

export function requireLiteral<const Literal extends string>(
  row: PersistenceRow,
  column: string,
  expected: Literal,
): Literal {
  const value = row[column];
  if (value !== expected) {
    throw new TypeError(`${column} must be persisted as ${expected}`);
  }
  return expected;
}

export function requireOneOf<const Values extends readonly string[]>(
  row: PersistenceRow,
  column: string,
  allowed: Values,
): Values[number] {
  const value = requireString(row, column);
  if (!allowed.includes(value)) {
    throw new TypeError(`${column} must be one of: ${allowed.join(", ")}`);
  }
  return value as Values[number];
}

export function requireHexDigest(row: PersistenceRow, column: string): string {
  const value = requireString(row, column);
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${column} must be a lowercase SHA-256 digest`);
  }
  return value;
}

export function requireIsoInstant(row: PersistenceRow, column: string): string {
  const value = requireString(row, column);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`${column} must be a canonical persisted ISO-8601 instant`);
  }
  return value;
}
