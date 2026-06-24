import {
  getState,
  runOdds,
  type Team,
  type Fixture,
  type GameState,
  type Prediction,
  type OddsResult,
} from "./api";

// ---------- State ----------

const teamMap = new Map<string, Team>();
let state: GameState = { teams: [], groups: [], fixtures: [], asOf: "" };
let openFixtures: Fixture[] = [];

// Player picks, persisted in the browser. Only open (not-yet-played) fixtures
// can be predicted; played fixtures are the imported baseline and stay locked.
const PRED_KEY = "wc2026.predictions.v2";
const CHAMP_KEY = "wc2026.champion.v2";
const KO_KEY = "wc2026.knockout.v1";
let predictions: Record<string, Prediction> = loadPredictions();
let championPick = localStorage.getItem(CHAMP_KEY) ?? "";

// Knockout picks: which team the player advances out of each bracket tie, keyed
// by a stable round-match slot (e.g. "0-3" or "3p"). A pick only takes effect
// while it still names one of that tie's two current teams, so it survives
// group-prediction edits that leave the matchup unchanged and is ignored
// otherwise.
let knockoutPicks: Record<string, string> = loadKnockout();
let lastChampionShown = ""; // champion the bracket last celebrated, to fire confetti once

// Odds are computed on demand; flag them stale when predictions change.
let lastOdds: OddsResult | null = null;
let oddsStale = false;

function loadPredictions(): Record<string, Prediction> {
  try {
    const raw = localStorage.getItem(PRED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Prediction>) : {};
  } catch {
    return {};
  }
}
function savePredictions(): void {
  localStorage.setItem(PRED_KEY, JSON.stringify(predictions));
}

function loadKnockout(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KO_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function saveKnockout(): void {
  localStorage.setItem(KO_KEY, JSON.stringify(knockoutPicks));
}

// ---------- DOM helpers ----------

type Attrs = Record<string, string | number | boolean | undefined>;

function h(tag: string, attrs: Attrs = {}, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

const $ = <T extends HTMLElement>(selector: string): T =>
  document.querySelector(selector) as T;

const els = {
  asOf: $<HTMLElement>("#as-of"),
  autopick: $<HTMLButtonElement>("#autopick-btn"),
  clear: $<HTMLButtonElement>("#clear-btn"),
  summary: $<HTMLDivElement>("#summary"),
  status: $<HTMLDivElement>("#status"),
  panels: {
    predict: $<HTMLElement>("#panel-predict"),
    tables: $<HTMLElement>("#panel-tables"),
    knockout: $<HTMLElement>("#panel-knockout"),
    odds: $<HTMLElement>("#panel-odds"),
  },
};

// ---------- Formatting ----------

const nameOf = (code: string): string => teamMap.get(code)?.name ?? code;
const flagOf = (code: string): string => teamMap.get(code)?.flag ?? "🏳️";
const ratingOf = (code: string): number => teamMap.get(code)?.rating ?? 1700;

function pct(value: number): string {
  if (value <= 0) return "0%";
  if (value < 0.001) return "<0.1%";
  return `${(value * 100).toFixed(1)}%`;
}

function setStatus(message: string, kind: "info" | "error" = "info"): void {
  els.status.textContent = message;
  els.status.dataset.kind = kind;
  els.status.classList.toggle("show", message !== "");
}

// ---------- Tabs ----------

function setupTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tab")];
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab ?? "predict"));
    tab.addEventListener("keydown", (e) => {
      const idx = tabs.indexOf(tab);
      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % tabs.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      else return;
      e.preventDefault();
      const target = tabs[next];
      activateTab(target.dataset.tab ?? "predict");
      target.focus();
    });
  });
}

function activateTab(name: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const [key, panel] of Object.entries(els.panels)) {
    panel.hidden = key !== name;
  }
  if (name === "tables") renderTables();
  if (name === "knockout") renderKnockout();
}

// ---------- Result projection ----------

interface Row {
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
}

// resultFor returns the scoreline that currently applies to a fixture: the real
// result if played, the player's prediction if one exists, else null (open).
function resultFor(f: Fixture): [number, number] | null {
  if (f.played) return [f.homeGoals, f.awayGoals];
  const p = predictions[f.id];
  if (p && Number.isFinite(p.homeGoals) && Number.isFinite(p.awayGoals)) {
    return [p.homeGoals, p.awayGoals];
  }
  return null;
}

