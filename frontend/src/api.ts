// Typed client for the Go simulator API. Served from the same origin in
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

export interface Standing {
  team: string;
  group: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  rank: number;
  qualified?: boolean;
}

export interface Match {
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  played: boolean;
  stage: string;
  winner?: string;
  shootout?: boolean;
  homePens?: number;
  awayPens?: number;
}

export interface GroupResult {
  group: string;
  standings: Standing[];
  matches: Match[];
}

export interface KnockoutRound {
  name: string;
  matches: Match[];
}

export interface TournamentResult {
  seed: number;
  groups: GroupResult[];
  thirdPlaceTable: Standing[];
  knockout: KnockoutRound[];
  champion: string;
  runnerUp: string;
  third: string;
}

export interface TeamOdds {
  team: string;
  champion: number;
  final: number;
  semiFinal: number;
}

export interface OddsResult {
  runs: number;
  odds: TeamOdds[];
}

// Empty string keeps requests on the current origin (the Go server hosts both
// the API and these static files).
const API_BASE = "";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function getTeams(): Promise<{ teams: Team[]; groups: string[] }> {
  return getJSON("/api/teams");
}

export function simulate(seed?: number): Promise<TournamentResult> {
  const query = seed != null && Number.isFinite(seed) ? `?seed=${seed}` : "";
  return getJSON(`/api/simulate${query}`);
}

export function odds(runs: number): Promise<OddsResult> {
  return getJSON(`/api/odds?runs=${runs}`);
}
