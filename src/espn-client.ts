import type {
  CoreLeadersResponse,
  LeagueRegistryEntry,
  PageBootstrapTable,
  RefEntity,
  ScheduleEvent,
  SeasonInfo,
  SummaryPayload,
  TeamMatch
} from "./types.js";
import { getLeagueEntry, supportedLeagues } from "./registry.js";
import {
  asArray,
  asRecord,
  extractJsonAssignment,
  firstDefined,
  pickBestString,
  safeString,
  unique,
  withHttps
} from "./utils.js";

const ESPN_WEB_BASE = "https://www.espn.com";
const ESPN_SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_CORE_BASE = "https://sports.core.api.espn.com/v2/sports";

export class EspnClient {
  private readonly teamCache = new Map<string, Promise<TeamMatch[]>>();
  private readonly seasonCache = new Map<string, Promise<SeasonInfo>>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async findTeamsByText(text: string, candidateLeagues: string[] = supportedLeagues()): Promise<TeamMatch[]> {
    const matches: TeamMatch[] = [];
    const normalizedText = text.toLowerCase();

    for (const leagueKey of candidateLeagues) {
      const teams = await this.getTeams(leagueKey);

      for (const team of teams) {
        if (team.aliases.some((alias) => normalizedText.includes(alias.toLowerCase()))) {
          matches.push(team);
        }
      }
    }

    return matches;
  }

  async getTeams(leagueKey: string): Promise<TeamMatch[]> {
    if (!this.teamCache.has(leagueKey)) {
      this.teamCache.set(leagueKey, this.loadTeams(leagueKey));
    }

    return this.teamCache.get(leagueKey)!;
  }

  async getSeason(leagueKey: string): Promise<SeasonInfo> {
    if (!this.seasonCache.has(leagueKey)) {
      this.seasonCache.set(leagueKey, this.loadSeason(leagueKey));
    }

    return this.seasonCache.get(leagueKey)!;
  }

  async getCoreLeaders(
    leagueKey: string,
    seasonYear: number,
    seasonType: number
  ): Promise<CoreLeadersResponse> {
    const league = this.requireLeague(leagueKey);
    return this.getJson<CoreLeadersResponse>(
      `${ESPN_CORE_BASE}/${league.sport}/leagues/${leagueKey}/seasons/${seasonYear}/types/${seasonType}/leaders`
    );
  }

  async getRefEntity(ref?: string): Promise<RefEntity> {
    if (!ref) {
      return {};
    }

    return this.getJson<RefEntity>(withHttps(ref));
  }

  async getSchedule(leagueKey: string, teamId: string): Promise<ScheduleEvent[]> {
    const league = this.requireLeague(leagueKey);
    const payload = await this.getJson<Record<string, unknown>>(
      `${ESPN_SITE_BASE}/${league.sport}/${leagueKey}/teams/${teamId}/schedule`
    );

    return asArray<Record<string, unknown>>(payload.events).map((event) => this.parseScheduleEvent(event));
  }

  async getSummary(leagueKey: string, eventId: string): Promise<SummaryPayload> {
    const league = this.requireLeague(leagueKey);
    return this.getJson<SummaryPayload>(`${ESPN_SITE_BASE}/${league.sport}/${leagueKey}/summary?event=${eventId}`);
  }

  async getPageBootstrapTables(leagueKey: string, seasonYear?: number, view?: string): Promise<PageBootstrapTable[]> {
    const league = this.requireLeague(leagueKey);
    const seasonPath = seasonYear ? `/season/${seasonYear}` : "";
    const viewPath = view ? `/view/${view}` : "";
    const html = await this.getText(`${ESPN_WEB_BASE}/${league.sport}/stats/_/league/${leagueKey.toUpperCase()}${seasonPath}${viewPath}`);
    const bootstrap = extractJsonAssignment(html, "window['__espnfitt__']") as Record<string, unknown>;
    const page = asRecord(bootstrap.page);
    const content = asRecord(page?.content);
    const statistics = asRecord(content?.statistics);
    const tables = asArray<Record<string, unknown>>(statistics?.tables);
    const tableRows = asArray<unknown[]>(statistics?.tableRows);

    return tables.map((table, index) => ({
      title: safeString(table.title) ?? `Table ${index + 1}`,
      headers: asArray<Record<string, unknown>>(table.headers).map((header) => ({
        type: safeString(header.type) ?? "",
        title: safeString(header.title) ?? "",
        desc: safeString(header.desc),
        isStats: header.isStats === true
      })),
      rows: asArray<unknown[]>(tableRows[index])
    }));
  }

