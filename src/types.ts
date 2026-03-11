export type SportSlug = "baseball" | "basketball" | "football" | "hockey" | "soccer";
export type LeaderSource = "core-leaders" | "page-bootstrap";

export interface SportRule {
  leaderSource: LeaderSource;
  seasonTypeAliases: Record<string, number>;
  statAliases: Record<string, string>;
  actionAliases: Record<string, string[]>;
}

export interface LeagueRegistryEntry {
  sport: SportSlug;
  displayName: string;
  aliases: string[];
}

export interface SportsRegistry {
  version: number;
  contextTtlMinutes: number;
  sports: Record<SportSlug, SportRule>;
  leagues: Record<string, LeagueRegistryEntry>;
}

export interface Citation {
  label: string;
  url: string;
}

export interface TeamMatch {
  id: string;
  league: string;
  sport: SportSlug;
  displayName: string;
  shortDisplayName: string;
  abbreviation: string;
  aliases: string[];
}

export interface ConversationSportsContext {
  channelId: string;
  userId: string;
  lastResolvedAt: string;
  lastSport?: SportSlug;
  lastLeague?: string;
  lastTeamIds?: string[];
  lastEventId?: string;
  lastActionKey?: string;
}

export interface QueryRequest {
  channelId: string;
  userId: string;
  text: string;
  now?: Date;
}

export interface SportsQueryIntent {
  rawText: string;
  normalizedText: string;
  intent: "season_leader" | "game_lookup" | "event_follow_up";
  sport?: SportSlug;
  league?: string;
  seasonYear?: number;
  seasonType?: number;
  statKey?: string;
  actionKey?: string;
  teamMatches: TeamMatch[];
  eventId?: string;
  isFollowUp: boolean;
}

export interface AnswerResult {
  answer: string;
  citations: Citation[];
  updatedContext: ConversationSportsContext | null;
}

export interface SeasonTypeInfo {
  id: number;
  name: string;
  abbreviation?: string;
}

export interface SeasonInfo {
  year: number;
  displayName: string;
  currentTypeId?: number;
  currentTypeName?: string;
  currentTypeAbbreviation?: string;
  types: SeasonTypeInfo[];
}

export interface CoreLeaderCategory {
  name: string;
  displayName: string;
  shortDisplayName?: string;
  abbreviation?: string;
  leaders: Array<{
    displayValue: string;
    value?: number;
    athlete?: { $ref?: string };
    team?: { $ref?: string };
  }>;
}

export interface CoreLeadersResponse {
  categories: CoreLeaderCategory[];
}

export interface RefEntity {
  id?: string;
  displayName?: string;
  fullName?: string;
  name?: string;
  shortDisplayName?: string;
}

export interface ScheduleEvent {
  id: string;
  date: string;
  name: string;
  shortName?: string;
  statusDescription?: string;
  state?: string;
  completed?: boolean;
  links?: Array<{ href?: string; text?: string }>;
}

export interface SummaryPayload {
  header?: Record<string, unknown>;
  boxscore?: Record<string, unknown>;
  plays?: Array<Record<string, unknown>>;
  commentary?: Array<Record<string, unknown>>;
  scoringPlays?: Array<Record<string, unknown>>;
  drives?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PageBootstrapHeader {
  type: string;
  title: string;
  desc?: string;
  isStats?: boolean;
}

export interface PageBootstrapTable {
  title: string;
  headers: PageBootstrapHeader[];
  rows: unknown[][];
}

