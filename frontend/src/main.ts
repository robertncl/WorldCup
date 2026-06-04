import {
  getTeams,
  simulate,
  odds,
  type Team,
  type Standing,
  type Match,
  type GroupResult,
  type KnockoutRound,
  type TournamentResult,
  type OddsResult,
} from "./api";

// ---------- State ----------

const teamMap = new Map<string, Team>();
let groupLetters: string[] = [];

// ---------- Tiny DOM helpers ----------

type Attrs = Record<string, string | number | boolean | undefined>;

function h(tag: string, attrs: Attrs = {}, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "html") node.innerHTML = String(value);
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
  seed: $<HTMLInputElement>("#seed-input"),
  simulate: $<HTMLButtonElement>("#simulate-btn"),
  runs: $<HTMLSelectElement>("#runs-select"),
  oddsBtn: $<HTMLButtonElement>("#odds-btn"),
  status: $<HTMLDivElement>("#status"),
  panels: {
    groups: $<HTMLElement>("#panel-groups"),
    knockout: $<HTMLElement>("#panel-knockout"),
    odds: $<HTMLElement>("#panel-odds"),
  },
};

// ---------- Formatting helpers ----------

const nameOf = (code: string): string => teamMap.get(code)?.name ?? code;
const flagOf = (code: string): string => teamMap.get(code)?.flag ?? "🏳️";

function pct(value: number): string {
  if (value <= 0) return "0%";
  if (value < 0.001) return "<0.1%";
  return `${(value * 100).toFixed(1)}%`;
}

function setStatus(message: string, kind: "info" | "error" = "info"): void {
  els.status.innerHTML = "";
  els.status.append(message instanceof Node ? message : document.createTextNode(message));
  els.status.dataset.kind = kind;
  els.status.classList.toggle("show", message !== "");
}

function setBusy(message: string): void {
  els.status.innerHTML = `<span class="spin"></span>${message}`;
  els.status.dataset.kind = "info";
  els.status.classList.add("show");
}

// ---------- Tabs ----------

function setupTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tab")];
  for (const tab of tabs) {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab ?? "groups"));
  }
}

function activateTab(name: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  }
  for (const [key, panel] of Object.entries(els.panels)) {
    panel.hidden = key !== name;
  }
}

// ---------- Team chip ----------

function teamCell(code: string): HTMLElement {
  return h(
    "span",
    {},
    h("span", { class: "flag", "aria-hidden": "true" }, flagOf(code)),
    h("span", { class: "name" }, nameOf(code)),
  );
}

// ---------- Groups ----------

function renderGroupPreview(teams: Team[]): void {
  const grid = h("div", { class: "group-grid" });
  for (const letter of groupLetters) {
    const members = teams
      .filter((t) => t.group === letter)
      .sort((a, b) => b.rating - a.rating);
    const card = h("div", { class: "group-card" }, h("h3", {}, `Group ${letter}`));
    const table = h("table", { class: "standings" });
    table.append(
      h(
        "tr",
        {},
        h("th", { class: "team-col" }, "Team"),
        h("th", {}, "Elo"),
      ),
    );
    for (const t of members) {
      table.append(
        h(
          "tr",
          {},
          h("td", { class: "team-col" }, teamCell(t.code), t.host ? h("span", { class: "q-badge" }, "HOST") : ""),
          h("td", {}, String(Math.round(t.rating))),
        ),
      );
    }
    card.append(table);
    grid.append(card);
  }

  els.panels.groups.replaceChildren(
    h(
      "div",
      { class: "section-title" },
      "Group draw",
      h("span", { class: "hint" }, "12 groups of 4 · press Simulate to play the matches"),
    ),
    grid,
  );
}

function renderGroups(result: TournamentResult): void {
  const qualifiedThirds = new Set(
    result.thirdPlaceTable.filter((s) => s.qualified).map((s) => s.team),
  );

  const grid = h("div", { class: "group-grid" });
  for (const group of result.groups) {
    grid.append(groupCard(group, qualifiedThirds));
  }

  els.panels.groups.replaceChildren(
    h(
      "div",
      { class: "section-title" },
      "Group stage",
      h("span", { class: "hint" }, "Top 2 advance · best 8 third-placed teams also qualify"),
    ),
    grid,
    thirdPlaceTable(result.thirdPlaceTable),
  );
}