function blankRow(team: string, group: string): Row {
  return { team, group, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, rank: 0 };
}

// betterRow ranks a above b by points, goal difference, goals for, then rating.
function betterRow(a: Row, b: Row): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.gd !== b.gd) return b.gd - a.gd;
  if (a.gf !== b.gf) return b.gf - a.gf;
  if (ratingOf(a.team) !== ratingOf(b.team)) return ratingOf(b.team) - ratingOf(a.team);
  return a.team.localeCompare(b.team);
}

// projectGroup builds the current table for a group from decided results.
function projectGroup(letter: string): { rows: Row[]; total: number; decided: number } {
  const rows = new Map<string, Row>();
  for (const t of state.teams) {
    if (t.group === letter) rows.set(t.code, blankRow(t.code, letter));
  }
  let total = 0;
  let decided = 0;
  for (const f of state.fixtures) {
    if (f.group !== letter) continue;
    total++;
    const r = resultFor(f);
    if (!r) continue;
    decided++;
    const [hg, ag] = r;
    const home = rows.get(f.home);
    const away = rows.get(f.away);
    if (!home || !away) continue;
    home.played++; away.played++;
    home.gf += hg; home.ga += ag; away.gf += ag; away.ga += hg;
    home.gd = home.gf - home.ga; away.gd = away.gf - away.ga;
    if (hg > ag) { home.won++; home.points += 3; away.lost++; }
    else if (ag > hg) { away.won++; away.points += 3; home.lost++; }
    else { home.drawn++; away.drawn++; home.points++; away.points++; }
  }
  const sorted = [...rows.values()].sort(betterRow);
  sorted.forEach((r, i) => (r.rank = i + 1));
  return { rows: sorted, total, decided };
}

// thirdPlaceRanking gathers each group's third-placed team and ranks them; the
// best eight qualify. Returns the set of qualifying team codes.
function thirdPlaceRanking(groupTables: Map<string, Row[]>): { ordered: Row[]; qualified: Set<string> } {
  const thirds: Row[] = [];
  for (const rows of groupTables.values()) {
    if (rows[2]) thirds.push(rows[2]);
  }
  thirds.sort(betterRow);
  const qualified = new Set(thirds.slice(0, 8).map((r) => r.team));
  return { ordered: thirds, qualified };
}

// ---------- Predict tab ----------

function renderPredict(): void {
  const grid = h("div", { class: "group-grid" });
  for (const letter of state.groups) {
    grid.append(predictCard(letter));
  }

  els.panels.predict.replaceChildren(
    h(
      "div",
      { class: "section-title" },
      h("h2", {}, "Predict the matches"),
      h("span", { class: "hint" }, "Locked scores are real results · type your score in the open matches"),
    ),
    scoringCard(),
    grid,
  );
}

function predictCard(letter: string): HTMLElement {
  const fixtures = state.fixtures.filter((f) => f.group === letter);
  const playedCount = fixtures.filter((f) => f.played).length;
  const card = h(
    "div",
    { class: "group-card predict-card" },
    h(
      "h3",
      {},
      `Group ${letter}`,
      h("span", { class: "played-tag" }, `${playedCount}/6 played`),
    ),
  );
  const list = h("div", { class: "fixture-list" });
  for (const f of fixtures) list.append(fixtureRow(f));
  card.append(list);
  return card;
}

function fixtureRow(f: Fixture): HTMLElement {
  if (f.played) {
    const homeWin = f.homeGoals > f.awayGoals;
    const awayWin = f.awayGoals > f.homeGoals;
    return h(
      "div",
      { class: "pmatch locked" },
      h("div", { class: `side home${homeWin ? " win" : ""}` }, teamLabel(f.home, "home")),
      h(
        "div",
        { class: "pscore" },
        h("div", { class: "pscore-main" }, String(f.homeGoals), h("span", { class: "dash" }, "–"), String(f.awayGoals)),
        h("div", { class: "pmeta" }, "FT"),
      ),
      h("div", { class: `side away${awayWin ? " win" : ""}` }, teamLabel(f.away, "away")),
    );
  }

  const pred = predictions[f.id];
  const homeInput = goalInput(f.id, "home", pred?.homeGoals);
  const awayInput = goalInput(f.id, "away", pred?.awayGoals);
  return h(
    "div",
    { class: "pmatch open", "data-id": f.id },
    h("div", { class: "side home" }, teamLabel(f.home, "home")),
    h(
      "div",
      { class: "pscore" },
      h("div", { class: "pscore-main" }, homeInput, h("span", { class: "dash" }, "–"), awayInput),
      h("div", { class: "pmeta" }, shortDate(f.date)),
    ),
    h("div", { class: "side away" }, teamLabel(f.away, "away")),
  );
}

