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

// ---------- Celebration / motion ----------

const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Timers for the staged knockout reveal — cleared whenever we re-render so a
// fresh simulation never overlaps with a reveal still playing from the last one.
let revealTimers: number[] = [];
function clearRevealTimers(): void {
  for (const id of revealTimers) clearTimeout(id);
  revealTimers = [];
}
const later = (fn: () => void, ms: number): void => {
  revealTimers.push(window.setTimeout(fn, ms));
};

const CONFETTI_COLORS = ["#2ee6a6", "#ffce4d", "#ff5d8f", "#5aa7ff", "#41d8c4", "#ffffff"];

let confettiLayer: HTMLElement | null = null;
function celebrationLayer(): HTMLElement {
  if (!confettiLayer) {
    confettiLayer = h("div", { class: "confetti-layer", "aria-hidden": "true" });
    document.body.append(confettiLayer);
  }
  return confettiLayer;
}

// Fire a burst of confetti pieces from a viewport-relative origin (0–1 on each
// axis). Each piece is a short-lived DOM node that removes itself when done.
function confettiBurst(count: number, originX: number, originY: number): void {
  if (prefersReducedMotion()) return;
  const layer = celebrationLayer();
  const ox = originX * window.innerWidth;
  const oy = originY * window.innerHeight;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti";
    const angle = Math.random() * Math.PI * 2;
    const velocity = 90 + Math.random() * 240;
    const dx = Math.cos(angle) * velocity;
    const dy = Math.sin(angle) * velocity - (130 + Math.random() * 150);
    const size = 6 + Math.random() * 7;
    piece.style.left = `${ox}px`;
    piece.style.top = `${oy}px`;
    piece.style.inlineSize = `${size}px`;
    piece.style.blockSize = `${size * (0.5 + Math.random())}px`;
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.setProperty("--dx", `${dx}px`);
    piece.style.setProperty("--dy", `${dy}px`);
    piece.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    piece.style.setProperty("--dur", `${1200 + Math.random() * 1000}ms`);
    if (Math.random() > 0.5) piece.style.borderRadius = "50%";
    piece.addEventListener("animationend", () => piece.remove(), { once: true });
    layer.append(piece);
  }
}

// A localized burst centred over an element (e.g. a freshly revealed round).
function burstOver(el: HTMLElement, count: number): void {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0) return;
  const x = (rect.left + rect.width / 2) / window.innerWidth;
  const y = Math.max(0.08, rect.top / window.innerHeight + 0.04);
  confettiBurst(count, x, y);
}

// Apply a staggered entrance to a set of cards by indexing a CSS custom prop.
function stagger(nodes: HTMLElement[]): void {
  nodes.forEach((node, i) => {
    node.classList.add("stagger");
    node.style.setProperty("--i", String(i));
  });
}

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
  const cards: HTMLElement[] = [];
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
    cards.push(card);
    grid.append(card);
  }
  stagger(cards);

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
  const cards: HTMLElement[] = [];
  for (const group of result.groups) {
    const card = groupCard(group, qualifiedThirds);
    cards.push(card);
    grid.append(card);
  }
  stagger(cards);

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
  clearRevealTimers();
  const byName = new Map(result.knockout.map((r) => [r.name, r]));

  // The podium reveals last so the champion stays a surprise until the bracket
  // has played through every round.
  const podium = h(
    "div",
    { class: "podium reveal-pending" },
    medalCard("gold", "🥇 Champions", result.champion),
    medalCard("silver", "🥈 Runners-up", result.runnerUp),
    medalCard("bronze", "🥉 Third place", result.third),
  );

  const bracket = h("div", { class: "bracket" });
  const columns: HTMLElement[] = [];
  for (const roundName of BRACKET_ROUNDS) {
    const round = byName.get(roundName);
    if (!round) continue;
    const column = roundColumn(round, result.champion);
    column.classList.add("reveal-pending");
    columns.push(column);
    bracket.append(column);
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
  playKnockoutReveal(columns, podium, result.champion);
}

// Reveal the bracket one round at a time — each newly shown round is a set of
// teams that just advanced, so we pop a small confetti burst over it. When the
// final round lands, the podium drops in with a full championship celebration.
function playKnockoutReveal(
  columns: HTMLElement[],
  podium: HTMLElement,
  champion: string,
): void {
  if (prefersReducedMotion()) {
    for (const column of columns) column.classList.remove("reveal-pending");
    podium.classList.remove("reveal-pending");
    return;
  }

  const step = 1100;
  columns.forEach((column, idx) => {
    later(() => {
      column.classList.remove("reveal-pending");
      column.classList.add("revealed");
      if (idx > 0) burstOver(column, 18); // teams advancing into this round
    }, idx * step);
  });

  later(() => {
    podium.classList.remove("reveal-pending");
    podium.classList.add("celebrate");
    setStatus(
      `🏆 ${flagOf(champion)} ${nameOf(champion)} are World Cup champions!`,
    );
    confettiBurst(140, 0.5, 0.3);
    later(() => confettiBurst(80, 0.22, 0.4), 220);
    later(() => confettiBurst(80, 0.78, 0.4), 440);
  }, columns.length * step + 150);
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
  const rows: HTMLElement[] = [];
  result.odds.forEach((o, i) => {
    const width = o.champion > 0 ? Math.max(2, (o.champion / max) * 100) : 0;
    const row = h(
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
      );
    rows.push(row);
    list.append(row);
  });
  stagger(rows);

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
    activateTab("knockout");
    renderKnockout(result);
    if (prefersReducedMotion()) {
      setStatus(
        `${flagOf(result.champion)} ${nameOf(result.champion)} win the World Cup! ` +
          `(seed ${result.seed} — edit the seed box and Simulate again to reproduce)`,
      );
    } else {
      setStatus("Playing through the knockout rounds…");
    }
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