function groupCard(group: GroupResult, qualifiedThirds: Set<string>): HTMLElement {
  const card = h("div", { class: "group-card" }, h("h3", {}, `Group ${group.group}`));

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

  for (const s of group.standings) {
    const isThirdQualified = s.rank === 3 && qualifiedThirds.has(s.team);
    const rowClass =
      s.rank <= 2 ? "qualify" : s.rank === 3 ? (isThirdQualified ? "third q" : "third") : "out";
    const teamTd = h("td", { class: "team-col" }, teamCell(s.team));
    if (isThirdQualified) teamTd.append(h("span", { class: "q-badge" }, "✓"));

    table.append(
      h(
        "tr",
        { class: rowClass },
        h("td", { class: "row-pos" }, String(s.rank)),
        teamTd,
        h("td", {}, String(s.played)),
        h("td", {}, String(s.won)),
        h("td", {}, String(s.drawn)),
        h("td", {}, String(s.lost)),
        h("td", {}, s.gd > 0 ? `+${s.gd}` : String(s.gd)),
        h("td", { class: "pts" }, String(s.points)),
      ),
    );
  }
  card.append(table);
  card.append(fixturesDetails(group.matches));
  return card;
}

function fixturesDetails(matches: Match[]): HTMLElement {
  const details = h("details", { class: "fixtures" }, h("summary", {}, "Fixtures"));
  for (const m of matches) {
    details.append(
      h(
        "div",
        { class: "fixture" },
        h("span", {}, `${flagOf(m.home)} ${nameOf(m.home)}`),
        h("span", { class: "score" }, `${m.homeGoals}–${m.awayGoals}`),
        h("span", {}, `${nameOf(m.away)} ${flagOf(m.away)}`),
      ),
    );
  }
  return details;
}

function thirdPlaceTable(table: Standing[]): HTMLElement {
  const list = h("div", { class: "third-list" });
  table.forEach((s, i) => {
    list.append(
      h(
        "div",
        { class: s.qualified ? "third-item q" : "third-item" },
        h("span", { class: "pos" }, String(i + 1)),
        h("span", { class: "flag", "aria-hidden": "true" }, flagOf(s.team)),
        h("span", {}, `${nameOf(s.team)} (${s.group})`),
        h("span", { class: "pts" }, `${s.points} pts · ${s.gd > 0 ? "+" : ""}${s.gd}`),
      ),
    );
  });
  return h(
    "div",
    { class: "third-table" },
    h("h3", {}, "Third-placed ranking — best 8 advance"),
    list,
  );
}

// ---------- Knockout ----------

const BRACKET_ROUNDS = ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"];

function renderKnockout(result: TournamentResult): void {
  const byName = new Map(result.knockout.map((r) => [r.name, r]));

  const podium = h(
    "div",
    { class: "podium" },
    medalCard("gold", "🥇 Champions", result.champion),
    medalCard("silver", "🥈 Runners-up", result.runnerUp),
    medalCard("bronze", "🥉 Third place", result.third),
  );

  const bracket = h("div", { class: "bracket" });
  for (const roundName of BRACKET_ROUNDS) {
    const round = byName.get(roundName);
    if (!round) continue;
    bracket.append(roundColumn(round, result.champion));
  }

  const children: (Node | string)[] = [
    h(
      "div",
      { class: "section-title" },
      "Knockout bracket",
      h("span", { class: "hint" }, "32 teams · single elimination"),
    ),
    podium,
    bracket,
  ];

  const thirdPlace = byName.get("Third-place play-off");
  if (thirdPlace) {
    children.push(
      h(
        "div",
        { class: "round third-place-card" },
        h("div", { class: "round-title" }, "Third-place play-off"),
        matchCard(thirdPlace.matches[0], false),
      ),
    );
  }

  els.panels.knockout.replaceChildren(...children);
}

function medalCard(kind: string, label: string, code: string): HTMLElement {
  return h(
    "div",
    { class: `medal ${kind}` },
    h("span", { class: "medal-flag", "aria-hidden": "true" }, flagOf(code)),
    h(
      "div",
      {},
      h("div", { class: "medal-label" }, label),
      h("div", { class: "medal-name" }, nameOf(code)),
    ),
  );
}

function roundColumn(round: KnockoutRound, champion: string): HTMLElement {
  const isFinal = round.name === "Final";
  const column = h("div", { class: "round" }, h("div", { class: "round-title" }, round.name));
  for (const match of round.matches) {
    column.append(matchCard(match, isFinal, isFinal ? champion : undefined));
  }
  return column;
}

function matchCard(match: Match, isFinal: boolean, champion?: string): HTMLElement {
  const card = h("div", { class: isFinal ? "match final-match" : "match" });
  card.append(matchRow(match, match.home, match.homeGoals, match.homePens, champion));
  card.append(matchRow(match, match.away, match.awayGoals, match.awayPens, champion));
  return card;
}