function teamLabel(code: string, side: "home" | "away"): HTMLElement {
  const flag = h("span", { class: "flag", "aria-hidden": "true" }, flagOf(code));
  const name = h("span", { class: "name" }, nameOf(code));
  return side === "home" ? h("span", { class: "tl" }, name, flag) : h("span", { class: "tl" }, flag, name);
}

function goalInput(id: string, side: "home" | "away", value?: number): HTMLInputElement {
  const input = h("input", {
    class: "goal",
    type: "number",
    min: "0",
    max: "30",
    inputmode: "numeric",
    "data-id": id,
    "data-side": side,
    "aria-label": `${side} goals`,
    placeholder: "–",
  }) as HTMLInputElement;
  if (value != null && Number.isFinite(value)) input.value = String(value);
  input.addEventListener("input", onGoalInput);
  return input;
}

function onGoalInput(e: Event): void {
  const input = e.target as HTMLInputElement;
  const id = input.dataset.id!;
  const card = input.closest(".pmatch") as HTMLElement;
  const inputs = card.querySelectorAll<HTMLInputElement>("input.goal");
  const home = clampGoals(inputs[0].value);
  const away = clampGoals(inputs[1].value);
  if (home == null || away == null) {
    delete predictions[id]; // incomplete picks don't count
  } else {
    predictions[id] = { homeGoals: home, awayGoals: away };
  }
  savePredictions();
  oddsStale = true;
  refreshDerived();
}

function clampGoals(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(30, n);
}

function scoringCard(): HTMLElement {
  return h(
    "details",
    { class: "scoring" },
    h("summary", {}, "How the prediction game works"),
    h(
      "div",
      { class: "scoring-body" },
      h(
        "p",
        {},
        "The group results played so far are imported as the baseline and locked. " +
          "Predict the scoreline of every remaining match to project the final tables, " +
          "see who qualifies, and run your title odds.",
      ),
      h(
        "ul",
        {},
        h("li", {}, h("b", {}, "3 pts"), " — exact scoreline"),
        h("li", {}, h("b", {}, "1 pt"), " — correct result (win / draw / loss)"),
        h("li", {}, h("b", {}, "0 pts"), " — anything else"),
      ),
      h("p", { class: "scoring-note" }, "Your picks are scored against real results as new matches are played."),
    ),
  );
}

// ---------- Group tables tab ----------

function renderTables(): void {
  const groupTables = new Map<string, Row[]>();
  for (const letter of state.groups) groupTables.set(letter, projectGroup(letter).rows);
  const { ordered, qualified } = thirdPlaceRanking(groupTables);

  const grid = h("div", { class: "group-grid" });
  for (const letter of state.groups) {
    grid.append(tableCard(letter, projectGroup(letter), qualified));
  }

  els.panels.tables.replaceChildren(
    h(
      "div",
      { class: "section-title" },
      h("h2", {}, "Projected group tables"),
      h("span", { class: "hint" }, "Real results + your picks · top 2 advance, best 8 third-placed teams join them"),
    ),
    grid,
    thirdPlaceCard(ordered, qualified),
  );
}