  private async loadTeams(leagueKey: string): Promise<TeamMatch[]> {
    const league = this.requireLeague(leagueKey);
    const payload = await this.getJson<Record<string, unknown>>(
      `${ESPN_SITE_BASE}/${league.sport}/${leagueKey}/teams`
    );

    const sports = asArray<Record<string, unknown>>(payload.sports);
    const firstSport = sports[0];
    const leagues = asArray<Record<string, unknown>>(firstSport?.leagues);
    const firstLeague = leagues[0];
    const teams = asArray<Record<string, unknown>>(firstLeague?.teams);

    return teams
      .map((item) => {
        const team = asRecord(item.team) ?? item;
        const displayName = safeString(team.displayName) ?? "Unknown Team";
        const shortDisplayName = safeString(team.shortDisplayName) ?? displayName;
        const abbreviation = safeString(team.abbreviation) ?? displayName;
        const slug = safeString(team.slug);
        const aliases = unique(
          [
            displayName,
            shortDisplayName,
            safeString(team.location),
            safeString(team.name),
            safeString(team.nickname),
            abbreviation,
            ...(slug ? slug.split("-").map((part) => part.trim()) : [])
          ]
            .filter((value): value is string => Boolean(value && value.trim()))
            .map((value) => value.toLowerCase())
        );

        return {
          id: String(team.id ?? ""),
          league: leagueKey,
          sport: league.sport,
          displayName,
          shortDisplayName,
          abbreviation,
          aliases
        } satisfies TeamMatch;
      })
      .filter((team) => team.id);
  }

  private async loadSeason(leagueKey: string): Promise<SeasonInfo> {
    const league = this.requireLeague(leagueKey);
    const payload = await this.getJson<Record<string, unknown>>(
      `${ESPN_CORE_BASE}/${league.sport}/leagues/${leagueKey}/season`
    );
    const currentType = asRecord(payload.type);
    const types = asArray<Record<string, unknown>>(asRecord(payload.types)?.items).map((type) => ({
      id: Number(type.id ?? type.type ?? 0),
      name: safeString(type.name) ?? "Unknown",
      abbreviation: safeString(type.abbreviation)
    }));

    return {
      year: Number(payload.year ?? 0),
      displayName: safeString(payload.displayName) ?? String(payload.year ?? ""),
      currentTypeId: currentType ? Number(currentType.id ?? currentType.type ?? 0) : undefined,
      currentTypeName: currentType ? safeString(currentType.name) : undefined,
      currentTypeAbbreviation: currentType ? safeString(currentType.abbreviation) : undefined,
      types
    };
  }

  private parseScheduleEvent(event: Record<string, unknown>): ScheduleEvent {
    const competition = asArray<Record<string, unknown>>(event.competitions)[0];
    const status = asRecord(competition?.status) ?? asRecord(event.status);
    const type = asRecord(status?.type);
    const links = asArray<Record<string, unknown>>(event.links).map((link) => ({
      href: safeString(link.href),
      text: safeString(link.text)
    }));

    return {
      id: String(event.id ?? competition?.id ?? ""),
      date: safeString(event.date) ?? "",
      name: firstDefined(safeString(event.name), safeString(competition?.name)) ?? "Unknown Event",
      shortName: firstDefined(safeString(event.shortName), safeString(competition?.shortName)),
      statusDescription: safeString(type?.description),
      state: safeString(type?.state),
      completed: typeof type?.completed === "boolean" ? type.completed : undefined,
      links
    };
  }

  private requireLeague(leagueKey: string): LeagueRegistryEntry {
    const league = getLeagueEntry(leagueKey);

    if (!league) {
      throw new Error(`Unsupported league: ${leagueKey}`);
    }

    return league;
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url, {
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`ESPN request failed (${response.status}) for ${url}`);
    }

    return (await response.json()) as T;
  }

  private async getText(url: string): Promise<string> {
    const response = await this.fetchImpl(url);

    if (!response.ok) {
      throw new Error(`ESPN page request failed (${response.status}) for ${url}`);
    }

    return response.text();
  }
}

