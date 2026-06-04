// Command worldcup serves the World Cup 2026 simulator: a JSON API backed by
// the simulation engine plus the static single-page frontend.
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"worldcup/internal/api"
)

func main() {
	defaultAddr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		defaultAddr = ":" + p
	}

	addr := flag.String("addr", defaultAddr, "listen address, e.g. :8080")
	static := flag.String("static", "", "path to the built frontend (default: auto-detect ./frontend/dist)")
	flag.Parse()

	staticDir := *static
	if staticDir == "" {
		staticDir = findStatic()
	}

	srv := api.New(staticDir)
	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("⚽ World Cup 2026 simulator listening on http://localhost%s", *addr)
	log.Printf("   serving frontend from %s", staticDir)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// findStatic locates the built frontend relative to the current directory,
// tolerating being run from either the repo root or the backend directory.
func findStatic() string {
	for _, c := range []string{"frontend/dist", "../frontend/dist", "dist"} {
		if fi, err := os.Stat(filepath.Join(c, "index.html")); err == nil && !fi.IsDir() {
			if abs, err := filepath.Abs(c); err == nil {
				return abs
			}
			return c
		}
	}
	abs, _ := filepath.Abs("frontend/dist")
	return abs
}
