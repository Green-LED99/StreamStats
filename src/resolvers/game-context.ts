import { getLeagueEntry } from "../registry.js";
import type { Citation, ScheduleEvent, TeamMatch } from "../types.js";
import { EspnClient } from "../espn-client.js";
import { formatAbsoluteDate } from "../utils.js";

function eventPriority(event: ScheduleEvent, now: Date): number {
  const eventTime = new Date(event.date).getTime();
  const delta = eventTime - now.getTime();
  const absDelta = Math.abs(delta);

  if (event.state === "in") {
    return 1_000_000 - absDelta;
  }

  if (delta >= 0 && delta <= 12 * 60 * 60 * 1000) {
    return 900_000 - delta;
  }

  if (delta < 0 && absDelta <= 18 * 60 * 60 * 1000) {
    return 850_000 - absDelta;
  }

  return 700_000 - absDelta;
}

function pickEventLink(event: ScheduleEvent, leagueKey: string, sport: string): string {
  const summaryLink = event.links?.find((link) => link.text?.toLowerCase() === "summary")?.href;

  if (summaryLink) {
    return summaryLink;
  }

  return `https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueKey}/summary?event=${event.id}`;
}

export async function resolveGameContext(input: {
  client: EspnClient;
  teamMatches: TeamMatch[];
  preferredLeague?: string;
  now: Date;
}): Promise<{
  event: ScheduleEvent;
  league: string;
  sport: string;
  teamIds: string[];
  citations: Citation[];
}> {
  if (input.teamMatches.length === 0) {
    throw new Error("I need a team reference before I can anchor a game.");
  }

  const prioritizedTeams = input.preferredLeague
    ? input.teamMatches.sort((left, right) =>
        left.league === input.preferredLeague ? -1 : right.league === input.preferredLeague ? 1 : 0
      )
    : input.teamMatches;

  let best:
    | {
        team: TeamMatch;
        event: ScheduleEvent;
      }
    | undefined;

  for (const team of prioritizedTeams) {
    const events = await input.client.getSchedule(team.league, team.id);
    const candidate = [...events].sort((left, right) => eventPriority(right, input.now) - eventPriority(left, input.now))[0];

    if (!candidate) {
      continue;
    }

    if (!best || eventPriority(candidate, input.now) > eventPriority(best.event, input.now)) {
      best = { team, event: candidate };
    }
  }

  if (!best) {
    throw new Error("I couldn't find a recent or upcoming game for that team.");
  }

  const leagueEntry = getLeagueEntry(best.team.league)!;
  return {
    event: best.event,
    league: best.team.league,
    sport: leagueEntry.sport,
    teamIds: [best.team.id],
    citations: [
      {
        label: `${best.event.name} summary`,
        url: pickEventLink(best.event, best.team.league, leagueEntry.sport)
      }
    ]
  };
}

export function buildGameContextAnswer(event: ScheduleEvent): string {
  return `Using ${event.name} (${formatAbsoluteDate(event.date)}) as the active game context.`;
}

