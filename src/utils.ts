export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function includesAlias(normalizedText: string, alias: string): boolean {
  const normalizedAlias = normalizeText(alias);

  if (!normalizedAlias) {
    return false;
  }

  return new RegExp(`(^|\\s)${escapeRegExp(normalizedAlias)}($|\\s)`).test(normalizedText);
}

export function parseYear(value: string): number | undefined {
  const match = value.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

export function formatAbsoluteDate(dateString: string, timeZone = "America/Chicago"): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone
  }).format(new Date(dateString));
}

export function safeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

export function withHttps(url: string): string {
  return url
    .replace(/^http:\/\//, "https://")
    .replace("sports.core.api.espn.pvt", "sports.core.api.espn.com");
}

export function extractJsonAssignment(html: string, assignment: string): unknown {
  const pattern = new RegExp(`${escapeRegExp(assignment)}=(.*?);<\\/script>`, "s");
  const match = html.match(pattern);

  if (!match) {
    throw new Error(`Unable to find bootstrap assignment for ${assignment}`);
  }

  return JSON.parse(match[1] ?? "null");
}

export function pickBestString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

