# StreamStats

`StreamStats` is an ESPN-backed sports question resolver for AI agents. It is not a Discord bot by itself. It is the decision layer that turns sports language into live ESPN lookups and returns grounded answers with citations.

If you want an agent to answer questions like StatMuse and also handle follow-ups like `"Who hit that home run?"` or `"Who just hit that last 3 pointer?"`, this repo is the part that does the sports reasoning.

## What An AI Agent Should Load First

Load these files in this order:

1. `README.md`
2. `prompts/SPORTS_MEMORY.md`
3. `data/sports-registry.json`

Use them for different purposes:

- `README.md`: operating manual
- `prompts/SPORTS_MEMORY.md`: compact behavioral rules for the model
- `data/sports-registry.json`: machine-readable league, stat, season-type, and action alias map

Do not treat this repo as a sports fact database. It is a live resolver. Facts should come from ESPN at request time.

## What This Project Solves

This project currently handles two question classes:

1. Season leader questions
   Example: `"Who leads the NBA in assists this season?"`

2. Game-context follow-ups
   Example flow:
   - `"I'm watching the Bulls game"`
   - `"Who just hit that last 3 pointer?"`

The second class is the important one. Follow-ups are resolved against the stored game event, not against the last mentioned team unless the user explicitly asks for a team-specific answer.

Example:

- `"Mets game"` stores the current or most relevant Mets game as context.
- `"Who hit that home run?"` means the most recent home run in that stored game.
- It does not mean the most recent Mets home run unless the user says `"Who hit the last Mets home run?"`

## Agent Behavior Rules

If you are wiring this into a Discord agent, the agent should follow these rules before it ever tells a user something is unsupported:

1. Internally normalize obvious phrasing instead of asking the user to rephrase.
2. Reuse stream/watch/game commands as sports context.
3. Treat follow-ups as game-scoped unless the user explicitly asks for one team.
4. Only surface limitations after an actual ESPN lookup fails.

Examples of required internal rewrites:

- `"who's the latest scorer"` -> latest `score`
- `"who scored the last basket"` -> latest `basket`
- `"who just hit that 3 pointer"` -> latest `threePointer`
- `"what's the most recent event"` -> latest `event`

Important basketball distinction:

- `score` includes free throws
- `basket` means a made field goal and should not resolve to a free throw

If the user says `"turn on the Lakers game"` or `"I'm watching the Bulls game"`, the handler should store that event as active sports context for later follow-ups.

## Mental Model

When an AI agent uses this repo correctly, it should think in this order:

1. Detect intent.
   Is this a season leader question, a game lookup, or an event follow-up?
2. Resolve league and sport.
   Example: `"NBA"` maps to `basketball/nba`, `"Premier League"` maps to `soccer/eng.1`.
3. Resolve team or game context.
   If the user already anchored the conversation to a game, reuse that event.
4. Resolve season year and season type.
   `"this season"` should come from ESPN's current season endpoint, not model memory.
5. Choose the right ESPN source.
   Use core leaders when available. Use event summaries for in-game questions. Use stats page bootstrap parsing for soccer leader tables.
6. Answer with the resolved context in the response.
   Mention the league, season, or game used.

## Current Runtime Architecture

- `src/index.ts`
  Main service entrypoint. Exposes `StreamStatsService` and `answerSportsQuery`.
- `src/intent.ts`
  Parses raw language into an internal intent.
- `src/espn-client.ts`
  Fetches teams, season metadata, leaders, schedules, summaries, and stats-page bootstrap tables.
- `src/resolvers/leaders.ts`
  Answers season leader queries.
- `src/resolvers/game-context.ts`
  Picks the most relevant game for a team reference.
- `src/resolvers/events.ts`
  Finds the latest matching action in a stored event.
- `src/context-store.ts`
  Stores per-user, per-channel game context with a TTL.
- `data/sports-registry.json`
  Central alias and league configuration.

