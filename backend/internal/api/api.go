// Package api exposes the simulator over HTTP: a small JSON API under /api and
// static hosting of the built frontend for everything else.
package api

import (
	"encoding/json"
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
// JavaScript number, so a shared seed always reproduces the same tournament.
func randomSeed() int64 { return rand.Int63n(1 << 31) }

const (
	defaultOddsRuns = 10000
	maxOddsRuns     = 50000
	minOddsRuns     = 100
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
	mux.HandleFunc("/api/teams", s.handleTeams)
	mux.HandleFunc("/api/simulate", s.handleSimulate)
	mux.HandleFunc("/api/odds", s.handleOdds)
	mux.HandleFunc("/", s.handleStatic)
	return withCORS(mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleTeams returns the 48 participants and the group letters.
func (s *Server) handleTeams(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"teams":  data.Teams(),
		"groups": data.GroupLetters(),
	})
}

// handleSimulate runs a single tournament. An optional `seed` query parameter
// makes the result reproducible; otherwise a time-based seed is used.
func (s *Server) handleSimulate(w http.ResponseWriter, r *http.Request) {
	seed := randomSeed()
	if v := r.URL.Query().Get("seed"); v != "" {
		if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
			seed = parsed
		}
	}
	writeJSON(w, http.StatusOK, sim.Simulate(data.Teams(), seed))
}

// handleOdds runs many tournaments and returns aggregate probabilities. The
// `runs` query parameter (clamped to a safe range) controls how many.
func (s *Server) handleOdds(w http.ResponseWriter, r *http.Request) {
	runs := defaultOddsRuns
	if v := r.URL.Query().Get("runs"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			runs = parsed
		}
	}
	if runs < minOddsRuns {
		runs = minOddsRuns
	}
	if runs > maxOddsRuns {
		runs = maxOddsRuns
	}

	seed := randomSeed()
	if v := r.URL.Query().Get("seed"); v != "" {
		if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
			seed = parsed
		}
	}
	writeJSON(w, http.StatusOK, sim.Odds(data.Teams(), runs, seed))
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
		`<title>World Cup 2026 Simulator</title>` +
		`<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1.5rem;line-height:1.6;color:#e8eef5;background:#0b1220}` +
		`code{background:#1b2738;padding:.15em .4em;border-radius:.3em}a{color:#5ad08a}</style></head><body>` +
		`<h1>⚽ World Cup 2026 Simulator</h1>` +
		`<p>The API is running, but the frontend has not been built yet.</p>` +
		`<p>From the <code>frontend</code> directory run:</p>` +
		`<pre><code>bun install   # first time only
bun run build</code></pre>` +
		`<p>Expected static directory: <code>` + staticDir + `</code></p>` +
		`<p>The JSON API is available now at <a href="/api/teams">/api/teams</a>, ` +
		`<a href="/api/simulate">/api/simulate</a>, and <a href="/api/odds?runs=2000">/api/odds</a>.</p>` +
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

// withCORS allows the API to be called from a separate dev server origin.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
