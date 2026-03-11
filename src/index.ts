import { MemoryContextStore, type ContextStore } from "./context-store.js";
import { EspnClient } from "./espn-client.js";
import { parseSportsIntent } from "./intent.js";
import { getRegistry } from "./registry.js";
import { buildMissingEventContextAnswer, resolveEventAction } from "./resolvers/events.js";
import { buildGameContextAnswer, resolveGameContext } from "./resolvers/game-context.js";
import { resolveSeasonLeader } from "./resolvers/leaders.js";
import type { AnswerResult, ConversationSportsContext, QueryRequest } from "./types.js";

export interface StreamStatsOptions {
  fetchImpl?: typeof fetch;
  contextStore?: ContextStore;
}

export class StreamStatsService {
  private readonly client: EspnClient;
  private readonly contextStore: ContextStore;

  constructor(options: StreamStatsOptions = {}) {
    const registry = getRegistry();
    this.client = new EspnClient(options.fetchImpl);
    this.contextStore = options.contextStore ?? new MemoryContextStore(registry.contextTtlMinutes * 60 * 1000);
  }

  async answerSportsQuery(request: QueryRequest): Promise<AnswerResult> {
    const now = request.now ?? new Date();
    const context = this.contextStore.get(request.channelId, request.userId, now);
    const intent = await parseSportsIntent({
      text: request.text,
      client: this.client,
      context
    });

    try {
      if (intent.intent === "season_leader") {
        if (!intent.league || !intent.statKey) {
          throw new Error("I need a league and a stat to answer that leader question.");
        }

        const result = await resolveSeasonLeader({
          client: this.client,
          league: intent.league,
          statKey: intent.statKey,
          seasonYear: intent.seasonYear,
          seasonType: intent.seasonType
        });

        const updatedContext = this.persistContext(request, {
          lastLeague: intent.league,
          lastSport: intent.sport,
          lastActionKey: undefined
        });

        return {
          answer: result.answer,
          citations: result.citations,
          updatedContext
        };
      }

      if (intent.intent === "game_lookup") {
        const gameContext = await resolveGameContext({
          client: this.client,
          teamMatches: intent.teamMatches,
          preferredLeague: intent.league,
          now
        });

        const updatedContext = this.persistContext(request, {
          lastLeague: gameContext.league,
          lastSport: gameContext.sport as ConversationSportsContext["lastSport"],
          lastTeamIds: gameContext.teamIds,
          lastEventId: gameContext.event.id,
          lastActionKey: undefined
        });

        return {
          answer: buildGameContextAnswer(gameContext.event),
          citations: gameContext.citations,
          updatedContext
        };
      }

      if (!intent.actionKey) {
        return {
          answer: buildMissingEventContextAnswer(),
          citations: [],
          updatedContext: context ?? null
        };
      }

      const eventResult = await resolveEventAction({
        client: this.client,
        actionKey: intent.actionKey,
        eventId: intent.eventId,
        league: intent.league,
        teamMatches: intent.teamMatches,
        now
      });

      const updatedContext = this.persistContext(request, {
        lastLeague: eventResult.league,
        lastSport: eventResult.sport as ConversationSportsContext["lastSport"],
        lastTeamIds: eventResult.teamIds,
        lastEventId: eventResult.eventId,
        lastActionKey: intent.actionKey
      });

      return {
        answer: eventResult.answer,
        citations: eventResult.citations,
        updatedContext
      };
    } catch (error) {
      return {
        answer: error instanceof Error ? error.message : "I couldn't resolve that sports question.",
        citations: [],
        updatedContext: context ?? null
      };
    }
  }

  private persistContext(
    request: QueryRequest,
    partial: Omit<ConversationSportsContext, "channelId" | "userId" | "lastResolvedAt">
  ): ConversationSportsContext {
    const context: ConversationSportsContext = {
      channelId: request.channelId,
      userId: request.userId,
      lastResolvedAt: (request.now ?? new Date()).toISOString(),
      ...partial
    };

    this.contextStore.set(context);
    return context;
  }
}

export async function answerSportsQuery(
  request: QueryRequest,
  options: StreamStatsOptions = {}
): Promise<AnswerResult> {
  const service = new StreamStatsService(options);
  return service.answerSportsQuery(request);
}

export { MemoryContextStore } from "./context-store.js";
export type { AnswerResult, Citation, ConversationSportsContext, QueryRequest, SportsQueryIntent } from "./types.js";