## Public API

```ts
import { StreamStatsService } from "streamstats";

const service = new StreamStatsService();

const result = await service.answerSportsQuery({
  channelId: "discord-channel-id",
  userId: "discord-user-id",
  text: "Who is the NBA assists leader this season?",
  now: new Date()
});
```

Return shape:

```ts
type AnswerResult = {
  answer: string;
  citations: Array<{ label: string; url: string }>;
  updatedContext: ConversationSportsContext | null;
};
```

Context shape:

```ts
type ConversationSportsContext = {
  channelId: string;
  userId: string;
  lastResolvedAt: string;
  lastSport?: "baseball" | "basketball" | "football" | "hockey" | "soccer";
  lastLeague?: string;
  lastTeamIds?: string[];
  lastEventId?: string;
  lastActionKey?: string;
};
```

## Resolution Flow

### 1. Intent Parsing

`src/intent.ts` classifies a query into one of three intents:

- `season_leader`
- `game_lookup`
- `event_follow_up`

It also tries to extract:

- league
- sport
- season year
- season type
- stat key
- action key
- team matches
- existing event context

### 2. League And Team Resolution

League aliases come from `data/sports-registry.json`.

Examples:

- `"nba"` -> `nba`
- `"college football"` -> `college-football`
- `"epl"` -> `eng.1`
- `"world cup"` -> `fifa.world`

Team resolution uses ESPN team directories from the site API and alias matching against:

- display name
- short display name
- location
- nickname
- abbreviation
- slug fragments

### 3. Season Resolution

Season metadata comes from:

`https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/season`

This repo uses that endpoint to determine:

- active season year
- display label such as `2025-26`
- current season type
- fallback regular season type when the current type is off-season

Examples:

- NBA `"this season"` in March 2026 should resolve using the 2025-26 season display.
- If a league is currently in off-season, the resolver falls back to the most recent completed primary regular season unless the user explicitly says otherwise.

### 4. Leader Resolution

For most supported sports, season leaders come from ESPN core leaders:

`https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/seasons/{year}/types/{type}/leaders`

The resolver then follows the returned athlete and team `$ref` links to get human-readable names.

For soccer, this repo uses a fallback because ESPN's public core leader coverage is not uniform across soccer tables. It parses the server-rendered stats page bootstrap payload:

- `https://www.espn.com/soccer/stats/_/league/{LEAGUE}/season/{year}/view/scoring`
- `https://www.espn.com/soccer/stats/_/league/{LEAGUE}/season/{year}/view/discipline`
- `https://www.espn.com/soccer/stats/_/league/{LEAGUE}/season/{year}/view/performance`

The parser extracts `window['__espnfitt__']` and normalizes the top row into a leader answer.

### 5. Game Context Resolution

When the user asks for a game, the resolver:

1. Resolves the team
2. Fetches that team's schedule from the ESPN site API
3. Ranks events by relevance

Schedule endpoint:

`https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams/{teamId}/schedule`

The ranking prefers:

- live games first
- then games starting soon
- then recently completed games

### 6. Event Follow-Up Resolution

When the user asks a follow-up like:

- `"Who hit that home run?"`
- `"Who just scored?"`
- `"Who just hit that last 3 pointer?"`

the resolver uses the stored `eventId` and fetches:

`https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/summary?event={eventId}`

It then scans the event payload for the most recent matching play.

Important rule:

- Follow-ups are event-scoped.
- They are not team-scoped unless the query explicitly says so.

That is the core behavior that prevents bad answers in mixed-team game flows.

## ESPN Endpoint Map Used By This Repo

These are the endpoints that matter for the current implementation:

| Purpose | Endpoint pattern |
| --- | --- |
| Current season metadata | `https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/season` |
| Season leaders | `https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/seasons/{year}/types/{type}/leaders` |
| Follow `$ref` entities | value from ESPN response, normalized to `https://` |
| League teams | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams` |
| Team schedule | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams/{teamId}/schedule` |
| Game summary | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/summary?event={eventId}` |
| Soccer stats fallback | `https://www.espn.com/{sport}/stats/_/league/{LEAGUE}/season/{year}/view/{view}` |

