package sim

import (
	"math"
	"testing"

	"worldcup/internal/data"
)

func TestDataIntegrity(t *testing.T) {
	teams := data.Teams()
	if len(teams) != 48 {
		t.Fatalf("expected 48 teams, got %d", len(teams))
	}
	counts := map[string]int{}
	codes := map[string]bool{}
	for _, tm := range teams {
		counts[tm.Group]++
		if codes[tm.Code] {
			t.Fatalf("duplicate team code %q", tm.Code)
		}
		codes[tm.Code] = true
	}
	if len(counts) != 12 {
		t.Fatalf("expected 12 groups, got %d", len(counts))
	}
	for g, c := range counts {
		if c != 4 {
			t.Errorf("group %s has %d teams, want 4", g, c)
		}
	}
}

// TestFixtureIntegrity checks the baseline fixture list: six per group covering
// every pairing once, all teams present in the right group.
func TestFixtureIntegrity(t *testing.T) {
	groupOf := map[string]string{}
	for _, tm := range data.Teams() {
		groupOf[tm.Code] = tm.Group
	}

	perGroup := map[string]int{}
	pairs := map[string]bool{}
	for _, f := range data.Fixtures() {
		perGroup[f.Group]++
		if groupOf[f.Home] != f.Group || groupOf[f.Away] != f.Group {
			t.Errorf("fixture %s: %s v %s not both in group %s", f.ID, f.Home, f.Away, f.Group)
		}
		key := f.Home + "-" + f.Away
		rev := f.Away + "-" + f.Home
		if pairs[key] || pairs[rev] {
			t.Errorf("fixture %s: duplicate pairing %s v %s", f.ID, f.Home, f.Away)
		}
		pairs[key] = true
		if f.Played && (f.HomeGoals < 0 || f.AwayGoals < 0) {
			t.Errorf("fixture %s: negative played score", f.ID)
		}
	}
	for g, n := range perGroup {
		if n != 6 {
			t.Errorf("group %s has %d fixtures, want 6", g, n)
		}
	}
	if len(perGroup) != 12 {
		t.Fatalf("expected fixtures for 12 groups, got %d", len(perGroup))
	}
}

func TestSimulateStructure(t *testing.T) {
	res := Simulate(data.Teams(), data.Fixtures(), nil, 42)

	if len(res.Groups) != 12 {
		t.Fatalf("expected 12 groups, got %d", len(res.Groups))
	}
	for _, g := range res.Groups {
		if len(g.Standings) != 4 {
			t.Errorf("group %s: %d standings, want 4", g.Group, len(g.Standings))
		}
		played := 0
		for _, s := range g.Standings {
			played += s.Played
		}
		if played != 12 { // 6 matches * 2 teams
			t.Errorf("group %s: total played %d, want 12", g.Group, played)
		}
	}

	if len(res.ThirdPlaceTable) != 12 {
		t.Fatalf("third-place table has %d entries, want 12", len(res.ThirdPlaceTable))
	}
	qualified := 0
	for _, s := range res.ThirdPlaceTable {
		if s.Qualified {
			qualified++
		}
	}
	if qualified != 8 {
		t.Errorf("expected 8 qualified third-placed teams, got %d", qualified)
	}

	wantRounds := map[string]int{
		"Round of 32":          16,
		"Round of 16":          8,
		"Quarter-finals":       4,
		"Semi-finals":          2,
		"Third-place play-off": 1,
		"Final":                1,
	}
	got := map[string]int{}
	for _, r := range res.Knockout {
		got[r.Name] = len(r.Matches)
		for _, m := range r.Matches {
			if m.Winner == "" {
				t.Errorf("%s: knockout match %s v %s has no winner", r.Name, m.Home, m.Away)
			}
			if m.Winner != m.Home && m.Winner != m.Away {
				t.Errorf("%s: winner %q is not a participant", r.Name, m.Winner)
			}
		}
	}
	for name, n := range wantRounds {
		if got[name] != n {
			t.Errorf("round %q: %d matches, want %d", name, got[name], n)
		}
	}

	if res.Champion == "" || res.RunnerUp == "" || res.Third == "" {
		t.Errorf("missing podium: champ=%q runner=%q third=%q", res.Champion, res.RunnerUp, res.Third)
	}
	if res.Champion == res.RunnerUp {
		t.Errorf("champion and runner-up are the same team %q", res.Champion)
	}
	if len(res.qualifiers) != 32 {
		t.Errorf("expected 32 qualifiers, got %d", len(res.qualifiers))
	}
	if len(res.semifinalists) != 4 {
		t.Errorf("expected 4 semi-finalists, got %d", len(res.semifinalists))
	}
}

