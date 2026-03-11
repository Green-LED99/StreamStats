import { getLeagueEntry, getSportRule, supportedStats } from "../registry.js";
import type { Citation, CoreLeaderCategory, SeasonInfo } from "../types.js";
import { EspnClient } from "../espn-client.js";

function pickSeasonType(season: SeasonInfo, requested?: number): number {
  if (requested) {
    return requested;
  }

  if (season.currentTypeId && season.currentTypeAbbreviation !== "off") {
    return season.currentTypeId;
  }

  const regularSeason = season.types.find((type) => type.abbreviation === "reg" || type.id === 2);
  if (regularSeason) {
    return regularSeason.id;
  }

  const firstCompetitive = season.types.find((type) => type.id !== 4);
  if (firstCompetitive) {
    return firstCompetitive.id;
  }

  throw new Error("I couldn't determine the league season type to use.");
}

function findCategory(categories: CoreLeaderCategory[], statKey: string): CoreLeaderCategory | undefined {
  return categories.find((category) => category.name === statKey);
}

export async function resolveSeasonLeader(input: {
  client: EspnClient;
  league: string;
  statKey: string;
  seasonYear?: number;
  seasonType?: number;
}): Promise<{
  answer: string;
  citations: Citation[];
}> {
  const leagueEntry = getLeagueEntry(input.league);

  if (!leagueEntry) {
    throw new Error("I couldn't resolve the league for that leader query.");
  }

  const sportRule = getSportRule(leagueEntry.sport);
  const season = await input.client.getSeason(input.league);
  const seasonYear = input.seasonYear ?? season.year;
  const seasonType = pickSeasonType(season, input.seasonType);

  if (sportRule.leaderSource === "page-bootstrap") {
    const tables = await Promise.all([
      input.client.getPageBootstrapTables(input.league, seasonYear, "scoring"),
      input.client.getPageBootstrapTables(input.league, seasonYear, "discipline"),
      input.client.getPageBootstrapTables(input.league, seasonYear, "performance")
    ]);

    for (const tableGroup of tables) {
      for (const table of tableGroup) {
        const statIndex = table.headers.findIndex((header) => header.type === input.statKey);
        const athleteIndex = table.headers.findIndex((header) => header.type === "athlete");
        const teamIndex = table.headers.findIndex((header) => header.type === "team");

        if (statIndex === -1 || table.rows.length === 0) {
          continue;
        }

        const topRow = table.rows[0] as Array<unknown>;
        const athleteCell = athleteIndex >= 0 ? (topRow[athleteIndex] as Record<string, unknown> | undefined) : undefined;
        const teamCell = teamIndex >= 0 ? (topRow[teamIndex] as Record<string, unknown> | undefined) : undefined;
        const statCell = topRow[statIndex] as Record<string, unknown> | undefined;
        const playerName = typeof athleteCell?.name === "string" ? athleteCell.name : typeof teamCell?.name === "string" ? teamCell.name : "Unknown";
        const teamName = typeof teamCell?.name === "string" ? teamCell.name : undefined;
        const displayValue = typeof statCell?.value === "string" ? statCell.value : "Unknown";
        const viewPath = table.title.toLowerCase().includes("assist") ? "scoring" : table.title.toLowerCase().includes("discipline") ? "discipline" : "performance";

        return {
          answer: `${playerName}${teamName ? ` (${teamName})` : ""} leads the ${leagueEntry.displayName} ${season.displayName} in ${table.title.toLowerCase()} at ${displayValue}.`,
          citations: [
            {
              label: `${leagueEntry.displayName} stats`,
              url: `https://www.espn.com/${leagueEntry.sport}/stats/_/league/${input.league.toUpperCase()}/season/${seasonYear}/view/${viewPath}`
            }
          ]
        };
      }
    }

    throw new Error(
      `I couldn't match that stat for ${leagueEntry.displayName}. Supported stats include ${supportedStats(leagueEntry.sport)
        .slice(0, 8)
        .join(", ")}.`
    );
  }

  const leaders = await input.client.getCoreLeaders(input.league, seasonYear, seasonType);
  const category = findCategory(leaders.categories, input.statKey);

  if (!category || category.leaders.length === 0) {
    throw new Error(
      `I couldn't match that stat for ${leagueEntry.displayName}. Supported stats include ${supportedStats(leagueEntry.sport)
        .slice(0, 8)
        .join(", ")}.`
    );
  }

  const topLeader = category.leaders[0];

  if (!topLeader) {
    throw new Error(`I couldn't find a top result for ${category.displayName}.`);
  }
  const [athlete, team] = await Promise.all([
    input.client.getRefEntity(topLeader.athlete?.$ref),
    input.client.getRefEntity(topLeader.team?.$ref)
  ]);
  const playerName = athlete.displayName ?? athlete.fullName ?? "Unknown Player";
  const teamName = team.displayName ?? team.name;

  return {
    answer: `${playerName}${teamName ? ` (${teamName})` : ""} is the ${leagueEntry.displayName} ${season.displayName} ${category.displayName.toLowerCase()} leader at ${topLeader.displayValue}.`,
    citations: [
      {
        label: `${leagueEntry.displayName} leaders`,
        url: `https://sports.core.api.espn.com/v2/sports/${leagueEntry.sport}/leagues/${input.league}/seasons/${seasonYear}/types/${seasonType}/leaders`
      }
    ]
  };
}
