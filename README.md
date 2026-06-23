# ⚽ World Cup 2026 Prediction Game

A web app that turns the **48-team FIFA World Cup 2026** into a prediction game.
The real group-stage results so far are **imported as the baseline** and locked;
you predict every remaining match, watch the group tables project in real time,
and run Monte Carlo **title odds** conditioned on the actual results plus your
own picks. **Go** backend, **Bun + TypeScript** frontend.

- **Real baseline** — the actual groups and results through the import date are
  loaded as ground truth. Played matches are locked; only open matches are
  predictable. (Edit `backend/internal/data/fixtures.go` to import newer
  results.)
- **Predict the rest** — type a scoreline for every open match. Picks are saved
  in your browser, and an auto-pick button fills them from the team ratings.
- **Projected tables** — the group standings update live from the real results
  plus your predictions, highlighting who advances (top two of each group plus
  the eight best third-placed teams).
- **Conditional title odds** — run thousands of tournaments with the decided
  results held fixed to see each nation's chance to reach the knockout, the
  final, and lift the trophy in *your* scenario.

## Scoring

When newer results are imported, each prediction is scored against the actual
match outcome:

| Points | Outcome                                |
| ------ | -------------------------------------- |
| **3**  | exact scoreline                        |
| **1**  | correct result (win / draw / loss)     |
| **0**  | anything else                          |

## Architecture

```
backend/    Go HTTP server + simulation engine (no external dependencies)
  main.go             entrypoint, flags, static hosting
  internal/data/      the 48 teams in their real groups (teams.go) and the
                      real fixtures + baseline results (fixtures.go)
  internal/sim/       match model, group/knockout logic, conditional odds
  internal/api/       JSON API + single-page app hosting
frontend/   Bun-bundled TypeScript single-page app
  src/index.html      page shell (Bun HTML entrypoint)
  src/main.ts         prediction UI, projected tables, localStorage picks
  src/api.ts          typed API client
  src/styles.css      dark neumorphism theme
run.sh      build the frontend and start the server
```

The Go server serves both the JSON API (`/api/*`) and the built frontend from
`frontend/dist`, so everything runs on a single origin and port.

## Prerequisites

- [Go](https://go.dev/dl/) 1.21+
- [Bun](https://bun.sh) 1.1+

## Quick start

```bash
./run.sh
# then open http://localhost:8080
```

`run.sh` builds the frontend with Bun and starts the Go server. Set `PORT` to
change the port (e.g. `PORT=9000 ./run.sh`).

### Manual steps

```bash
# 1. Build the frontend
cd frontend
bun install        # first time only (for the optional typecheck)
bun run build      # outputs frontend/dist

# 2. Run the server
cd ../backend
go run .           # serves API + frontend on :8080
```

## API

| Endpoint            | Description                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/state`    | The 48 teams, the 12 group letters, the full fixture list (with baseline results) and the import date. |
| `GET /api/odds?runs=N`  | Title odds conditioned on the real results only.                                         |
| `POST /api/odds`    | Title odds conditioned on the real results **plus** the predictions in the request body.     |
| `GET /api/health`   | Liveness check.                                                                              |

```bash
curl "http://localhost:8080/api/state"
curl "http://localhost:8080/api/odds?runs=10000"
curl -X POST http://localhost:8080/api/odds \
  -H 'Content-Type: application/json' \
  -d '{"runs":10000,"predictions":{"A5":{"homeGoals":2,"awayGoals":1}}}'
```

## How it works

- **Baseline import.** `fixtures.go` lists all 72 group matches; the ones played
  through `DataAsOf` carry the real scoreline and are locked. Everything else is
  open for prediction. To refresh the baseline as the tournament progresses,
  flip an `open(...)` fixture to `played(...)` with its result.
- **Match model.** Each team has an Elo-like `rating`. For matches that still
  have to be simulated, expected goals come from the rating gap via a Poisson
  model; the actual score is sampled from that distribution. Knockout ties go to
  extra time and then a penalty shootout.
- **Conditional odds.** Every decided result — real or predicted — is held fixed
  while the remaining group matches and the whole knockout bracket are sampled
  thousands of times, so the probabilities reflect the tournament as it actually
  stands plus your scenario.
- **Group ranking.** Points → goal difference → goals for → strength, mirroring
  FIFA's tiebreakers. The 12 winners and 12 runners-up advance, joined by the
  best 8 of the 12 third-placed teams.

Team ratings are approximate, early-2026 estimates and are intended purely for
entertainment.

## Development

```bash
# Frontend: rebuild on change
cd frontend && bun run dev      # bun build --watch into dist
bun run typecheck               # tsc --noEmit (requires bun install)

# Backend: tests, vet, format
cd backend && go test ./... && go vet ./... && gofmt -l .
```

After editing frontend source, rebuild (`bun run build`) and refresh; the Go
server serves whatever is in `frontend/dist`.