## Supported Leagues Right Now

These leagues are wired into `data/sports-registry.json` today:

| League key | Sport | Display name |
| --- | --- | --- |
| `mlb` | baseball | MLB |
| `nba` | basketball | NBA |
| `wnba` | basketball | WNBA |
| `mens-college-basketball` | basketball | NCAA Men's Basketball |
| `womens-college-basketball` | basketball | NCAA Women's Basketball |
| `nfl` | football | NFL |
| `college-football` | football | College Football |
| `nhl` | hockey | NHL |
| `eng.1` | soccer | Premier League |
| `usa.1` | soccer | MLS |
| `uefa.champions` | soccer | UEFA Champions League |
| `fifa.world` | soccer | FIFA World Cup |

The upstream ESPN docs support far more leagues than the registry currently includes. Extending coverage is usually a data change first, not a major code rewrite.

## Supported Query Vocabulary

This section describes what the resolver already knows how to map from natural language.

### Baseball

Season leader stats:

- batting average
- home runs
- RBIs
- runs
- OPS
- OBP
- slugging
- ERA
- wins
- strikeouts
- saves
- WHIP
- stolen bases
- hits

Game follow-up actions:

- home run
- hit
- strikeout

### Basketball

Season leader stats:

- points
- assists
- rebounds
- steals
- blocks
- field goal percentage
- free throw percentage
- three point percentage
- three pointers made
- turnovers
- minutes

Game follow-up actions:

- three pointer
- basket
- score
- assist
- rebound
- event

### Football

Season leader stats:

- passing yards
- rushing yards
- receiving yards
- touchdowns
- interceptions
- sacks

Game follow-up actions:

- touchdown
- field goal
- interception
- sack

### Hockey

Season leader stats:

- goals
- assists
- points
- plus minus
- GAA
- save percentage
- wins
- shutouts

Game follow-up actions:

- goal
- assist
- save

### Soccer

Season leader stats:

- goals
- scorers
- assists
- yellow cards
- red cards
- discipline points

Game follow-up actions:

- goal
- assist
- card

## Context Rules

These rules matter more than any individual endpoint:

1. Context is keyed by `channelId + userId`.
2. Context TTL is 240 minutes.
3. A new game lookup replaces the previous stored game for that user/channel pair.
4. Event follow-ups reuse `lastEventId` first.
5. If there is no event context and no team reference, the resolver should ask for a game first.

Example:

- User: `"Mets game"`
- System stores the chosen Mets event
- User: `"Who hit that home run?"`
- Resolver fetches the stored game summary and returns the most recent home run in that game

Example:

- User: `"I'm watching the Chicago Bulls game"`
- User: `"Who just hit that last 3 pointer?"`
- Resolver returns the latest 3-point make in the Bulls game event, even if the shooter plays for the opponent

Example:

- User: `"turn on the Lakers game"`
- Handler starts the stream and stores the chosen Lakers event
- User: `"who just scored that basket?"`
- Resolver uses the stored Lakers event instead of asking the user to restate the matchup

## How Answers Should Read

The answer should make the resolved context obvious.

Good:

- `"Nikola Jokic (Denver Nuggets) is the NBA 2025-26 assists per game leader at 10.3."`
- `"Josh Giddey had the most recent score in Chicago Bulls at Golden State Warriors. Josh Giddey makes free throw 1 of 2 (OT)."`
- `"Matas Buzelis had the most recent basket in Chicago Bulls at Golden State Warriors. Matas Buzelis makes 28-foot three point step back jumpshot (Josh Giddey assists) (OT)."`
- `"Gui Santos had the most recent three-pointer in Chicago Bulls at Golden State Warriors. Gui Santos makes 26-foot three point jumper (Pat Spencer assists) (OT)."`

