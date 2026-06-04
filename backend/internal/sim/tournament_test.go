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

func TestSimulateStructure(t *testing.T) {
	res := Simulate(data.Teams(), 42)

	if len(res.Groups) != 12 {
		t.Fatalf("expected 12 groups, got %d", len(res.Groups))
	}
	for _, g := range res.Groups {
		if len(g.Standings) != 4 {
			t.Errorf("group %s: %d standings, want 4", g.Group, len(g.Standings))
		}
		if len(g.Matches) != 6 {
			t.Errorf("group %s: %d matches, want 6", g.Group, len(g.Matches))
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
	if len(res.semifinalists) != 4 {
		t.Errorf("expected 4 semi-finalists, got %d", len(res.semifinalists))
	}
}

func TestSimulateDeterministic(t *testing.T) {
	a := Simulate(data.Teams(), 12345)
	b := Simulate(data.Teams(), 12345)
	if a.Champion != b.Champion || a.RunnerUp != b.RunnerUp {
		t.Errorf("same seed produced different results: %s/%s vs %s/%s",
			a.Champion, a.RunnerUp, b.Champion, b.RunnerUp)
	}
}

func TestOdds(t *testing.T) {
	const runs = 2000
	res := Odds(data.Teams(), runs, 7)
	if res.Runs != runs {
		t.Fatalf("runs = %d, want %d", res.Runs, runs)
	}
	if len(res.Odds) != 48 {
		t.Fatalf("odds entries = %d, want 48", len(res.Odds))
	}

	var sumChampion float64
	for _, o := range res.Odds {
		if o.Champion < 0 || o.Champion > 1 || o.Final < 0 || o.Final > 1 {
			t.Errorf("%s: probability out of range", o.Team)
		}
		// Reaching the final implies reaching the semis; winning implies the final.
		if o.SemiFinal+1e-9 < o.Final {
			t.Errorf("%s: semiFinal %.3f < final %.3f", o.Team, o.SemiFinal, o.Final)
		}
		if o.Final+1e-9 < o.Champion {
			t.Errorf("%s: final %.3f < champion %.3f", o.Team, o.Final, o.Champion)
		}
		sumChampion += o.Champion
	}
	if math.Abs(sumChampion-1.0) > 1e-6 {
		t.Errorf("championship probabilities sum to %.6f, want 1.0", sumChampion)
	}

	// Results are sorted by championship probability descending.
	for i := 1; i < len(res.Odds); i++ {
		if res.Odds[i-1].Champion < res.Odds[i].Champion {
			t.Errorf("odds not sorted at index %d", i)
		}
	}
}
