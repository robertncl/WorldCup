package sim

import (
	"math/rand"
	"sort"

	"worldcup/internal/data"
)

// Score is a fixed scoreline for a group fixture, keyed by fixture ID in the
// `decided` map passed to the engine (e.g. a player's prediction).
type Score struct {
	Home int
	Away int
}

// Match is a single fixture result. For knockout fixtures Winner is always set;
// Shootout/HomePens/AwayPens describe a penalty shootout when one occurred.
type Match struct {
	Home      string `json:"home"` // home team code
	Away      string `json:"away"` // away team code
	HomeGoals int    `json:"homeGoals"`
	AwayGoals int    `json:"awayGoals"`
	Played    bool   `json:"played"`
	Stage     string `json:"stage"`
	Winner    string `json:"winner,omitempty"`
	Shootout  bool   `json:"shootout,omitempty"`
	HomePens  int    `json:"homePens,omitempty"`
	AwayPens  int    `json:"awayPens,omitempty"`
}

// Standing is a team's record within its group.
type Standing struct {
	Team      string `json:"team"` // team code
	Group     string `json:"group"`
	Played    int    `json:"played"`
	Won       int    `json:"won"`
	Drawn     int    `json:"drawn"`
	Lost      int    `json:"lost"`
	GF        int    `json:"gf"`
	GA        int    `json:"ga"`
	GD        int    `json:"gd"`
	Points    int    `json:"points"`
	Rank      int    `json:"rank"`                // 1..4 within the group
	Qualified bool   `json:"qualified,omitempty"` // for third-placed teams: among the best 8

	rating float64 // strength, used for seeding (not serialized)
	tie    float64 // random "drawing of lots" key (not serialized)
}

// GroupResult is the outcome of a single group.
type GroupResult struct {
	Group     string     `json:"group"`
	Standings []Standing `json:"standings"`
}

// KnockoutRound is one round of the bracket.
type KnockoutRound struct {
	Name    string  `json:"name"`
	Matches []Match `json:"matches"`
}

// TournamentResult is the full outcome of a single simulated tournament.
type TournamentResult struct {
	Seed            int64           `json:"seed"`
	Groups          []GroupResult   `json:"groups"`
	ThirdPlaceTable []Standing      `json:"thirdPlaceTable"` // all 12 third-placed teams, ranked
	Knockout        []KnockoutRound `json:"knockout"`
	Champion        string          `json:"champion"`
	RunnerUp        string          `json:"runnerUp"`
	Third           string          `json:"third"`

	qualifiers    []string // the 32 teams that reached the knockout (not serialized)
	semifinalists []string // teams that reached the semi-finals (not serialized)
}

// teamRef is a lightweight code+rating pair used internally by the engine.
type teamRef struct {
	code   string
	rating float64
}

// bracketOrder is the standard single-elimination seeding for 32 teams. It maps
// each of the 32 bracket slots to a seed number (1 = strongest) so that the top
// seeds can only meet in the later rounds.
var bracketOrder = []int{
	1, 32, 16, 17, 8, 25, 9, 24, 4, 29, 13, 20, 5, 28, 12, 21,
	2, 31, 15, 18, 7, 26, 10, 23, 3, 30, 14, 19, 6, 27, 11, 22,
}

// knockoutRoundNames are the elimination rounds played in order, before the
// final two teams contest the final (and the beaten semi-finalists the third-
// place play-off).
var knockoutRoundNames = []string{
	"Round of 32",
	"Round of 16",
	"Quarter-finals",
	"Semi-finals",
}

// Simulate runs one full tournament with the given random seed. Group fixtures
// that are already played (in `fixtures`) or supplied in `decided` use their
// fixed scoreline; every other group match and all knockout ties are sampled.
func Simulate(teams []data.Team, fixtures []data.Fixture, decided map[string]Score, seed int64) *TournamentResult {
	rng := rand.New(rand.NewSource(seed))
	res := simulate(teams, fixtures, decided, rng)
	res.Seed = seed
	return res
}

