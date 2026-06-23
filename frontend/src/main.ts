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
let predictions: Record<string, Prediction> = loadPredictions();
let championPick = localStorage.getItem(CHAMP_KEY) ?? "";

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