function tableCard(letter: string, proj: { rows: Row[]; total: number; decided: number }, qualifiedThirds: Set<string>): HTMLElement {
  const card = h(
    "div",
    { class: "group-card" },
    h(
      "h3",
      {},
      `Group ${letter}`,
      h("span", { class: "played-tag" }, proj.decided < proj.total ? `${proj.decided}/${proj.total} decided` : "complete"),
    ),
  );
  const table = h("table", { class: "standings" });
  table.append(
    h(
      "tr",
      {},
      h("th", {}, "#"),
      h("th", { class: "team-col" }, "Team"),
      h("th", {}, "P"),
      h("th", {}, "W"),
      h("th", {}, "D"),
      h("th", {}, "L"),
      h("th", {}, "GD"),
      h("th", {}, "Pts"),
    ),
  );
  for (const r of proj.rows) {
    const isThirdQ = r.rank === 3 && qualifiedThirds.has(r.team);
    const rowClass = r.rank <= 2 ? "qualify" : r.rank === 3 ? (isThirdQ ? "third q" : "third") : "out";
    const teamTd = h(
      "td",
      { class: "team-col" },
      h("span", { class: "flag", "aria-hidden": "true" }, flagOf(r.team)),
      nameOf(r.team),
    );
    if (isThirdQ) teamTd.append(h("span", { class: "q-badge" }, "✓"));
    table.append(
      h(
        "tr",
        { class: rowClass },
        h("td", { class: "row-pos" }, String(r.rank)),
        teamTd,
        h("td", {}, String(r.played)),
        h("td", {}, String(r.won)),
        h("td", {}, String(r.drawn)),
        h("td", {}, String(r.lost)),
        h("td", {}, r.gd > 0 ? `+${r.gd}` : String(r.gd)),
        h("td", { class: "pts" }, String(r.points)),
      ),
    );
  }
  card.append(table);
  return card;
}

function thirdPlaceCard(ordered: Row[], qualified: Set<string>): HTMLElement {
  const list = h("div", { class: "third-list" });
  ordered.forEach((r, i) => {
    list.append(
      h(
        "div",
        { class: qualified.has(r.team) ? "third-item q" : "third-item" },
        h("span", { class: "pos" }, String(i + 1)),
        h("span", { class: "flag", "aria-hidden": "true" }, flagOf(r.team)),
        h("span", {}, `${nameOf(r.team)} (${r.group})`),
        h("span", { class: "pts" }, `${r.points} pts · ${r.gd > 0 ? "+" : ""}${r.gd}`),
      ),
    );
  });
  return h(
    "div",
    { class: "third-table" },
    h("h3", {}, "Third-placed race — best 8 advance (provisional until all groups decided)"),
    list,
  );
}

// ---------- Knockout bracket tab ----------

// Standard single-elimination seeding for 32 teams: each of the 32 bracket
// slots maps to a seed number (1 = strongest) so top seeds only meet late.
// Mirrors the backend's bracketOrder so the predicted bracket matches the odds
// engine's seeding.
const bracketOrder = [
  1, 32, 16, 17, 8, 25, 9, 24, 4, 29, 13, 20, 5, 28, 12, 21,
  2, 31, 15, 18, 7, 26, 10, 23, 3, 30, 14, 19, 6, 27, 11, 22,
];

const koRoundNames = ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"];

interface KoMatch {
  key: string; // stable slot id used to store the player's winner pick
  home?: string; // team code, or undefined while an upstream tie is unsettled
  away?: string;
  winner?: string;
}

interface KoBracket {
  slots: string[]; // 32 qualifier codes in bracket-slot order
  rounds: KoMatch[][]; // Round of 32 → … → Final
  thirdPlace: KoMatch; // between the two beaten semi-finalists
  champion?: string;
  runnerUp?: string;
  third?: string;
}

const koKey = (round: number, index: number): string => `${round}-${index}`;

// seedBracket projects every group from the current results, and once all
// twelve are fully decided returns the 32 qualifiers placed into bracket slots
// (12 winners, 12 runners-up, the 8 best third-placed teams), seeded by tier
// then record. Returns null while any group still has an undecided match.
function seedBracket(): string[] | null {
  const winners: Row[] = [];
  const runnersUp: Row[] = [];
  const thirds: Row[] = [];
  for (const letter of state.groups) {
    const proj = projectGroup(letter);
    if (proj.decided < proj.total) return null;
    winners.push(proj.rows[0]);
    runnersUp.push(proj.rows[1]);
    thirds.push(proj.rows[2]);
  }
  winners.sort(betterRow);
  runnersUp.sort(betterRow);
  const bestThirds = [...thirds].sort(betterRow).slice(0, 8);
  // Seeds 1..32 by tier (winners, then runners-up, then thirds), each tier
  // ranked on record, exactly as the backend orders them.
  const seeds = [...winners, ...runnersUp, ...bestThirds];
  return bracketOrder.map((seedNo) => seeds[seedNo - 1].team);
}