// simulate runs one tournament using the supplied RNG. Reused by Odds so many
// tournaments can share a single random stream.
func simulate(teams []data.Team, fixtures []data.Fixture, decided map[string]Score, rng *rand.Rand) *TournamentResult {
	ratings := make(map[string]float64, len(teams))
	byGroup := map[string][]data.Team{}
	for _, t := range teams {
		ratings[t.Code] = t.Rating
		byGroup[t.Group] = append(byGroup[t.Group], t)
	}
	fixturesByGroup := map[string][]data.Fixture{}
	for _, f := range fixtures {
		fixturesByGroup[f.Group] = append(fixturesByGroup[f.Group], f)
	}

	// --- Group stage ---
	letters := data.GroupLetters()
	groups := make([]GroupResult, 0, len(letters))
	winners := make([]Standing, 0, len(letters))
	runnersUp := make([]Standing, 0, len(letters))
	thirds := make([]Standing, 0, len(letters))
	for _, g := range letters {
		gr := playGroup(rng, g, byGroup[g], fixturesByGroup[g], decided, ratings)
		groups = append(groups, gr)
		winners = append(winners, gr.Standings[0])
		runnersUp = append(runnersUp, gr.Standings[1])
		thirds = append(thirds, gr.Standings[2])
	}

	// Rank the twelve third-placed teams; the best eight advance.
	sortStandings(thirds)
	thirdTable := make([]Standing, len(thirds))
	copy(thirdTable, thirds)
	for i := range thirdTable {
		thirdTable[i].Qualified = i < 8
	}

	// --- Seed the 32 qualifiers ---
	// Group winners outrank runners-up, who outrank third-placed teams; ties
	// within a tier are broken on record then strength.
	seeds := make([]Standing, 0, 32)
	seeds = append(seeds, winners...)
	seeds = append(seeds, runnersUp...)
	seeds = append(seeds, thirdTable[:8]...)
	tier := func(s Standing) int {
		switch s.Rank {
		case 1:
			return 0
		case 2:
			return 1
		default:
			return 2
		}
	}
	sort.SliceStable(seeds, func(i, j int) bool {
		if ti, tj := tier(seeds[i]), tier(seeds[j]); ti != tj {
			return ti < tj
		}
		return betterStanding(seeds[i], seeds[j])
	})

	qualifiers := make([]string, 0, 32)
	for _, s := range seeds {
		qualifiers = append(qualifiers, s.Team)
	}

	// Place the seeds into bracket slots.
	slots := make([]teamRef, 32)
	for i, seedNo := range bracketOrder {
		s := seeds[seedNo-1]
		slots[i] = teamRef{code: s.Team, rating: s.rating}
	}

	// --- Knockout rounds ---
	knockout := make([]KnockoutRound, 0, len(knockoutRoundNames)+2)
	current := slots
	var semifinalists []string
	var sfLosers []string
	for _, name := range knockoutRoundNames {
		if name == "Semi-finals" {
			for _, t := range current {
				semifinalists = append(semifinalists, t.code)
			}
		}
		matches := make([]Match, 0, len(current)/2)
		next := make([]teamRef, 0, len(current)/2)
		for i := 0; i+1 < len(current); i += 2 {
			m := playKnockout(rng, current[i], current[i+1], name)
			matches = append(matches, m)
			winner, loser := current[i], current[i+1]
			if m.Winner != winner.code {
				winner, loser = current[i+1], current[i]
			}
			next = append(next, winner)
			if name == "Semi-finals" {
				sfLosers = append(sfLosers, loser.code)
			}
		}
		knockout = append(knockout, KnockoutRound{Name: name, Matches: matches})
		current = next
	}

	// Third-place play-off between the beaten semi-finalists.
	thirdPlace := playKnockout(rng,
		teamRef{sfLosers[0], ratings[sfLosers[0]]},
		teamRef{sfLosers[1], ratings[sfLosers[1]]},
		"Third-place play-off")
	knockout = append(knockout, KnockoutRound{Name: "Third-place play-off", Matches: []Match{thirdPlace}})

	// Final between the two surviving teams.
	finalMatch := playKnockout(rng, current[0], current[1], "Final")
	knockout = append(knockout, KnockoutRound{Name: "Final", Matches: []Match{finalMatch}})

	champion := finalMatch.Winner
	runnerUp := finalMatch.Home
	if champion == finalMatch.Home {
		runnerUp = finalMatch.Away
	}

	return &TournamentResult{
		Groups:          groups,
		ThirdPlaceTable: thirdTable,
		Knockout:        knockout,
		Champion:        champion,
		RunnerUp:        runnerUp,
		Third:           thirdPlace.Winner,
		qualifiers:      qualifiers,
		semifinalists:   semifinalists,
	}
}

// playGroup builds a four-team group table from its six fixtures. Played and
// player-decided fixtures use their fixed scoreline; the rest are sampled.
func playGroup(rng *rand.Rand, letter string, ts []data.Team, fixtures []data.Fixture, decided map[string]Score, ratings map[string]float64) GroupResult {
	st := make(map[string]*Standing, len(ts))
	for _, t := range ts {
		st[t.Code] = &Standing{Team: t.Code, Group: letter, rating: t.Rating, tie: rng.Float64()}
	}

	for _, f := range fixtures {
		hg, ag := resultFor(rng, f, decided, ratings)
		if st[f.Home] == nil || st[f.Away] == nil {
			continue // defensive: fixture references a team outside the group
		}
		applyResult(st[f.Home], st[f.Away], hg, ag)
	}

	standings := make([]Standing, 0, len(ts))
	for _, t := range ts {
		standings = append(standings, *st[t.Code])
	}
	sortStandings(standings)
	for i := range standings {
		standings[i].Rank = i + 1
	}
	return GroupResult{Group: letter, Standings: standings}
}

// resultFor returns the scoreline to use for a fixture: the real result if it
// has been played, a fixed prediction if one was supplied, else a sample.
func resultFor(rng *rand.Rand, f data.Fixture, decided map[string]Score, ratings map[string]float64) (int, int) {
	if f.Played {
		return f.HomeGoals, f.AwayGoals
	}
	if s, ok := decided[f.ID]; ok {
		return s.Home, s.Away
	}
	return playMatch(rng, ratings[f.Home], ratings[f.Away])
}

// applyResult updates two standings with the outcome of a match between them.
func applyResult(home, away *Standing, hg, ag int) {
	home.Played++
	away.Played++
	home.GF += hg
	home.GA += ag
	away.GF += ag
	away.GA += hg
	home.GD = home.GF - home.GA
	away.GD = away.GF - away.GA
	switch {
	case hg > ag:
		home.Won++
		home.Points += 3
		away.Lost++
	case ag > hg:
		away.Won++
		away.Points += 3
		home.Lost++
	default:
		home.Drawn++
		away.Drawn++
		home.Points++
		away.Points++
	}
}

// betterStanding reports whether a should rank above b: points, then goal
// difference, goals for, strength, and finally a random drawing of lots.
func betterStanding(a, b Standing) bool {
	switch {
	case a.Points != b.Points:
		return a.Points > b.Points
	case a.GD != b.GD:
		return a.GD > b.GD
	case a.GF != b.GF:
		return a.GF > b.GF
	case a.rating != b.rating:
		return a.rating > b.rating
	default:
		return a.tie > b.tie
	}
}

func sortStandings(s []Standing) {
	sort.SliceStable(s, func(i, j int) bool { return betterStanding(s[i], s[j]) })
}
