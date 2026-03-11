import type { ConversationSportsContext } from "./types.js";

export interface ContextStore {
  get(channelId: string, userId: string): ConversationSportsContext | undefined;
  set(context: ConversationSportsContext): void;
  delete(channelId: string, userId: string): void;
}

export class MemoryContextStore implements ContextStore {
  private readonly contexts = new Map<string, ConversationSportsContext>();

  constructor(private readonly ttlMs: number) {}

  get(channelId: string, userId: string): ConversationSportsContext | undefined {
    const key = this.buildKey(channelId, userId);
    const context = this.contexts.get(key);

    if (!context) {
      return undefined;
    }

    const ageMs = Date.now() - new Date(context.lastResolvedAt).getTime();

    if (ageMs > this.ttlMs) {
      this.contexts.delete(key);
      return undefined;
    }

    return context;
  }

  set(context: ConversationSportsContext): void {
    this.contexts.set(this.buildKey(context.channelId, context.userId), context);
  }

  delete(channelId: string, userId: string): void {
    this.contexts.delete(this.buildKey(channelId, userId));
  }

  private buildKey(channelId: string, userId: string): string {
    return `${channelId}::${userId}`;
  }
}

