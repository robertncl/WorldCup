# ⚽ World Cup 2026 Simulator

A web app that simulates the **48-team FIFA World Cup 2026** — group stage,
knockout bracket, and Monte Carlo championship odds — with a **Go** backend and
a **Bun + TypeScript** frontend.

- **Group stage** — 12 groups of 4, full round-robin, with the top two plus the
  eight best third-placed teams advancing.
- **Knockout bracket** — Round of 32 → Round of 16 → Quarter-finals →
  Semi-finals → Final, with extra time and penalty shootouts.
- **Monte Carlo odds** — run thousands of tournaments and see each nation's
  probability of reaching the semis, the final, and lifting the trophy.
- **Reproducible** — every simulation has a seed you can re-enter to replay the
  exact same tournament.

## Architecture

```
backend/    Go HTTP server + simulation engine (no external dependencies)
  main.go             entrypoint, flags, static hosting
  internal/data/      the 48 teams, ratings, and group draw
  internal/sim/       match model, group/knockout logic, Monte Carlo odds
  internal/api/       JSON API + single-page app hosting
frontend/   Bun-bundled TypeScript single-page app
  src/index.html      page shell (Bun HTML entrypoint)
  src/main.ts         rendering + interaction
  src/api.ts          typed API client
  src/styles.css      theme
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

| Endpoint                  | Description                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `GET /api/teams`          | The 48 teams and the 12 group letters.                             |
| `GET /api/simulate`       | Simulate one tournament. Optional `?seed=<int>` for reproducibility. |
| `GET /api/odds?runs=N`    | Run `N` tournaments (100–50,000) and return aggregate probabilities. |
| `GET /api/health`         | Liveness check.                                                    |

```bash
curl "http://localhost:8080/api/simulate?seed=2026"
curl "http://localhost:8080/api/odds?runs=10000"
```

## How the simulation works

- **Match model.** Each team has an Elo-like `rating`. A match's expected goals
  for each side come from the rating gap via a Poisson model; the actual score
  is sampled from that distribution. Knockout ties go to extra time and then a
  penalty shootout whose per-kick conversion is nudged by team strength.
- **Group ranking.** Points → goal difference → goals for → strength → drawing
  of lots (a per-team random key), mirroring FIFA's tiebreakers.
- **Qualification.** The 12 group winners and 12 runners-up advance, joined by
  the best 8 of the 12 third-placed teams.
- **Bracket seeding.** The 32 qualifiers are seeded (winners above runners-up
  above third-placed teams, then by record) and placed into a standard
  single-elimination bracket so the strongest teams can only meet late.

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