// buildBracket turns the seeded slots and the saved winner picks into the full
// bracket. Each round's teams are the previous round's advancers; a stored pick
// only advances a team while it still names one of that tie's two participants.
function buildBracket(): KoBracket | null {
  const slots = seedBracket();
  if (!slots) return null;

  const rounds: KoMatch[][] = [];
  let teams: (string | undefined)[] = slots;
  for (let r = 0; r < koRoundNames.length; r++) {
    const matches: KoMatch[] = [];
    const advancers: (string | undefined)[] = [];
    for (let i = 0; i < teams.length / 2; i++) {
      const home = teams[2 * i];
      const away = teams[2 * i + 1];
      const key = koKey(r, i);
      const pick = knockoutPicks[key];
      const winner = pick === home || pick === away ? pick : undefined;
      matches.push({ key, home, away, winner });
      advancers.push(winner);
    }
    rounds.push(matches);
    teams = advancers;
  }

  const final = rounds[rounds.length - 1][0];
  const runnerUp = loserOf(final);

  // Third-place play-off between the two beaten semi-finalists.
  const semis = rounds[rounds.length - 2];
  const sfLosers = semis.map(loserOf);
  const tpPick = knockoutPicks["3p"];
  const tpWinner = tpPick === sfLosers[0] || tpPick === sfLosers[1] ? tpPick : undefined;
  const thirdPlace: KoMatch = { key: "3p", home: sfLosers[0], away: sfLosers[1], winner: tpWinner };

  return {
    slots,
    rounds,
    thirdPlace,
    champion: final.winner,
    runnerUp,
    third: tpWinner,
  };
}

// loserOf returns the beaten team of a settled match, or undefined if the tie
// is not decided yet.
function loserOf(m: KoMatch): string | undefined {
  if (!m.home || !m.away || !m.winner) return undefined;
  return m.winner === m.home ? m.away : m.home;
}

function pickWinner(key: string, code: string): void {
  if (knockoutPicks[key] === code) return;
  knockoutPicks[key] = code;
  saveKnockout();
  renderKnockout();
}

function renderKnockout(): void {
  const bracket = buildBracket();
  if (!bracket) {
    renderKnockoutLocked();
    return;
  }
  syncChampionFromBracket(bracket.champion);

  const decidedTies = countDecided(bracket);
  const children: (Node | string)[] = [
    h(
      "div",
      { class: "section-title" },
      h("h2", {}, "Knockout bracket"),
      h("span", { class: "hint" }, "Seeded from your final group tables · tap a team to send them through"),
    ),
    h(
      "div",
      { class: "ko-controls" },
      h("span", { class: "ko-progress" }, `${decidedTies}/31 ties picked`),
      koControlBtn("✨ Auto-fill", autofillBracket),
      koControlBtn("↺ Clear bracket", clearBracket),
    ),
  ];

  if (bracket.champion) {
    children.push(koPodium(bracket.champion, bracket.runnerUp!, bracket.third));
  }

  const rail = h("div", { class: "bracket", tabindex: "0", "aria-label": "Knockout bracket" });
  bracket.rounds.forEach((matches, r) => {
    const round = h("div", { class: "round" }, h("div", { class: "round-title" }, koRoundNames[r]));
    for (const m of matches) round.append(koMatchEl(m, r === bracket.rounds.length - 1));
    rail.append(round);
  });
  children.push(rail);

  children.push(
    h(
      "div",
      { class: "third-place-card" },
      h("div", { class: "round-title" }, "Third-place play-off"),
      koMatchEl(bracket.thirdPlace, false),
    ),
  );

  els.panels.knockout.replaceChildren(...children);
}

// countDecided counts the settled ties (31 main bracket + the play-off = 32).
function countDecided(b: KoBracket): number {
  let n = b.thirdPlace.winner ? 1 : 0;
  for (const round of b.rounds) for (const m of round) if (m.winner) n++;
  return n;
}

function koMatchEl(m: KoMatch, isFinal: boolean): HTMLElement {
  return h(
    "div",
    { class: isFinal ? "match final-match" : "match" },
    koTeamRow(m, m.home),
    koTeamRow(m, m.away),
  );
}

function koTeamRow(m: KoMatch, code?: string): HTMLElement {
  if (!code) {
    return h("div", { class: "match-row placeholder" }, h("span", { class: "name" }, "—"));
  }
  const isWinner = m.winner === code;
  const cls = "match-row pick" + (isWinner ? " winner" : "");
  const row = h(
    "button",
    { class: cls, type: "button", "aria-pressed": String(isWinner) },
    h("span", { class: "flag", "aria-hidden": "true" }, flagOf(code)),
    h("span", { class: "name" }, nameOf(code)),
  );
  row.addEventListener("click", () => pickWinner(m.key, code));
  return row;
}