function matchRow(
  match: Match,
  code: string,
  goals: number,
  pens: number | undefined,
  champion?: string,
): HTMLElement {
  const isWinner = match.winner === code;
  const row = h(
    "div",
    { class: isWinner ? "match-row winner" : "match-row" },
    h("span", { class: "flag", "aria-hidden": "true" }, flagOf(code)),
    h("span", { class: "name" }, champion === code ? `${nameOf(code)} 🏆` : nameOf(code)),
  );
  const score = h("span", { class: "score" }, String(goals));
  if (match.shootout && pens != null) {
    score.append(h("span", { class: "pens" }, `(${pens})`));
  }
  row.append(score);
  return row;
}

// ---------- Odds ----------

function renderOdds(result: OddsResult): void {
  const max = result.odds[0]?.champion || 1;

  const list = h("div", { class: "odds-list" });
  result.odds.forEach((o, i) => {
    const width = o.champion > 0 ? Math.max(2, (o.champion / max) * 100) : 0;
    list.append(
      h(
        "div",
        { class: "odds-row" },
        h("span", { class: "rank" }, String(i + 1)),
        h(
          "span",
          { class: "who" },
          h("span", { class: "flag", "aria-hidden": "true" }, flagOf(o.team)),
          h(
            "span",
            {},
            nameOf(o.team),
            " ",
            h("span", { class: "sub" }, `· final ${pct(o.final)} · SF ${pct(o.semiFinal)}`),
          ),
        ),
        h("span", { class: "bar-wrap" }, h("span", { class: "bar", style: `--w:${width}%` })),
        h("span", { class: "pct" }, pct(o.champion)),
      ),
    );
  });

  els.panels.odds.replaceChildren(
    h(
      "div",
      { class: "odds-head" },
      h(
        "div",
        { class: "section-title" },
        "Championship odds",
        h("span", { class: "hint" }, `${result.runs.toLocaleString()} simulations`),
      ),
      h("div", { class: "odds-legend" }, "Bar = win probability · final/SF = reached that round"),
    ),
    list,
  );
}

// ---------- Actions ----------

async function runSimulation(): Promise<void> {
  const raw = els.seed.value.trim();
  const seed = raw === "" ? undefined : Number(raw);

  els.simulate.disabled = true;
  setBusy("Simulating the tournament…");
  try {
    const result = await simulate(seed);
    els.seed.value = String(result.seed);
    renderGroups(result);
    renderKnockout(result);
    activateTab("knockout");
    setStatus(
      `${flagOf(result.champion)} ${nameOf(result.champion)} win the World Cup! ` +
        `(seed ${result.seed} — edit the seed box and Simulate again to reproduce)`,
    );
  } catch (err) {
    console.error(err);
    setStatus("Simulation failed — is the server running?", "error");
  } finally {
    els.simulate.disabled = false;
  }
}

async function runOdds(): Promise<void> {
  const runs = Number(els.runs.value);
  els.oddsBtn.disabled = true;
  setBusy(`Running ${runs.toLocaleString()} simulations…`);
  try {
    const result = await odds(runs);
    renderOdds(result);
    activateTab("odds");
    const top = result.odds[0];
    setStatus(
      top
        ? `Favourite: ${flagOf(top.team)} ${nameOf(top.team)} at ${pct(top.champion)} over ${result.runs.toLocaleString()} runs.`
        : "Done.",
    );
  } catch (err) {
    console.error(err);
    setStatus("Odds run failed — is the server running?", "error");
  } finally {
    els.oddsBtn.disabled = false;
  }
}

// ---------- Boot ----------

function placeholder(panel: HTMLElement, emoji: string, text: string): void {
  panel.replaceChildren(
    h("div", { class: "placeholder" }, h("div", { class: "big" }, emoji), h("p", {}, text)),
  );
}

async function init(): Promise<void> {
  setupTabs();
  els.simulate.addEventListener("click", runSimulation);
  els.oddsBtn.addEventListener("click", runOdds);

  placeholder(els.panels.knockout, "🏆", "Run a simulation to see the bracket.");
  placeholder(els.panels.odds, "📊", "Run the Monte Carlo simulations to see championship odds.");

  try {
    const data = await getTeams();
    groupLetters = data.groups;
    for (const team of data.teams) teamMap.set(team.code, team);
    renderGroupPreview(data.teams);
    // Kick off one tournament so the page opens on a full result.
    await runSimulation();
  } catch (err) {
    console.error(err);
    placeholder(els.panels.groups, "⚠️", "Couldn't reach the API. Is the Go server running?");
    setStatus("Couldn't load teams from the API.", "error");
  }
}

init();
