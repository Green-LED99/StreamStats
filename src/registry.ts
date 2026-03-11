import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LeagueRegistryEntry, SportRule, SportsRegistry } from "./types.js";
import { includesAlias, normalizeText } from "./utils.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(moduleDir, "../data/sports-registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as SportsRegistry;

function sortAliases(entries: Array<{ key: string; alias: string }>): Array<{ key: string; alias: string }> {
  return [...entries].sort((left, right) => right.alias.length - left.alias.length);
}

const leagueAliases = sortAliases(
  Object.entries(registry.leagues).flatMap(([leagueKey, entry]) =>
    entry.aliases.map((alias) => ({ key: leagueKey, alias: normalizeText(alias) }))
  )
);

export function getRegistry(): SportsRegistry {
  return registry;
}

export function getLeagueEntry(leagueKey: string): LeagueRegistryEntry | undefined {
  return registry.leagues[leagueKey];
}

export function getSportRule(sport: keyof SportsRegistry["sports"]): SportRule {
  return registry.sports[sport];
}

export function findLeagueKey(text: string): string | undefined {
  const normalized = normalizeText(text);

  for (const candidate of leagueAliases) {
    if (includesAlias(normalized, candidate.alias)) {
      return candidate.key;
    }
  }

  return undefined;
}

export function findAliasKey(
  text: string,
  aliasMap: Record<string, string | string[]>
): string | undefined {
  const normalized = normalizeText(text);
  const candidates = sortAliases(
    Object.entries(aliasMap).flatMap(([key, aliases]) =>
      (Array.isArray(aliases) ? aliases : [aliases]).map((alias) => ({
        key,
        alias: normalizeText(alias)
      }))
    )
  );

  for (const candidate of candidates) {
    if (includesAlias(normalized, candidate.alias)) {
      return candidate.key;
    }
  }

  return undefined;
}

export function matchStatKey(text: string, sport?: keyof SportsRegistry["sports"]): string | undefined {
  if (!sport) {
    return undefined;
  }

  return findAliasKey(text, getSportRule(sport).statAliases);
}

export function matchActionKey(text: string, sport?: keyof SportsRegistry["sports"]): string | undefined {
  if (!sport) {
    return undefined;
  }

  return findAliasKey(text, getSportRule(sport).actionAliases);
}

export function matchSeasonType(text: string, sport?: keyof SportsRegistry["sports"]): number | undefined {
  if (!sport) {
    return undefined;
  }

  const normalized = normalizeText(text);
  const seasonAliases = getSportRule(sport).seasonTypeAliases;

  for (const [alias, typeId] of Object.entries(seasonAliases).sort((left, right) => right[0].length - left[0].length)) {
    if (includesAlias(normalized, alias)) {
      return typeId;
    }
  }

  return undefined;
}

export function supportedStats(sport?: keyof SportsRegistry["sports"]): string[] {
  return sport ? Object.keys(getSportRule(sport).statAliases).sort() : [];
}

export function supportedLeagues(): string[] {
  return Object.keys(registry.leagues);
}

