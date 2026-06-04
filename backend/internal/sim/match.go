// Package sim contains the World Cup match and tournament simulation engine.
//
// Matches are simulated with a Poisson goals model: each side's expected goals
// is derived from the rating gap between the two teams, then the actual score
// is sampled from a Poisson distribution. Knockout ties are resolved with extra
// time and, if needed, a penalty shootout.
package sim

import (
	"math"
	"math/rand"
)

const (
	baseGoals = 1.32   // expected goals for an evenly matched side
	goalScale = 0.0030 // sensitivity of expected goals to rating difference
	maxLambda = 5.5    // clamp to avoid runaway scorelines
	minLambda = 0.18   // every side always has a puncher's chance
	etFactor  = 0.34   // extra-time expected goals relative to 90 minutes
)

// expectedGoals returns the Poisson means (lambda) for two teams given their
// ratings. A positive rating gap lifts one side's mean and lowers the other's.
func expectedGoals(ratingA, ratingB float64) (float64, float64) {
	diff := ratingA - ratingB
	la := clampLambda(baseGoals * math.Exp(goalScale*diff))
	lb := clampLambda(baseGoals * math.Exp(-goalScale*diff))
	return la, lb
}

func clampLambda(l float64) float64 {
	if l < minLambda {
		return minLambda
	}
	if l > maxLambda {
		return maxLambda
	}
	return l
}

// poisson samples a non-negative integer from a Poisson distribution with the
// given mean using Knuth's algorithm.
func poisson(rng *rand.Rand, lambda float64) int {
	l := math.Exp(-lambda)
	k, p := 0, 1.0
	for {
		k++
		p *= rng.Float64()
		if p <= l {
			return k - 1
		}
	}
}

// playMatch simulates a single 90-minute result and returns the goals scored by
// each side. Used for group-stage fixtures, where draws are allowed.
func playMatch(rng *rand.Rand, ratingA, ratingB float64) (int, int) {
	la, lb := expectedGoals(ratingA, ratingB)
	return poisson(rng, la), poisson(rng, lb)
}

// playKnockout simulates a knockout fixture that must produce a winner. If the
// score is level after 90 minutes it adds extra time and, failing that, a
// penalty shootout. The returned Match always has Winner set.
func playKnockout(rng *rand.Rand, a, b teamRef, stage string) Match {
	la, lb := expectedGoals(a.rating, b.rating)
	ga, gb := poisson(rng, la), poisson(rng, lb)

	m := Match{
		Home: a.code, Away: b.code,
		HomeGoals: ga, AwayGoals: gb,
		Played: true, Stage: stage,
	}

	if ga == gb {
		// Extra time: same relative strength, fewer expected goals.
		ga += poisson(rng, la*etFactor)
		gb += poisson(rng, lb*etFactor)
		m.HomeGoals, m.AwayGoals = ga, gb
	}

	switch {
	case ga > gb:
		m.Winner = a.code
	case gb > ga:
		m.Winner = b.code
	default:
		// Still level: penalty shootout.
		pa, pb := shootout(rng, a.rating, b.rating)
		m.Shootout = true
		m.HomePens, m.AwayPens = pa, pb
		if pa > pb {
			m.Winner = a.code
		} else {
			m.Winner = b.code
		}
	}
	return m
}

// penConversion is the per-kick conversion probability for a team, nudged a
// little by its rating and bounded to a realistic range.
func penConversion(rating float64) float64 {
	p := 0.62 + (rating-1700)/3000
	if p < 0.58 {
		return 0.58
	}
	if p > 0.86 {
		return 0.86
	}
	return p
}

// shootout simulates a penalty shootout and returns the final tally. It plays
// five rounds, then continues in sudden death until the tie is broken.
func shootout(rng *rand.Rand, ratingA, ratingB float64) (int, int) {
	pa, pb := penConversion(ratingA), penConversion(ratingB)
	a, b := 0, 0
	for i := 0; i < 5; i++ {
		if rng.Float64() < pa {
			a++
		}
		if rng.Float64() < pb {
			b++
		}
	}
	for a == b {
		if rng.Float64() < pa {
			a++
		}
		if rng.Float64() < pb {
			b++
		}
	}
	return a, b
}
