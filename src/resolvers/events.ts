import { getLeagueEntry } from "../registry.js";
import type { Citation, SummaryPayload, TeamMatch } from "../types.js";
import { EspnClient } from "../espn-client.js";
import { asArray, asRecord, formatAbsoluteDate, pickBestString, safeString } from "../utils.js";
import { buildGameContextAnswer, resolveGameContext } from "./game-context.js";

function collectPlays(summary: SummaryPayload): Array<Record<string, unknown>> {
  const directPlays = asArray<Record<string, unknown>>(summary.plays);

  if (directPlays.length > 0) {
    return directPlays;
  }

  const commentary = asArray<Record<string, unknown>>(summary.commentary);

  if (commentary.length > 0) {
    return commentary;
  }

  const drives = asRecord(summary.drives);
  const driveBuckets = [
    ...asArray<Record<string, unknown>>(drives?.previous),
    ...asArray<Record<string, unknown>>(drives?.current ? [drives.current] : [])
  ];

  return driveBuckets.flatMap((drive) => asArray<Record<string, unknown>>(drive.plays));
}

function extractAthleteMap(summary: SummaryPayload): Map<string, string> {
  const names = new Map<string, string>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;

    if (record.athlete && typeof record.athlete === "object") {
      const athlete = record.athlete as Record<string, unknown>;
      const id = safeString(athlete.id);
      const name = pickBestString(athlete.displayName, athlete.fullName, athlete.shortName);

      if (id && name) {
        names.set(id, name);
      }
    }

    for (const nested of Object.values(record)) {
      visit(nested);
    }
  };

  visit(summary.boxscore);
  visit(summary.leaders);
  visit(summary);

  return names;
}

function actionMatcher(actionKey: string, play: Record<string, unknown>): boolean {
  const text = pickBestString(play.text, play.shortText, play.description)?.toLowerCase() ?? "";
  const typeText = safeString(asRecord(play.type)?.text)?.toLowerCase() ?? "";

  switch (actionKey) {
    case "homeRun":
      return /homered|home run/.test(text) || /home run/.test(typeText);
    case "goal":
      return /\bgoal\b|scored/.test(text) || /goal/.test(typeText);
    case "touchdown":
      return /touchdown/.test(text);
    case "threePointer":
      return /3-pt|3 point|three point/.test(text);
    case "score":
      return play.scoringPlay === true || /\bmade\b|\bmakes\b|\bscored\b/.test(text);
    default:
      return text.includes(actionKey.toLowerCase());
  }
}

function extractActorId(play: Record<string, unknown>, actionKey: string): string | undefined {
  const participants = asArray<Record<string, unknown>>(play.participants);
  const preferredRoles =
    actionKey === "homeRun"
      ? ["batter"]
      : actionKey === "goal"
        ? ["scorer", "athlete", "player"]
        : ["athlete", "player", "rusher", "receiver", "passer"];

  for (const role of preferredRoles) {
    const participant = participants.find((entry) => safeString(entry.type) === role);
    const athlete = asRecord(participant?.athlete);
    const id = safeString(athlete?.id);

    if (id) {
      return id;
    }
  }

  const fallback = asRecord(participants[0]?.athlete);
  return safeString(fallback?.id);
}

function extractActorName(play: Record<string, unknown>, athleteMap: Map<string, string>, actionKey: string): string | undefined {
  const athleteId = extractActorId(play, actionKey);

  if (athleteId && athleteMap.has(athleteId)) {
    return athleteMap.get(athleteId);
  }

  const text = pickBestString(play.text, play.shortText, play.description);

  if (!text) {
    return undefined;
  }

  const match = text.match(/^([A-Z][A-Za-z.'-]+(?:\s[A-Z][A-Za-z.'-]+){0,2})\s/);
  return match?.[1];
}

function playTimestamp(play: Record<string, unknown>): number {
  const wallclock = safeString(play.wallclock);
  return wallclock ? new Date(wallclock).getTime() : 0;
}

function periodLabel(play: Record<string, unknown>): string | undefined {
  return pickBestString(asRecord(play.period)?.displayValue, safeString(play.period));
}

function eventName(summary: SummaryPayload): string {
  const header = asRecord(summary.header);
  const competitions = asArray<Record<string, unknown>>(header?.competitions);
  return (
    pickBestString(competitions[0]?.name, competitions[0]?.shortName, header?.shortName, header?.name) ??
    "that game"
  );
}

export async function resolveEventAction(input: {
  client: EspnClient;
  league?: string;
  actionKey: string;
  eventId?: string;
  teamMatches?: TeamMatch[];
  now: Date;
}): Promise<{
  answer: string;
  citations: Citation[];
  eventId: string;
  league: string;
  sport: string;
  teamIds: string[];
}> {
  let league = input.league;
  let eventId = input.eventId;
  let sport: string | undefined = league ? getLeagueEntry(league)?.sport : undefined;
  let teamIds: string[] = [];
  const citations: Citation[] = [];

  if (!eventId) {
    if (!input.teamMatches || input.teamMatches.length === 0) {
      throw new Error("I need a game context first. Ask for a team game before using a follow-up like that.");
    }

    const gameContext = await resolveGameContext({
      client: input.client,
      teamMatches: input.teamMatches,
      preferredLeague: league,
      now: input.now
    });

    league = gameContext.league;
    sport = gameContext.sport;
    eventId = gameContext.event.id;
    teamIds = gameContext.teamIds;
    citations.push(...gameContext.citations);
  }

  if (!league || !sport || !eventId) {
    throw new Error("I couldn't resolve the game event for that follow-up.");
  }

  const summary = await input.client.getSummary(league, eventId);
  const plays = collectPlays(summary);
  const matchingPlay = [...plays]
    .filter((play) => actionMatcher(input.actionKey, play))
    .sort((left, right) => playTimestamp(right) - playTimestamp(left))[0];

  if (!matchingPlay) {
    throw new Error(`I couldn't find a matching ${input.actionKey} in ${eventName(summary)}.`);
  }

  const athleteMap = extractAthleteMap(summary);
  const actor = extractActorName(matchingPlay, athleteMap, input.actionKey) ?? "Unknown player";
  const playText = pickBestString(matchingPlay.text, matchingPlay.shortText, matchingPlay.description);
  const answer = `${actor} had the most recent ${input.actionKey === "homeRun" ? "home run" : input.actionKey} in ${eventName(summary)}.${playText ? ` ${playText}` : ""}${periodLabel(matchingPlay) ? ` (${periodLabel(matchingPlay)}).` : ""}`;

  citations.push({
    label: `${eventName(summary)} summary`,
    url: `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${eventId}`
  });

  return {
    answer,
    citations,
    eventId,
    league,
    sport,
    teamIds
  };
}

export function buildMissingEventContextAnswer(): string {
  return "I need a game context first. Ask for a team game, then I can resolve follow-ups like that.";
}

export function buildImplicitGameContextAnswer(anchoredAnswer: string, eventDate?: string): string {
  return eventDate ? `${anchoredAnswer} Game context anchored at ${formatAbsoluteDate(eventDate)}.` : anchoredAnswer;
}
