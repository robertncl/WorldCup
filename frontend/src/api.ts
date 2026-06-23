// Typed client for the Go prediction-game API. Served from the same origin in
// production; `API_BASE` can point elsewhere during development.

export interface Team {
  code: string;
  name: string;
  flag: string;
  confederation: string;
  rating: number;
  group: string;
  host: boolean;
}

export interface Fixture {
  id: string;
  group: string;
  home: string;
  away: string;
  date: string;
  played: boolean;
  homeGoals: number;
  awayGoals: number;
}

export interface GameState {
  teams: Team[];
  groups: string[];
  fixtures: Fixture[];
  asOf: string;
}

export interface TeamOdds {
  team: string;
  champion: number;
  final: number;
  semiFinal: number;
  advance: number;
}

export interface OddsResult {
  runs: number;
  odds: TeamOdds[];
}

// A predicted scoreline for an open fixture, keyed by fixture id when sent.
export interface Prediction {
  homeGoals: number;
  awayGoals: number;
}

// Empty string keeps requests on the current origin (the Go server hosts both
// the API and these static files).
const API_BASE = "";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function getState(): Promise<GameState> {
  return getJSON("/api/state");
}

// runOdds asks the Monte Carlo engine for probabilities conditioned on the real
// results so far plus the supplied predictions for open fixtures.
export async function runOdds(
  predictions: Record<string, Prediction>,
  runs: number,
): Promise<OddsResult> {
  const res = await fetch(`${API_BASE}/api/odds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runs, predictions }),
  });
  if (!res.ok) throw new Error(`/api/odds failed: ${res.status}`);
  return res.json() as Promise<OddsResult>;
}