// TestBaselineResultsHonored confirms a played fixture's real score flows into
// the group table regardless of seed (Germany scored 7 then 2 in Group E).
func TestBaselineResultsHonored(t *testing.T) {
	for _, seed := range []int64{1, 2, 99} {
		res := Simulate(data.Teams(), data.Fixtures(), nil, seed)
		var ger Standing
		for _, g := range res.Groups {
			if g.Group != "E" {
				continue
			}
			for _, s := range g.Standings {
				if s.Team == "GER" {
					ger = s
				}
			}
		}
		// Two played matches: 7-1 and 2-1, so at least 9 GF and 6 points banked.
		if ger.GF < 9 {
			t.Errorf("seed %d: Germany GF %d, expected >= 9 from baseline", seed, ger.GF)
		}
		if ger.Points < 6 {
			t.Errorf("seed %d: Germany points %d, expected >= 6 from baseline", seed, ger.Points)
		}
	}
}

// TestPredictionDecidesMatch confirms a supplied prediction overrides a sampled
// open fixture deterministically.
func TestPredictionDecidesMatch(t *testing.T) {
	// A6 (open): South Korea v South Africa. Force a 5-0 KOR win.
	decided := map[string]Score{"A6": {Home: 5, Away: 0}}
	res := Simulate(data.Teams(), data.Fixtures(), decided, 7)
	var kor Standing
	for _, g := range res.Groups {
		if g.Group != "A" {
			continue
		}
		for _, s := range g.Standings {
			if s.Team == "KOR" {
				kor = s
			}
		}
	}
	// KOR also played MEX (lost 0-1) and CZE (won 2-1), plus the forced 5-0.
	if kor.GF < 7 {
		t.Errorf("Korea GF %d, expected >= 7 with forced 5-0 win", kor.GF)
	}
}

func TestSimulateDeterministic(t *testing.T) {
	a := Simulate(data.Teams(), data.Fixtures(), nil, 12345)
	b := Simulate(data.Teams(), data.Fixtures(), nil, 12345)
	if a.Champion != b.Champion || a.RunnerUp != b.RunnerUp {
		t.Errorf("same seed produced different results: %s/%s vs %s/%s",
			a.Champion, a.RunnerUp, b.Champion, b.RunnerUp)
	}
}

func TestOdds(t *testing.T) {
	const runs = 2000
	res := Odds(data.Teams(), data.Fixtures(), nil, runs, 7)
	if res.Runs != runs {
		t.Fatalf("runs = %d, want %d", res.Runs, runs)
	}
	if len(res.Odds) != 48 {
		t.Fatalf("odds entries = %d, want 48", len(res.Odds))
	}

	var sumChampion, sumAdvance float64
	for _, o := range res.Odds {
		for _, p := range []float64{o.Champion, o.Final, o.SemiFinal, o.Advance} {
			if p < 0 || p > 1 {
				t.Errorf("%s: probability %.3f out of range", o.Team, p)
			}
		}
		// Each deeper round implies the shallower ones.
		if o.Advance+1e-9 < o.SemiFinal {
			t.Errorf("%s: advance %.3f < semiFinal %.3f", o.Team, o.Advance, o.SemiFinal)
		}
		if o.SemiFinal+1e-9 < o.Final {
			t.Errorf("%s: semiFinal %.3f < final %.3f", o.Team, o.SemiFinal, o.Final)
		}
		if o.Final+1e-9 < o.Champion {
			t.Errorf("%s: final %.3f < champion %.3f", o.Team, o.Final, o.Champion)
		}
		sumChampion += o.Champion
		sumAdvance += o.Advance
	}
	if math.Abs(sumChampion-1.0) > 1e-6 {
		t.Errorf("championship probabilities sum to %.6f, want 1.0", sumChampion)
	}
	// 32 of 48 teams advance, so advancement probabilities must sum to ~32.
	if math.Abs(sumAdvance-32.0) > 1e-6 {
		t.Errorf("advancement probabilities sum to %.6f, want 32.0", sumAdvance)
	}

	for i := 1; i < len(res.Odds); i++ {
		if res.Odds[i-1].Champion < res.Odds[i].Champion {
			t.Errorf("odds not sorted at index %d", i)
		}
	}
}
