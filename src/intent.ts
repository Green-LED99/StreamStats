import { findLeagueKey, getLeagueEntry, matchActionKey, matchSeasonType, matchStatKey } from "./registry.js";
import type { ConversationSportsContext, SportsQueryIntent, TeamMatch } from "./types.js";
import { EspnClient } from "./espn-client.js";
import { parseYear, unique, normalizeText } from "./utils.js";

function pickLeagueFromTeams(teamMatches: TeamMatch[], context?: ConversationSportsContext): string | undefined {
  const leagueKeys = unique(teamMatches.map((team) => team.league));

  if (leagueKeys.length === 1) {
    return leagueKeys[0];
  }

  if (context?.lastLeague && leagueKeys.includes(context.lastLeague)) {
    return context.lastLeague;
  }

  return undefined;
}

function inferActionKey(
  normalizedText: string,
  sport: SportsQueryIntent["sport"],
  matchedActionKey?: string
): string | undefined {
  if (matchedActionKey) {
    return matchedActionKey;
  }

  if (/\b(?:most recent|latest|last)\s+(?:event|play)\b|\bwhat just happened\b/.test(normalizedText)) {
    return "event";
  }

  if (sport === "basketball") {
    if (/\b(?:last|latest|most recent)\s+(?:basket|bucket|field goal)\b/.test(normalizedText)) {
      return "basket";
    }

    if (/\b(?:latest|last|most recent)\s+scorer\b|\bwho(?:\s+just)?\s+scored\b/.test(normalizedText)) {
      return "score";
    }
  }

  return undefined;
}

export async function parseSportsIntent(input: {
  text: string;
  client: EspnClient;
  context?: ConversationSportsContext;
}): Promise<SportsQueryIntent> {
  const normalizedText = normalizeText(input.text);
  const explicitLeague = findLeagueKey(input.text);
  const teamMatches = await input.client.findTeamsByText(
    input.text,
    explicitLeague ? [explicitLeague] : undefined
  );
  const league = explicitLeague ?? input.context?.lastLeague ?? pickLeagueFromTeams(teamMatches, input.context);
  const sport = league
    ? teamMatches.find((team) => team.league === league)?.sport ?? getLeagueEntry(league)?.sport ?? input.context?.lastSport
    : input.context?.lastSport;
  const statKey = matchStatKey(input.text, sport);
  const actionKey = inferActionKey(normalizedText, sport, matchActionKey(input.text, sport));
  const seasonType = matchSeasonType(input.text, sport);
  const seasonYear = parseYear(input.text);
  const leaderHint = /\b(leader|leaders|lead|leads|most|highest|top)\b/.test(normalizedText);
  const gameHint = /\b(game|match|fixture)\b/.test(normalizedText) || teamMatches.length > 0;
  const isFollowUp = /\b(that|this|latest|most recent|last|just|who hit|who scored|who made|scorer|what happened)\b/.test(
    normalizedText
  );

  if (actionKey) {
    return {
      rawText: input.text,
      normalizedText,
      intent: "event_follow_up",
      sport,
      league,
      seasonYear,
      seasonType,
      statKey,
      actionKey,
      teamMatches,
      eventId: input.context?.lastEventId,
      isFollowUp
    };
  }

  if (statKey && (leaderHint || /\bseason\b/.test(normalizedText) || league)) {
    return {
      rawText: input.text,
      normalizedText,
      intent: "season_leader",
      sport,
      league,
      seasonYear,
      seasonType,
      statKey,
      teamMatches,
      eventId: input.context?.lastEventId,
      isFollowUp
    };
  }

  return {
    rawText: input.text,
    normalizedText,
    intent: gameHint && !isFollowUp ? "game_lookup" : "event_follow_up",
    sport,
    league,
    seasonYear,
    seasonType,
    statKey,
    actionKey,
    teamMatches,
    eventId: input.context?.lastEventId,
    isFollowUp
  };
}
