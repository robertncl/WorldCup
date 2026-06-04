// Package data holds the static tournament data: the 48 qualified teams,
// their approximate strength ratings, and the group assignment logic.
package data

import "sort"

// Team is a national team taking part in the tournament.
//
// Rating is an Elo-like strength estimate (higher is stronger) used by the
// simulation engine. Ratings are approximate and intended for entertainment.
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

// teams is the master list of 48 participants for World Cup 2026.
// Group assignment is computed in init via a serpentine draft over rating so
// the twelve groups are balanced. Ratings are approximate, early-2026 values.
var teams = []Team{
	// CONMEBOL
	{Code: "ARG", Name: "Argentina", Flag: "🇦🇷", Confed: "CONMEBOL", Rating: 2105},
	{Code: "BRA", Name: "Brazil", Flag: "🇧🇷", Confed: "CONMEBOL", Rating: 2025},
	{Code: "URU", Name: "Uruguay", Flag: "🇺🇾", Confed: "CONMEBOL", Rating: 1895},
	{Code: "COL", Name: "Colombia", Flag: "🇨🇴", Confed: "CONMEBOL", Rating: 1885},
	{Code: "ECU", Name: "Ecuador", Flag: "🇪🇨", Confed: "CONMEBOL", Rating: 1750},
	{Code: "PAR", Name: "Paraguay", Flag: "🇵🇾", Confed: "CONMEBOL", Rating: 1690},

	// UEFA
	{Code: "FRA", Name: "France", Flag: "🇫🇷", Confed: "UEFA", Rating: 2080},
	{Code: "ESP", Name: "Spain", Flag: "🇪🇸", Confed: "UEFA", Rating: 2055},
	{Code: "ENG", Name: "England", Flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", Confed: "UEFA", Rating: 2040},
	{Code: "POR", Name: "Portugal", Flag: "🇵🇹", Confed: "UEFA", Rating: 2000},
	{Code: "NED", Name: "Netherlands", Flag: "🇳🇱", Confed: "UEFA", Rating: 1985},
	{Code: "GER", Name: "Germany", Flag: "🇩🇪", Confed: "UEFA", Rating: 1965},
	{Code: "BEL", Name: "Belgium", Flag: "🇧🇪", Confed: "UEFA", Rating: 1955},
	{Code: "ITA", Name: "Italy", Flag: "🇮🇹", Confed: "UEFA", Rating: 1945},
	{Code: "CRO", Name: "Croatia", Flag: "🇭🇷", Confed: "UEFA", Rating: 1905},
	{Code: "SUI", Name: "Switzerland", Flag: "🇨🇭", Confed: "UEFA", Rating: 1855},
	{Code: "DEN", Name: "Denmark", Flag: "🇩🇰", Confed: "UEFA", Rating: 1835},
	{Code: "NOR", Name: "Norway", Flag: "🇳🇴", Confed: "UEFA", Rating: 1800},
	{Code: "SRB", Name: "Serbia", Flag: "🇷🇸", Confed: "UEFA", Rating: 1730},
	{Code: "POL", Name: "Poland", Flag: "🇵🇱", Confed: "UEFA", Rating: 1725},

	// CONCACAF (hosts: MEX, USA, CAN)
	{Code: "MEX", Name: "Mexico", Flag: "🇲🇽", Confed: "CONCACAF", Rating: 1830, Host: true},
	{Code: "USA", Name: "United States", Flag: "🇺🇸", Confed: "CONCACAF", Rating: 1805, Host: true},
	{Code: "CAN", Name: "Canada", Flag: "🇨🇦", Confed: "CONCACAF", Rating: 1755, Host: true},
	{Code: "CRC", Name: "Costa Rica", Flag: "🇨🇷", Confed: "CONCACAF", Rating: 1700},
	{Code: "PAN", Name: "Panama", Flag: "🇵🇦", Confed: "CONCACAF", Rating: 1680},
	{Code: "JAM", Name: "Jamaica", Flag: "🇯🇲", Confed: "CONCACAF", Rating: 1640},
	{Code: "HON", Name: "Honduras", Flag: "🇭🇳", Confed: "CONCACAF", Rating: 1635},
	{Code: "CUW", Name: "Curaçao", Flag: "🇨🇼", Confed: "CONCACAF", Rating: 1600},

	// AFC
	{Code: "JPN", Name: "Japan", Flag: "🇯🇵", Confed: "AFC", Rating: 1825},
	{Code: "KOR", Name: "South Korea", Flag: "🇰🇷", Confed: "AFC", Rating: 1790},
	{Code: "IRN", Name: "Iran", Flag: "🇮🇷", Confed: "AFC", Rating: 1780},
	{Code: "AUS", Name: "Australia", Flag: "🇦🇺", Confed: "AFC", Rating: 1765},
	{Code: "KSA", Name: "Saudi Arabia", Flag: "🇸🇦", Confed: "AFC", Rating: 1685},
	{Code: "QAT", Name: "Qatar", Flag: "🇶🇦", Confed: "AFC", Rating: 1665},
	{Code: "UZB", Name: "Uzbekistan", Flag: "🇺🇿", Confed: "AFC", Rating: 1660},
	{Code: "JOR", Name: "Jordan", Flag: "🇯🇴", Confed: "AFC", Rating: 1645},

	// CAF
	{Code: "MAR", Name: "Morocco", Flag: "🇲🇦", Confed: "CAF", Rating: 1875},
	{Code: "SEN", Name: "Senegal", Flag: "🇸🇳", Confed: "CAF", Rating: 1815},
	{Code: "CIV", Name: "Ivory Coast", Flag: "🇨🇮", Confed: "CAF", Rating: 1760},
	{Code: "EGY", Name: "Egypt", Flag: "🇪🇬", Confed: "CAF", Rating: 1740},
	{Code: "NGA", Name: "Nigeria", Flag: "🇳🇬", Confed: "CAF", Rating: 1735},
	{Code: "RSA", Name: "South Africa", Flag: "🇿🇦", Confed: "CAF", Rating: 1720},
	{Code: "GHA", Name: "Ghana", Flag: "🇬🇭", Confed: "CAF", Rating: 1715},
	{Code: "ALG", Name: "Algeria", Flag: "🇩🇿", Confed: "CAF", Rating: 1710},
	{Code: "CMR", Name: "Cameroon", Flag: "🇨🇲", Confed: "CAF", Rating: 1705},
	{Code: "TUN", Name: "Tunisia", Flag: "🇹🇳", Confed: "CAF", Rating: 1700},
	{Code: "CPV", Name: "Cape Verde", Flag: "🇨🇻", Confed: "CAF", Rating: 1590},

	// OFC
	{Code: "NZL", Name: "New Zealand", Flag: "🇳🇿", Confed: "OFC", Rating: 1615},
}

func init() {
	if len(teams) != 48 {
		panic("data: expected exactly 48 teams")
	}

	// Serpentine draft: sort by rating descending, then deal teams into the
	// twelve groups snaking left-to-right, right-to-left so each group ends up
	// with one team from each strength tier.
	sort.SliceStable(teams, func(i, j int) bool {
		return teams[i].Rating > teams[j].Rating
	})
	for i := range teams {
		row, col := i/12, i%12
		if row%2 == 1 {
			col = 11 - col
		}
		teams[i].Group = string(groupLetters[col])
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
