// Package api exposes the prediction game over HTTP: a small JSON API under
// /api and static hosting of the built frontend for everything else.
package api

import (
	"encoding/json"
	"html"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"worldcup/internal/data"
	"worldcup/internal/sim"
)

// randomSeed returns a fresh seed small enough to round-trip safely through a
// JavaScript number, so a shared seed always reproduces the same simulation.
func randomSeed() int64 { return rand.Int63n(1 << 31) }

const (
	defaultOddsRuns = 10000
	maxOddsRuns     = 50000
	minOddsRuns     = 100
	maxPredictGoals = 30 // sanity cap on a submitted prediction scoreline
)

// Server wires the API handlers and static file hosting together.
type Server struct {
	staticDir string
}

// New returns a Server that serves the built frontend from staticDir.
func New(staticDir string) *Server {
	return &Server{staticDir: staticDir}
}

// Handler builds the HTTP handler for the whole application.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/state", s.handleState)
	mux.HandleFunc("/api/odds", s.handleOdds)
	mux.HandleFunc("/", s.handleStatic)
	return withSecurityHeaders(withCORS(mux))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleState returns everything the client needs to render the game: the 48
// teams, the group letters, the full fixture list (with baseline results) and
// the date that baseline was imported.
func (s *Server) handleState(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"teams":    data.Teams(),
		"groups":   data.GroupLetters(),
		"fixtures": data.Fixtures(),
		"asOf":     data.DataAsOf,
	})
}

// oddsRequest is the optional POST body for /api/odds: the player's predicted
// scorelines for open fixtures, keyed by fixture id.
type oddsRequest struct {
	Runs        int                       `json:"runs"`
	Seed        *int64                    `json:"seed"`
	Predictions map[string]predictedScore `json:"predictions"`
}

type predictedScore struct {
	HomeGoals int `json:"homeGoals"`
	AwayGoals int `json:"awayGoals"`
}

// handleOdds runs the Monte Carlo engine conditioned on the real results so far
// plus any predictions in the request body, and returns advancement and title
// probabilities. GET (no body) conditions on the real results only.
func (s *Server) handleOdds(w http.ResponseWriter, r *http.Request) {
	runs := defaultOddsRuns
	seed := randomSeed()
	decided := map[string]sim.Score{}

	if r.Method == http.MethodPost {
		var req oddsRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil && err.Error() != "EOF" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		if req.Runs > 0 {
			runs = req.Runs
		}
		if req.Seed != nil {
			seed = *req.Seed
		}
		valid := validFixtureIDs()
		for id, p := range req.Predictions {
			if !valid[id] || p.HomeGoals < 0 || p.AwayGoals < 0 ||
				p.HomeGoals > maxPredictGoals || p.AwayGoals > maxPredictGoals {
				continue
			}
			decided[id] = sim.Score{Home: p.HomeGoals, Away: p.AwayGoals}
		}
	} else {
		if v := r.URL.Query().Get("runs"); v != "" {
			if parsed, err := strconv.Atoi(v); err == nil {
				runs = parsed
			}
		}
		if v := r.URL.Query().Get("seed"); v != "" {
			if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
				seed = parsed
			}
		}
	}

	if runs < minOddsRuns {
		runs = minOddsRuns
	}
	if runs > maxOddsRuns {
		runs = maxOddsRuns
	}

	writeJSON(w, http.StatusOK, sim.Odds(data.Teams(), data.Fixtures(), decided, runs, seed))
}

// validFixtureIDs returns the set of open fixtures that may be predicted.
// Already-played fixtures are baseline truth and cannot be overridden.
func validFixtureIDs() map[string]bool {
	ids := map[string]bool{}
	for _, f := range data.Fixtures() {
		if !f.Played {
			ids[f.ID] = true
		}
	}
	return ids
}

// handleStatic serves the built frontend, falling back to index.html so the
// single-page app handles unknown routes. When the frontend has not been built
// yet it returns friendly instructions instead of a bare 404.
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	index := filepath.Join(s.staticDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		writeBuildHint(w, s.staticDir)
		return
	}

	clean := filepath.Clean("/" + strings.TrimPrefix(r.URL.Path, "/"))
	if clean == "/" {
		http.ServeFile(w, r, index)
		return
	}

	full := filepath.Join(s.staticDir, clean)
	// Guard against path traversal outside the static root.
	if !strings.HasPrefix(full, filepath.Clean(s.staticDir)+string(os.PathSeparator)) {
		http.NotFound(w, r)
		return
	}
	if fi, err := os.Stat(full); err == nil && !fi.IsDir() {
		http.ServeFile(w, r, full)
		return
	}
	// Unknown path: let the SPA handle it.
	http.ServeFile(w, r, index)
}

func writeBuildHint(w http.ResponseWriter, staticDir string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`<!doctype html><html><head><meta charset="utf-8">` +
		`<title>World Cup 2026 Prediction Game</title>` +
		`<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1.5rem;line-height:1.6;color:#e8eef5;background:#0b1220}` +
		`code{background:#1b2738;padding:.15em .4em;border-radius:.3em}a{color:#5ad08a}</style></head><body>` +
		`<h1>⚽ World Cup 2026 Prediction Game</h1>` +
		`<p>The API is running, but the frontend has not been built yet.</p>` +
		`<p>From the <code>frontend</code> directory run:</p>` +
		`<pre><code>bun install   # first time only
bun run build</code></pre>` +
		`<p>Expected static directory: <code>` + html.EscapeString(staticDir) + `</code></p>` +
		`<p>The JSON API is available now at <a href="/api/state">/api/state</a> ` +
		`and <a href="/api/odds?runs=2000">/api/odds</a>.</p>` +
		`</body></html>`))
}

// writeJSON encodes v as JSON with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

// withSecurityHeaders applies conservative hardening headers to every response.
func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// withCORS allows the API to be called from a separate dev server origin.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