function koControlBtn(label: string, onClick: () => void): HTMLButtonElement {
  const btn = h("button", { class: "btn", type: "button" }, label) as HTMLButtonElement;
  btn.addEventListener("click", onClick);
  return btn;
}

// koPodium shows the medal trio once the final is decided, celebrating a freshly
// crowned champion with a confetti burst.
function koPodium(champion: string, runnerUp: string, third?: string): HTMLElement {
  const medal = (place: string, label: string, code: string) =>
    h(
      "div",
      { class: `medal ${place}` },
      h("span", { class: "medal-flag", "aria-hidden": "true" }, flagOf(code)),
      h("div", {}, h("div", { class: "medal-label" }, label), h("div", { class: "medal-name" }, nameOf(code))),
    );
  const podium = h("div", { class: "podium celebrate" }, medal("gold", "🏆 Champion", champion));
  podium.append(medal("silver", "Runner-up", runnerUp));
  if (third) podium.append(medal("bronze", "Third place", third));
  return podium;
}

function renderKnockoutLocked(): void {
  const remaining = openFixtures.filter((f) => !predictions[f.id]).length;
  els.panels.knockout.replaceChildren(
    h(
      "div",
      { class: "placeholder" },
      h("div", { class: "big" }, "🔒"),
      h("p", {}, "Fill in every group match to unlock the knockout bracket and pick your way to the trophy."),
      h("p", { class: "ko-remaining" }, `${remaining} group ${remaining === 1 ? "match" : "matches"} still to predict.`),
      h(
        "div",
        { class: "ko-controls" },
        koControlBtn("✨ Auto-pick remaining", autopickRemaining),
        koControlBtn("Go to Predict", () => activateTab("predict")),
      ),
    ),
  );
}

// syncChampionFromBracket makes a completed bracket the source of truth for the
// champion pick used by the summary strip and the odds callout, firing confetti
// the first time a new winner is crowned.
function syncChampionFromBracket(champion?: string): void {
  if (!champion) {
    lastChampionShown = "";
    return;
  }
  if (champion !== championPick) {
    championPick = champion;
    localStorage.setItem(CHAMP_KEY, championPick);
    renderSummary();
    if (lastOdds) renderOdds();
  }
  if (champion !== lastChampionShown) {
    lastChampionShown = champion;
    confettiBurst();
    setStatus(`🏆 ${flagOf(champion)} ${nameOf(champion)} are your World Cup champions!`);
  }
}

function autofillBracket(): void {
  // Walk the rounds, settling every tie whose two teams are known in favour of
  // the higher-rated side, so later rounds fill once their feeders are decided.
  for (let pass = 0; pass < koRoundNames.length; pass++) {
    const b = buildBracket();
    if (!b) return;
    for (const round of b.rounds) {
      for (const m of round) {
        if (m.home && m.away && !m.winner) {
          knockoutPicks[m.key] = ratingOf(m.home) >= ratingOf(m.away) ? m.home : m.away;
        }
      }
    }
    const tp = b.thirdPlace;
    if (tp.home && tp.away && !tp.winner) {
      knockoutPicks["3p"] = ratingOf(tp.home) >= ratingOf(tp.away) ? tp.home : tp.away;
    }
  }
  saveKnockout();
  renderKnockout();
  setStatus("Filled the bracket from the team ratings — tap any tie to change the winner.");
}

function clearBracket(): void {
  knockoutPicks = {};
  saveKnockout();
  lastChampionShown = "";
  renderKnockout();
  setStatus("Cleared your knockout picks.");
}

function autopickRemaining(): void {
  for (const f of openFixtures) {
    if (predictions[f.id]) continue;
    const [hg, ag] = autoScore(f.home, f.away);
    predictions[f.id] = { homeGoals: hg, awayGoals: ag };
  }
  savePredictions();
  oddsStale = true;
  renderPredict();
  refreshDerived();
  renderKnockout();
  setStatus("Filled the remaining group matches — the knockout bracket is unlocked.");
}

