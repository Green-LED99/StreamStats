import { describe, expect, it } from "vitest";

import { StreamStatsService } from "../src/index.js";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html"
    }
  });
}

function bootstrapHtml(payload: unknown): string {
  return `<html><body><script>window['__espnfitt__']=${JSON.stringify(payload)};</script></body></html>`;
}

describe("StreamStatsService", () => {
  it("uses the most recent home run in the game, not the last referenced team's home run", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);

      if (url === "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams") {
        return jsonResponse({
          sports: [
            {
              leagues: [
                {
                  teams: [
                    {
                      team: {
                        id: "21",
                        displayName: "New York Mets",
                        shortDisplayName: "Mets",
                        location: "New York",
                        name: "Mets",
                        abbreviation: "NYM",
                        slug: "new-york-mets"
                      }
                    }
                  ]
                }
              ]
            }
          ]
        });
      }

      if (url.endsWith("/teams") && !url.includes("/baseball/mlb/teams")) {
        return jsonResponse({
          sports: [{ leagues: [{ teams: [] }] }]
        });
      }

      if (url === "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/21/schedule") {
        return jsonResponse({
          events: [
            {
              id: "401833141",
              date: "2026-03-10T17:10:00Z",
              name: "St. Louis Cardinals at New York Mets",
              shortName: "STL @ NYM",
              competitions: [
                {
                  status: {
                    type: {
                      state: "post",
                      completed: true,
                      description: "Final"
                    }
                  }
                }
              ]
            }
          ]
        });
      }

      if (url === "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=401833141") {
        return jsonResponse({
          header: {
            competitions: [
              {
                name: "St. Louis Cardinals at New York Mets"
              }
            ]
          },
          plays: [
            {
              id: "1",
              text: "Alvarez homered to center (439 feet), Baty scored.",
              wallclock: "2026-03-10T17:56:09Z",
              period: {
                displayValue: "3rd Inning"
              },
              participants: [
                {
                  type: "batter",
                  athlete: {
                    id: "41253"
                  }
                }
              ]
            },
            {
              id: "2",
              text: "Gorman homered to right (421 feet).",
              wallclock: "2026-03-10T18:10:00Z",
              period: {
                displayValue: "4th Inning"
              },
              participants: [
                {
                  type: "batter",
                  athlete: {
                    id: "35032"
                  }
                }
              ]
            }
          ],
          boxscore: {
            players: [
              {
                statistics: [
                  {
                    athletes: [
                      {
                        athlete: {
                          id: "41253",
                          displayName: "Francisco Alvarez"
                        }
                      },
                      {
                        athlete: {
                          id: "35032",
                          displayName: "Nolan Gorman"
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        });
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    };

    const service = new StreamStatsService({ fetchImpl });

    const gameContext = await service.answerSportsQuery({
      channelId: "channel-1",
      userId: "user-1",
      text: "Mets game",
      now: new Date("2026-03-10T19:00:00Z")
    });

    expect(gameContext.updatedContext?.lastEventId).toBe("401833141");

    const followUp = await service.answerSportsQuery({
      channelId: "channel-1",
      userId: "user-1",
      text: "Who hit that home run?",
      now: new Date("2026-03-10T19:05:00Z")
    });

    expect(followUp.answer).toContain("Nolan Gorman");
    expect(followUp.answer).toContain("most recent home run");
    expect(followUp.answer).not.toContain("Francisco Alvarez");
  });

  it("answers NBA leader queries from the ESPN core leaders endpoint", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);

      if (url === "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams") {
        return jsonResponse({
          sports: [{ leagues: [{ teams: [] }] }]
        });
      }

      if (url === "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/season") {
        return jsonResponse({
          year: 2026,
          displayName: "2025-26",
          type: {
            id: "2",
            name: "Regular Season",
            abbreviation: "reg"
          },
          types: {
            items: [
              { id: "2", name: "Regular Season", abbreviation: "reg" }
            ]
          }
        });
      }

      if (url === "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/types/2/leaders") {
        return jsonResponse({
          categories: [
            {
              name: "assistsPerGame",
              displayName: "Assists Per Game",
              leaders: [
                {
                  displayValue: "10.3",
                  athlete: {
                    $ref: "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/athletes/3112335"
                  },
                  team: {
                    $ref: "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/teams/7"
                  }
                }
              ]
            }
          ]
        });
      }

      if (url === "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/athletes/3112335") {
        return jsonResponse({
          id: "3112335",
          displayName: "Nikola Jokic"
        });
      }

      if (url === "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/teams/7") {
        return jsonResponse({
          id: "7",
          displayName: "Denver Nuggets"
        });
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    };

    const service = new StreamStatsService({ fetchImpl });
    const answer = await service.answerSportsQuery({
      channelId: "channel-2",
      userId: "user-2",
      text: "Who is the NBA assists leader this season?",
      now: new Date("2026-03-11T00:00:00Z")
    });

    expect(answer.answer).toContain("Nikola Jokic");
    expect(answer.answer).toContain("2025-26");
    expect(answer.answer).toContain("10.3");
  });

  it("falls back to ESPN stats page bootstrap data for soccer leader queries", async () => {
    const scoringBootstrap = {
      page: {
        content: {
          statistics: {
            tables: [
              {
                title: "Top Scorers",
                headers: [
                  { type: "rank", title: "RK" },
                  { type: "athlete", title: "Name" },
                  { type: "team", title: "Team" },
                  { type: "appearances", title: "P", isStats: true },
                  { type: "totalGoals", title: "G", isStats: true }
                ]
              },
              {
                title: "Top Assists",
                headers: [
                  { type: "rank", title: "RK" },
                  { type: "athlete", title: "Name" },
                  { type: "team", title: "Team" },
                  { type: "appearances", title: "P", isStats: true },
                  { type: "goalAssists", title: "A", isStats: true }
                ]
              }
            ],
            tableRows: [
              [
                [
                  1,
                  { name: "Top Scorer" },
                  { name: "Arsenal" },
                  { isStats: true, value: "28" },
                  { isStats: true, value: "22" }
                ]
              ],
              [
                [
                  1,
                  { name: "Bukayo Saka" },
                  { name: "Arsenal" },
                  { isStats: true, value: "28" },
                  { isStats: true, value: "14" }
                ]
              ]
            ]
          }
        }
      }
    };

    const emptyBootstrap = {
      page: {
        content: {
          statistics: {
            tables: [],
            tableRows: []
          }
        }
      }
    };

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);

      if (url === "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams") {
        return jsonResponse({
          sports: [{ leagues: [{ teams: [] }] }]
        });
      }

      if (url === "https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/season") {
        return jsonResponse({
          year: 2025,
          displayName: "2025-26 English Premier League",
          type: {
            id: "1",
            name: "2025-26 English Premier League"
          },
          types: {
            items: []
          }
        });
      }

      if (url === "https://www.espn.com/soccer/stats/_/league/ENG.1/season/2025/view/scoring") {
        return htmlResponse(bootstrapHtml(scoringBootstrap));
      }

      if (url === "https://www.espn.com/soccer/stats/_/league/ENG.1/season/2025/view/discipline") {
        return htmlResponse(bootstrapHtml(emptyBootstrap));
      }

      if (url === "https://www.espn.com/soccer/stats/_/league/ENG.1/season/2025/view/performance") {
        return htmlResponse(bootstrapHtml(emptyBootstrap));
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    };

    const service = new StreamStatsService({ fetchImpl });
    const answer = await service.answerSportsQuery({
      channelId: "channel-3",
      userId: "user-3",
      text: "Who is the Premier League assists leader this season?",
      now: new Date("2026-03-11T00:00:00Z")
    });

    expect(answer.answer).toContain("Bukayo Saka");
    expect(answer.answer).toContain("Premier League");
    expect(answer.answer).toContain("14");
  });

  it("distinguishes latest scorer, last basket, and most recent event in a basketball game", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);

      if (url === "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams") {
        return jsonResponse({
          sports: [
            {
              leagues: [
                {
                  teams: [
                    {
                      team: {
                        id: "4",
                        displayName: "Chicago Bulls",
                        shortDisplayName: "Bulls",
                        location: "Chicago",
                        name: "Bulls",
                        abbreviation: "CHI",
                        slug: "chicago-bulls"
                      }
                    }
                  ]
                }
              ]
            }
          ]
        });
      }

      if (url.endsWith("/teams") && !url.includes("/basketball/nba/teams")) {
        return jsonResponse({
          sports: [{ leagues: [{ teams: [] }] }]
        });
      }

      if (url === "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/4/schedule") {
        return jsonResponse({
          events: [
            {
              id: "401810798",
              date: "2026-03-11T03:00:00Z",
              name: "Chicago Bulls at Golden State Warriors",
              shortName: "CHI @ GS",
              competitions: [
                {
                  status: {
                    type: {
                      state: "in",
                      completed: false,
                      description: "In Progress"
                    }
                  }
                }
              ],
              links: [
                {
                  href: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401810798",
                  text: "Summary"
                }
              ]
            }
          ]
        });
      }

      if (url === "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401810798") {
        return jsonResponse({
          header: {
            competitions: [
              {
                name: "Chicago Bulls at Golden State Warriors"
              }
            ]
          },
          plays: [
            {
              id: "1",
              text: "Matas Buzelis makes 28-foot three point step back jumpshot (Josh Giddey assists)",
              wallclock: "2026-03-11T04:37:05Z",
              scoringPlay: true,
              period: {
                displayValue: "OT"
              },
              participants: [
                {
                  type: "athlete",
                  athlete: {
                    id: "1001"
                  }
                }
              ]
            },
            {
              id: "2",
              text: "Josh Giddey makes free throw 1 of 2",
              wallclock: "2026-03-11T04:37:50Z",
              scoringPlay: true,
              period: {
                displayValue: "OT"
              },
              participants: [
                {
                  type: "athlete",
                  athlete: {
                    id: "1002"
                  }
                }
              ]
            },
            {
              id: "3",
              text: "Josh Giddey misses free throw 2 of 2",
              wallclock: "2026-03-11T04:38:00Z",
              scoringPlay: false,
              period: {
                displayValue: "OT"
              },
              participants: [
                {
                  type: "athlete",
                  athlete: {
                    id: "1002"
                  }
                }
              ]
            }
          ],
          boxscore: {
            players: [
              {
                statistics: [
                  {
                    athletes: [
                      {
                        athlete: {
                          id: "1001",
                          displayName: "Matas Buzelis"
                        }
                      },
                      {
                        athlete: {
                          id: "1002",
                          displayName: "Josh Giddey"
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        });
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    };

    const service = new StreamStatsService({ fetchImpl });

    const gameContext = await service.answerSportsQuery({
      channelId: "channel-4",
      userId: "user-4",
      text: "I'm watching the Bulls game",
      now: new Date("2026-03-11T04:36:00Z")
    });

    expect(gameContext.updatedContext?.lastEventId).toBe("401810798");

    const latestScorer = await service.answerSportsQuery({
      channelId: "channel-4",
      userId: "user-4",
      text: "who's the latest scorer",
      now: new Date("2026-03-11T04:38:01Z")
    });

    expect(latestScorer.answer).toContain("Josh Giddey");
    expect(latestScorer.answer).toContain("most recent score");

    const lastBasket = await service.answerSportsQuery({
      channelId: "channel-4",
      userId: "user-4",
      text: "who scored the last basket",
      now: new Date("2026-03-11T04:38:02Z")
    });

    expect(lastBasket.answer).toContain("Matas Buzelis");
    expect(lastBasket.answer).toContain("most recent basket");
    expect(lastBasket.answer).not.toContain("free throw 1 of 2");

    const latestEvent = await service.answerSportsQuery({
      channelId: "channel-4",
      userId: "user-4",
      text: "what's the most recent event in the bulls game",
      now: new Date("2026-03-11T04:38:03Z")
    });

    expect(latestEvent.answer).toContain("most recent event");
    expect(latestEvent.answer).toContain("Josh Giddey misses free throw 2 of 2");
  });
});
