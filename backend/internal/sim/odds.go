package sim

import (
	"math/rand"
	"sort"

	"worldcup/internal/data"
)

// TeamOdds holds Monte Carlo probabilities for a single team, conditioned on
// the results that are already decided (real results plus any predictions).
type TeamOdds struct {
	Team      string  `json:"team"`      // team code
	Champion  float64 `json:"champion"`  // P(wins the tournament)
	Final     float64 `json:"final"`     // P(reaches the final)
	SemiFinal float64 `json:"semiFinal"` // P(reaches the semi-finals)
	Advance   float64 `json:"advance"`   // P(reaches the knockout stage)
}

// OddsResult is the aggregated outcome of repeated simulations.
type OddsResult struct {
	Runs int        `json:"runs"`
	Odds []TeamOdds `json:"odds"` // sorted by championship probability, descending
}

// Odds runs the tournament `runs` times from the given seed, holding the
// decided results fixed, and returns each team's probability of advancing to
// the knockout, reaching the semi-finals and final, and lifting the trophy.
func Odds(teams []data.Team, fixtures []data.Fixture, decided map[string]Score, runs int, seed int64) *OddsResult {
	rng := rand.New(rand.NewSource(seed))
	champ := map[string]int{}
	final := map[string]int{}
	semi := map[string]int{}
	advance := map[string]int{}

	for i := 0; i < runs; i++ {
		r := simulate(teams, fixtures, decided, rng)
		champ[r.Champion]++
		final[r.Champion]++
		final[r.RunnerUp]++
		for _, c := range r.semifinalists {
			semi[c]++
		}
		for _, c := range r.qualifiers {
			advance[c]++
		}
	}

	n := float64(runs)
	odds := make([]TeamOdds, 0, len(teams))
	for _, t := range teams {
		odds = append(odds, TeamOdds{
			Team:      t.Code,
			Champion:  float64(champ[t.Code]) / n,
			Final:     float64(final[t.Code]) / n,
			SemiFinal: float64(semi[t.Code]) / n,
			Advance:   float64(advance[t.Code]) / n,
		})
	}
	sort.SliceStable(odds, func(i, j int) bool {
		if odds[i].Champion != odds[j].Champion {
			return odds[i].Champion > odds[j].Champion
		}
		if odds[i].Final != odds[j].Final {
			return odds[i].Final > odds[j].Final
		}
		if odds[i].SemiFinal != odds[j].SemiFinal {
			return odds[i].SemiFinal > odds[j].SemiFinal
		}
		return odds[i].Advance > odds[j].Advance
	})

	return &OddsResult{Runs: runs, Odds: odds}
}