// confettiBurst sprays a quick shower of confetti from the top of the viewport.
function confettiBurst(): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = h("div", { class: "confetti-layer", "aria-hidden": "true" });
  const colors = ["#2ee6a6", "#ffce4d", "#ff5d8f", "#5aa7ff"];
  for (let i = 0; i < 80; i++) {
    const piece = h("span", { class: "confetti" });
    const s = piece.style;
    s.left = `${Math.random() * 100}vw`;
    s.top = `${-10 - Math.random() * 20}vh`;
    s.background = colors[i % colors.length];
    s.setProperty("--dx", `${(Math.random() - 0.5) * 60}vw`);
    s.setProperty("--dy", `${10 + Math.random() * 20}vh`);
    s.setProperty("--rot", `${360 + Math.random() * 720}deg`);
    s.setProperty("--dur", `${1500 + Math.random() * 1400}ms`);
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 3200);
}

// ---------- Title odds tab ----------

function renderOddsControls(): HTMLElement {
  const runs = h(
    "select",
    { id: "runs-select" },
    h("option", { value: "2000" }, "2,000"),
    h("option", { value: "10000", selected: true }, "10,000"),
    h("option", { value: "25000" }, "25,000"),
    h("option", { value: "50000" }, "50,000"),
  );
  const useMine = h("input", { type: "checkbox", id: "use-mine", checked: true }) as HTMLInputElement;
  const runBtn = h("button", { class: "btn btn-primary", type: "button" }, "▶ Run odds");
  runBtn.addEventListener("click", () => runOddsNow());

  return h(
    "div",
    { class: "odds-controls" },
    h("label", { class: "runs-field" }, h("span", {}, "Simulations"), runs),
    h("label", { class: "use-mine-field" }, useMine, h("span", {}, "Include my predictions")),
    runBtn,
  );
}

async function runOddsNow(): Promise<void> {
  const runsSel = $<HTMLSelectElement>("#runs-select");
  const useMine = $<HTMLInputElement>("#use-mine");
  const runs = Number(runsSel?.value ?? 10000);
  const preds = useMine?.checked ? predictions : {};
  setStatus("Running Monte Carlo simulations…");
  try {
    lastOdds = await runOdds(preds, runs);
    oddsStale = false;
    renderOdds();
    const top = lastOdds.odds[0];
    setStatus(top ? `Favourite: ${flagOf(top.team)} ${nameOf(top.team)} at ${pct(top.champion)} over ${lastOdds.runs.toLocaleString()} runs.` : "Done.");
  } catch (err) {
    console.error(err);
    setStatus("Odds run failed — is the server running?", "error");
  }
}

function renderOdds(): void {
  const children: (Node | string)[] = [
    h(
      "div",
      { class: "section-title" },
      h("h2", {}, "Title odds"),
      h("span", { class: "hint" }, "Monte Carlo conditioned on real results so far + your predictions"),
    ),
    renderOddsControls(),
  ];

  if (!lastOdds) {
    children.push(
      h(
        "div",
        { class: "placeholder" },
        h("div", { class: "big" }, "📊"),
        h("p", {}, "Run the simulations to see each team's chance to advance and lift the trophy in your scenario."),
      ),
    );
    els.panels.odds.replaceChildren(...children);
    return;
  }

  if (oddsStale) {
    children.push(h("div", { class: "stale-note" }, "Your predictions changed — run again to refresh the odds."));
  }

  if (championPick) {
    const mine = lastOdds.odds.find((o) => o.team === championPick);
    if (mine) {
      children.push(
        h(
          "div",
          { class: "champ-callout" },
          h("span", { class: "flag", "aria-hidden": "true" }, flagOf(championPick)),
          h("div", {}, h("div", { class: "champ-callout-label" }, "Your champion pick"),
            h("div", { class: "champ-callout-name" }, `${nameOf(championPick)} — ${pct(mine.champion)} to win`)),
        ),
      );
    }
  }

  const max = lastOdds.odds[0]?.champion || 1;
  const list = h("div", { class: "odds-list" });
  lastOdds.odds.forEach((o, i) => {
    const width = o.champion > 0 ? Math.max(2, (o.champion / max) * 100) : 0;
    const row = h(
      "div",
      { class: o.team === championPick ? "odds-row mine" : "odds-row" },
      h("span", { class: "rank" }, String(i + 1)),
      h(
        "span",
        { class: "who" },
        h("span", { class: "flag", "aria-hidden": "true" }, flagOf(o.team)),
        h("span", {}, nameOf(o.team), " ", h("span", { class: "sub" }, `· adv ${pct(o.advance)} · final ${pct(o.final)}`)),
      ),
      h("span", { class: "bar-wrap" }, h("span", { class: "bar", style: `--w:${width}%` })),
      h("span", { class: "pct" }, pct(o.champion)),
    );
    list.append(row);
  });
  children.push(list);
  els.panels.odds.replaceChildren(...children);
}

