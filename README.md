# StreamStats

`StreamStats` is a reusable ESPN-backed sports query core for Discord agents. It resolves two things reliably:

- StatMuse-style season questions such as "Who leads the NBA in assists this season?"
- Game-context follow-ups such as "Who hit that home run?" after a user has already anchored the conversation to a game

## Core Rules

- All factual sports answers must be resolved from ESPN at request time.
- The system must restate the resolved season and competition type in final answers.
- Game follow-ups are scoped to the referenced event, not to the last referenced team.
- `"Who hit that home run?"` means the most recent home run in the stored game context, regardless of which team hit it.

## Planned Layout

- `src/`: query parsing, ESPN client, leader resolver, event resolver, context store
- `data/sports-registry.json`: league registry, stat aliases, action aliases, source strategy
- `prompts/SPORTS_MEMORY.md`: model-facing memory file
- `tests/`: intent, context, and resolver coverage

## Git Notes

- This folder is its own Git repository.
- Commits are intentionally fine-grained to document scaffold, registry, client, resolver, and test changes.
- Push is deferred until a remote is configured for this repository.

