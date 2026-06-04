package sim

import (
	"math/rand"
	"sort"

	"worldcup/internal/data"
)

// TeamOdds holds Monte Carlo probabilities for a single team.
type TeamOdds struct {
	Team      string  `json:"team"`      // team code
	Champion  float64 `json:"champion"`  // P(wins the tournament)
	Final     float64 `json:"final"`     // P(reaches the final)
	SemiFinal float64 `json:"semiFinal"` // P(reaches the semi-finals)
}

// OddsResult is the aggregated outcome of repeated simulations.
type OddsResult struct {
	Runs int        `json:"runs"`
	Odds []TeamOdds `json:"odds"` // sorted by championship probability, descending
}

// Odds runs the tournament `runs` times from the given seed and returns each
// team's probability of reaching the semi-finals, the final, and lifting the
// trophy. All runs share one random stream so the samples are independent.
func Odds(teams []data.Team, runs int, seed int64) *OddsResult {
	rng := rand.New(rand.NewSource(seed))
	champ := map[string]int{}
	final := map[string]int{}
	semi := map[string]int{}

	for i := 0; i < runs; i++ {
		r := simulate(teams, rng)
		champ[r.Champion]++
		final[r.Champion]++
		final[r.RunnerUp]++
		for _, c := range r.semifinalists {
			semi[c]++
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
		})
	}
	sort.SliceStable(odds, func(i, j int) bool {
		if odds[i].Champion != odds[j].Champion {
			return odds[i].Champion > odds[j].Champion
		}
		if odds[i].Final != odds[j].Final {
			return odds[i].Final > odds[j].Final
		}
		return odds[i].SemiFinal > odds[j].SemiFinal
	})

	return &OddsResult{Runs: runs, Odds: odds}
}