// ---------- Summary / champion picker ----------

function renderSummary(): void {
  const predicted = openFixtures.filter((f) => predictions[f.id]).length;
  const total = openFixtures.length;
  const ratio = total ? predicted / total : 0;

  const champSelect = h("select", { id: "champion-select", "aria-label": "Pick your champion" }) as HTMLSelectElement;
  champSelect.append(h("option", { value: "" }, "— pick a champion —"));
  for (const letter of state.groups) {
    const og = h("optgroup", { label: `Group ${letter}` });
    for (const t of state.teams.filter((x) => x.group === letter)) {
      const opt = h("option", { value: t.code }, `${t.flag} ${t.name}`) as HTMLOptionElement;
      if (t.code === championPick) opt.selected = true;
      og.append(opt);
    }
    champSelect.append(og);
  }
  champSelect.addEventListener("change", () => {
    championPick = champSelect.value;
    localStorage.setItem(CHAMP_KEY, championPick);
    if (lastOdds) renderOdds();
  });

  els.summary.replaceChildren(
    h(
      "div",
      { class: "summary-inner" },
      h(
        "div",
        { class: "stat-chip" },
        h("span", { class: "stat-num" }, `${predicted}`),
        h("span", { class: "stat-label" }, `/ ${total} matches predicted`),
        h("span", { class: "mini-bar" }, h("span", { class: "mini-fill", style: `--w:${ratio * 100}%` })),
      ),
      h("label", { class: "champ-chip" }, h("span", { class: "champ-label" }, "🏆 Your champion"), champSelect),
    ),
  );
}

// refreshDerived updates everything that depends on the current predictions
// without disturbing the prediction inputs the player is typing into.
function refreshDerived(): void {
  renderSummary();
  if (!els.panels.tables.hidden) renderTables();
  if (!els.panels.knockout.hidden) renderKnockout();
  if (lastOdds && oddsStale && !els.panels.odds.hidden) renderOdds();
}

// ---------- Actions ----------

// autoScore returns a plausible scoreline from the two ratings (the same
// expected-goals model the server uses), rounded to whole goals.
function autoScore(home: string, away: string): [number, number] {
  const diff = ratingOf(home) - ratingOf(away);
  const clamp = (l: number) => Math.min(5.5, Math.max(0.18, l));
  const la = clamp(1.32 * Math.exp(0.003 * diff));
  const lb = clamp(1.32 * Math.exp(-0.003 * diff));
  return [Math.round(la), Math.round(lb)];
}

function autopickAll(): void {
  for (const f of openFixtures) {
    const [hg, ag] = autoScore(f.home, f.away);
    predictions[f.id] = { homeGoals: hg, awayGoals: ag };
  }
  savePredictions();
  oddsStale = true;
  renderPredict();
  refreshDerived();
  setStatus("Filled every open match from the team ratings — tweak any you disagree with.");
}

function clearPicks(): void {
  predictions = {};
  savePredictions();
  oddsStale = true;
  renderPredict();
  refreshDerived();
  setStatus("Cleared your predictions.");
}

// ---------- Misc ----------

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------- Boot ----------

async function init(): Promise<void> {
  setupTabs();
  els.autopick.addEventListener("click", autopickAll);
  els.clear.addEventListener("click", clearPicks);

  try {
    state = await getState();
    for (const t of state.teams) teamMap.set(t.code, t);
    openFixtures = state.fixtures.filter((f) => !f.played);

    // Drop any saved picks that refer to fixtures no longer open (e.g. a match
    // that has since been played and imported into the baseline).
    const openIds = new Set(openFixtures.map((f) => f.id));
    for (const id of Object.keys(predictions)) if (!openIds.has(id)) delete predictions[id];
    savePredictions();

    els.asOf.textContent = state.asOf ? `· results imported ${shortDate(state.asOf)}` : "";

    renderPredict();
    renderSummary();
    renderOdds();
    setStatus(`${openFixtures.length} matches still to play — predict them, then check your title odds.`);
  } catch (err) {
    console.error(err);
    setStatus("Couldn't load the tournament from the API. Is the Go server running?", "error");
  }
}

init();