Bad:

- `"It's Jokic."`
- `"That was Gui Santos."`

Short answers are fine, but they should still expose the resolved league, season, or game.

## How To Integrate This Into A Discord Agent

Recommended pattern:

1. Instantiate one `StreamStatsService` for the process.
2. Call `answerSportsQuery` on each sports-like message.
3. Pass real `channelId`, `userId`, and the incoming message text.
4. Persist context externally if you need restarts or multi-instance scaling.

Example:

```ts
const sports = new StreamStatsService();

async function handleMessage(message: {
  channelId: string;
  authorId: string;
  content: string;
}) {
  const result = await sports.answerSportsQuery({
    channelId: message.channelId,
    userId: message.authorId,
    text: message.content,
    now: new Date()
  });

  return {
    text: result.answer,
    citations: result.citations
  };
}
```

If you need persistent memory, replace `MemoryContextStore` with your own `ContextStore` implementation.

## How To Extend Coverage

Most new support falls into one of these buckets:

### Add a new league

Update `data/sports-registry.json`:

- add a new `leagues.{leagueKey}` entry
- map it to a supported sport slug
- add league aliases users are likely to say

### Add a new stat synonym

Update `sports.{sport}.statAliases` in `data/sports-registry.json`.

Example:

- map `"dimes"` to `assistsPerGame`

### Add a new follow-up action

1. Add the alias in `sports.{sport}.actionAliases`
2. Teach `src/resolvers/events.ts` how to identify the play reliably
3. Add a regression test in `tests/streamstats.test.ts`

### Add a new sport-family behavior

If ESPN summary payloads for that sport need custom parsing, extend:

- `actionMatcher`
- `playSpecificityScore`
- `extractActorId`

in `src/resolvers/events.ts`.

## Known Limits

- This repo currently focuses on leader queries and game follow-ups. It is not a complete sports analytics engine.
- Soccer leader answers rely on parsing ESPN's rendered stats-page bootstrap payload instead of a single stable public leaders endpoint.
- Player-specific question types like `"How many assists does X have this season?"` are not yet implemented as a first-class intent.
- Team matching is alias-based and should be tested when you add leagues with overlapping nicknames.
- Context storage is in-memory unless you provide a custom store.

## Local Development

Requirements:

- Node.js `>= 20`

Commands:

```bash
npm install
npm run build
npm run typecheck
npm test
```

## Files That Matter Most

- `README.md`
  Human and agent operator guide
- `prompts/SPORTS_MEMORY.md`
  Compact prompt file to hand to the model
- `data/sports-registry.json`
  League and language mapping
- `tests/streamstats.test.ts`
  Behavior examples and regression coverage

## Upstream ESPN Documentation Used

This repo is built around the public ESPN patterns documented here:

- Basketball docs: [Public-ESPN-API basketball](https://github.com/pseudo-r/Public-ESPN-API/blob/main/docs/sports/basketball.md)
- Baseball docs: [Public-ESPN-API baseball](https://github.com/pseudo-r/Public-ESPN-API/blob/main/docs/sports/baseball.md)
- Football docs: [Public-ESPN-API football](https://github.com/pseudo-r/Public-ESPN-API/blob/main/docs/sports/football.md)
- Hockey docs: [Public-ESPN-API hockey](https://github.com/pseudo-r/Public-ESPN-API/blob/main/docs/sports/hockey.md)
- Soccer docs: [Public-ESPN-API soccer](https://github.com/pseudo-r/Public-ESPN-API/blob/main/docs/sports/soccer.md)
- Sports docs index: [Public-ESPN-API sports docs](https://github.com/pseudo-r/Public-ESPN-API/tree/main/docs/sports)

Those docs expose the broader league and endpoint surface. `StreamStats` narrows that into an opinionated resolver flow for AI agents.
