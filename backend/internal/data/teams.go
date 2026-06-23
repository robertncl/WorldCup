// Package data holds the static tournament data for the World Cup 2026
// prediction game: the 48 qualified teams with their real group assignments,
// and the real fixture list seeded with the results played so far (see
// fixtures.go). Group assignments mirror the actual December 2025 draw.
package data

import "sort"

// Team is a national team taking part in the tournament.
//
// Rating is an Elo-like strength estimate (higher is stronger) used by the
// odds engine. Ratings are approximate, early-2026 values for entertainment.
type Team struct {
	Code   string  `json:"code"`          // 3-letter code, e.g. "ARG"
	Name   string  `json:"name"`          // display name
	Flag   string  `json:"flag"`          // emoji flag
	Confed string  `json:"confederation"` // FIFA confederation
	Rating float64 `json:"rating"`        // Elo-like strength
	Group  string  `json:"group"`         // assigned group letter A..L
	Host   bool    `json:"host"`          // co-host nation
}

const groupLetters = "ABCDEFGHIJKL"

// teams is the master list of the 48 participants for World Cup 2026, in their
// real groups from the draw. Ratings are approximate, early-2026 estimates.
var teams = []Team{
	// Group A
	{Code: "MEX", Name: "Mexico", Flag: "🇲🇽", Confed: "CONCACAF", Rating: 1830, Group: "A", Host: true},
	{Code: "RSA", Name: "South Africa", Flag: "🇿🇦", Confed: "CAF", Rating: 1710, Group: "A"},
	{Code: "KOR", Name: "South Korea", Flag: "🇰🇷", Confed: "AFC", Rating: 1790, Group: "A"},
	{Code: "CZE", Name: "Czechia", Flag: "🇨🇿", Confed: "UEFA", Rating: 1755, Group: "A"},

	// Group B
	{Code: "CAN", Name: "Canada", Flag: "🇨🇦", Confed: "CONCACAF", Rating: 1760, Group: "B", Host: true},
	{Code: "BIH", Name: "Bosnia & Herzegovina", Flag: "🇧🇦", Confed: "UEFA", Rating: 1700, Group: "B"},
	{Code: "QAT", Name: "Qatar", Flag: "🇶🇦", Confed: "AFC", Rating: 1670, Group: "B"},
	{Code: "SUI", Name: "Switzerland", Flag: "🇨🇭", Confed: "UEFA", Rating: 1860, Group: "B"},

	// Group C
	{Code: "BRA", Name: "Brazil", Flag: "🇧🇷", Confed: "CONMEBOL", Rating: 2025, Group: "C"},
	{Code: "MAR", Name: "Morocco", Flag: "🇲🇦", Confed: "CAF", Rating: 1880, Group: "C"},
	{Code: "HAI", Name: "Haiti", Flag: "🇭🇹", Confed: "CONCACAF", Rating: 1560, Group: "C"},
	{Code: "SCO", Name: "Scotland", Flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", Confed: "UEFA", Rating: 1745, Group: "C"},

	// Group D
	{Code: "USA", Name: "United States", Flag: "🇺🇸", Confed: "CONCACAF", Rating: 1810, Group: "D", Host: true},
	{Code: "PAR", Name: "Paraguay", Flag: "🇵🇾", Confed: "CONMEBOL", Rating: 1700, Group: "D"},
	{Code: "AUS", Name: "Australia", Flag: "🇦🇺", Confed: "AFC", Rating: 1770, Group: "D"},
	{Code: "TUR", Name: "Türkiye", Flag: "🇹🇷", Confed: "UEFA", Rating: 1785, Group: "D"},

	// Group E
	{Code: "GER", Name: "Germany", Flag: "🇩🇪", Confed: "UEFA", Rating: 1965, Group: "E"},
	{Code: "CUW", Name: "Curaçao", Flag: "🇨🇼", Confed: "CONCACAF", Rating: 1590, Group: "E"},
	{Code: "CIV", Name: "Ivory Coast", Flag: "🇨🇮", Confed: "CAF", Rating: 1760, Group: "E"},
	{Code: "ECU", Name: "Ecuador", Flag: "🇪🇨", Confed: "CONMEBOL", Rating: 1750, Group: "E"},

	// Group F
	{Code: "NED", Name: "Netherlands", Flag: "🇳🇱", Confed: "UEFA", Rating: 1985, Group: "F"},
	{Code: "JPN", Name: "Japan", Flag: "🇯🇵", Confed: "AFC", Rating: 1825, Group: "F"},
	{Code: "SWE", Name: "Sweden", Flag: "🇸🇪", Confed: "UEFA", Rating: 1780, Group: "F"},
	{Code: "TUN", Name: "Tunisia", Flag: "🇹🇳", Confed: "CAF", Rating: 1700, Group: "F"},

	// Group G
	{Code: "BEL", Name: "Belgium", Flag: "🇧🇪", Confed: "UEFA", Rating: 1955, Group: "G"},
	{Code: "EGY", Name: "Egypt", Flag: "🇪🇬", Confed: "CAF", Rating: 1745, Group: "G"},
	{Code: "IRN", Name: "Iran", Flag: "🇮🇷", Confed: "AFC", Rating: 1780, Group: "G"},
	{Code: "NZL", Name: "New Zealand", Flag: "🇳🇿", Confed: "OFC", Rating: 1615, Group: "G"},

	// Group H
	{Code: "ESP", Name: "Spain", Flag: "🇪🇸", Confed: "UEFA", Rating: 2055, Group: "H"},
	{Code: "CPV", Name: "Cape Verde", Flag: "🇨🇻", Confed: "CAF", Rating: 1585, Group: "H"},
	{Code: "KSA", Name: "Saudi Arabia", Flag: "🇸🇦", Confed: "AFC", Rating: 1685, Group: "H"},
	{Code: "URU", Name: "Uruguay", Flag: "🇺🇾", Confed: "CONMEBOL", Rating: 1900, Group: "H"},

	// Group I
	{Code: "FRA", Name: "France", Flag: "🇫🇷", Confed: "UEFA", Rating: 2080, Group: "I"},
	{Code: "SEN", Name: "Senegal", Flag: "🇸🇳", Confed: "CAF", Rating: 1820, Group: "I"},
	{Code: "IRQ", Name: "Iraq", Flag: "🇮🇶", Confed: "AFC", Rating: 1640, Group: "I"},
	{Code: "NOR", Name: "Norway", Flag: "🇳🇴", Confed: "UEFA", Rating: 1810, Group: "I"},

	// Group J
	{Code: "ARG", Name: "Argentina", Flag: "🇦🇷", Confed: "CONMEBOL", Rating: 2105, Group: "J"},
	{Code: "ALG", Name: "Algeria", Flag: "🇩🇿", Confed: "CAF", Rating: 1715, Group: "J"},
	{Code: "AUT", Name: "Austria", Flag: "🇦🇹", Confed: "UEFA", Rating: 1765, Group: "J"},
	{Code: "JOR", Name: "Jordan", Flag: "🇯🇴", Confed: "AFC", Rating: 1645, Group: "J"},

	// Group K
	{Code: "POR", Name: "Portugal", Flag: "🇵🇹", Confed: "UEFA", Rating: 2000, Group: "K"},
	{Code: "COD", Name: "DR Congo", Flag: "🇨🇩", Confed: "CAF", Rating: 1705, Group: "K"},
	{Code: "UZB", Name: "Uzbekistan", Flag: "🇺🇿", Confed: "AFC", Rating: 1660, Group: "K"},
	{Code: "COL", Name: "Colombia", Flag: "🇨🇴", Confed: "CONMEBOL", Rating: 1890, Group: "K"},

	// Group L
	{Code: "ENG", Name: "England", Flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", Confed: "UEFA", Rating: 2040, Group: "L"},
	{Code: "CRO", Name: "Croatia", Flag: "🇭🇷", Confed: "UEFA", Rating: 1905, Group: "L"},
	{Code: "GHA", Name: "Ghana", Flag: "🇬🇭", Confed: "CAF", Rating: 1715, Group: "L"},
	{Code: "PAN", Name: "Panama", Flag: "🇵🇦", Confed: "CONCACAF", Rating: 1680, Group: "L"},
}

func init() {
	if len(teams) != 48 {
		panic("data: expected exactly 48 teams")
	}
	// Present teams grouped (A..L) and strongest-first within each group.
	sort.SliceStable(teams, func(i, j int) bool {
		if teams[i].Group != teams[j].Group {
			return teams[i].Group < teams[j].Group
		}
		return teams[i].Rating > teams[j].Rating
	})
}

// Teams returns the full list of 48 participants. The slice is shared and must
// be treated as read-only.
func Teams() []Team { return teams }

// GroupLetters returns the twelve group letters, "A" through "L".
func GroupLetters() []string {
	out := make([]string, len(groupLetters))
	for i := range groupLetters {
		out[i] = string(groupLetters[i])
	}
	return out
}
