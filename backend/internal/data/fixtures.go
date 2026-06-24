package data

// DataAsOf is the date the baseline results below were imported. Group-stage
// fixtures with Played=true carry the real scoreline; the rest are still open
// for the player to predict.
const DataAsOf = "2026-06-23"

// Result is a single match scoreline.
type Result struct {
	HomeGoals int `json:"homeGoals"`
	AwayGoals int `json:"awayGoals"`
}

// Fixture is one group-stage match. When Played is true, HomeGoals/AwayGoals
// hold the real result imported as the baseline; otherwise the match is open
// and the player predicts it.
type Fixture struct {
	ID        string `json:"id"`    // stable id, e.g. "A1"
	Group     string `json:"group"` // group letter A..L
	Home      string `json:"home"`  // home team code
	Away      string `json:"away"`  // away team code
	Date      string `json:"date"`  // ISO date of the match
	Played    bool   `json:"played"`
	HomeGoals int    `json:"homeGoals"` // valid when Played
	AwayGoals int    `json:"awayGoals"` // valid when Played
}

// played is a small helper for declaring a finished baseline result.
func played(id, group, home, away, date string, hg, ag int) Fixture {
	return Fixture{ID: id, Group: group, Home: home, Away: away, Date: date, Played: true, HomeGoals: hg, AwayGoals: ag}
}

// open declares a not-yet-played fixture for the player to predict.
func open(id, group, home, away, date string) Fixture {
	return Fixture{ID: id, Group: group, Home: home, Away: away, Date: date}
}

// fixtures is the full 72-match group stage (six per group). Real results
// through DataAsOf are baked in; the remaining matches are open. Each group's
// six fixtures cover every pairing exactly once.
var fixtures = []Fixture{
	// Group A — Mexico, South Korea, Czechia, South Africa
	played("A1", "A", "MEX", "RSA", "2026-06-11", 2, 0),
	played("A2", "A", "KOR", "CZE", "2026-06-11", 2, 1),
	played("A3", "A", "CZE", "RSA", "2026-06-17", 1, 1),
	played("A4", "A", "MEX", "KOR", "2026-06-18", 1, 0),
	open("A5", "A", "MEX", "CZE", "2026-06-24"),
	open("A6", "A", "KOR", "RSA", "2026-06-24"),

	// Group B — Switzerland, Canada, Bosnia & Herzegovina, Qatar
	played("B1", "B", "CAN", "BIH", "2026-06-12", 1, 1),
	played("B2", "B", "QAT", "SUI", "2026-06-13", 1, 1),
	played("B3", "B", "CAN", "QAT", "2026-06-18", 6, 0),
	played("B4", "B", "SUI", "BIH", "2026-06-18", 4, 1),
	open("B5", "B", "CAN", "SUI", "2026-06-24"),
	open("B6", "B", "QAT", "BIH", "2026-06-24"),

	// Group C — Brazil, Morocco, Scotland, Haiti
	played("C1", "C", "BRA", "MAR", "2026-06-13", 1, 1),
	played("C2", "C", "HAI", "SCO", "2026-06-13", 0, 1),
	played("C3", "C", "SCO", "MAR", "2026-06-19", 0, 1),
	played("C4", "C", "BRA", "HAI", "2026-06-19", 3, 0),
	open("C5", "C", "BRA", "SCO", "2026-06-24"),
	open("C6", "C", "MAR", "HAI", "2026-06-24"),

	// Group D — United States, Australia, Türkiye, Paraguay
	played("D1", "D", "USA", "PAR", "2026-06-12", 4, 1),
	played("D2", "D", "AUS", "TUR", "2026-06-13", 2, 0),
	played("D3", "D", "USA", "AUS", "2026-06-19", 2, 0),
	played("D4", "D", "TUR", "PAR", "2026-06-19", 0, 1),
	open("D5", "D", "USA", "TUR", "2026-06-25"),
	open("D6", "D", "PAR", "AUS", "2026-06-25"),

	// Group E — Germany, Ivory Coast, Ecuador, Curaçao
	played("E1", "E", "GER", "CUW", "2026-06-14", 7, 1),
	played("E2", "E", "CIV", "ECU", "2026-06-14", 1, 0),
	played("E3", "E", "GER", "CIV", "2026-06-20", 2, 1),
	played("E4", "E", "ECU", "CUW", "2026-06-20", 0, 0),
	open("E5", "E", "GER", "ECU", "2026-06-25"),
	open("E6", "E", "CIV", "CUW", "2026-06-25"),

	// Group F — Netherlands, Japan, Sweden, Tunisia
	played("F1", "F", "NED", "JPN", "2026-06-14", 2, 2),
	played("F2", "F", "SWE", "TUN", "2026-06-14", 5, 1),
	played("F3", "F", "NED", "SWE", "2026-06-20", 5, 1),
	played("F4", "F", "JPN", "TUN", "2026-06-20", 4, 0),
	open("F5", "F", "NED", "TUN", "2026-06-25"),
	open("F6", "F", "JPN", "SWE", "2026-06-25"),

	// Group G — Belgium, Iran, Egypt, New Zealand
	played("G1", "G", "BEL", "EGY", "2026-06-15", 1, 1),
	played("G2", "G", "IRN", "NZL", "2026-06-15", 2, 2),
	played("G3", "G", "BEL", "IRN", "2026-06-20", 0, 0),
	played("G4", "G", "NZL", "EGY", "2026-06-20", 1, 3),
	open("G5", "G", "BEL", "NZL", "2026-06-25"),
	open("G6", "G", "EGY", "IRN", "2026-06-25"),

	// Group H — Spain, Uruguay, Saudi Arabia, Cape Verde
	played("H1", "H", "ESP", "CPV", "2026-06-15", 0, 0),
	played("H2", "H", "KSA", "URU", "2026-06-15", 1, 1),
	played("H3", "H", "ESP", "KSA", "2026-06-21", 4, 0),
	played("H4", "H", "URU", "CPV", "2026-06-21", 2, 2),
	open("H5", "H", "ESP", "URU", "2026-06-26"),
	open("H6", "H", "CPV", "KSA", "2026-06-26"),

	// Group I — France, Senegal, Norway, Iraq
	played("I1", "I", "FRA", "SEN", "2026-06-16", 3, 1),
	played("I2", "I", "IRQ", "NOR", "2026-06-16", 1, 4),
	played("I3", "I", "FRA", "IRQ", "2026-06-22", 3, 0),
	played("I4", "I", "SEN", "NOR", "2026-06-22", 1, 1),
	open("I5", "I", "FRA", "NOR", "2026-06-26"),
	open("I6", "I", "SEN", "IRQ", "2026-06-26"),

	// Group J — Argentina, Austria, Algeria, Jordan
	played("J1", "J", "ARG", "ALG", "2026-06-16", 3, 0),
	played("J2", "J", "AUT", "JOR", "2026-06-16", 3, 1),
	played("J3", "J", "ARG", "AUT", "2026-06-22", 2, 0),
	played("J4", "J", "ALG", "JOR", "2026-06-22", 2, 1),
	open("J5", "J", "ARG", "JOR", "2026-06-26"),
	open("J6", "J", "ALG", "AUT", "2026-06-26"),

	// Group K — Portugal, Colombia, Uzbekistan, DR Congo
	played("K1", "K", "POR", "COD", "2026-06-17", 1, 1),
	played("K2", "K", "UZB", "COL", "2026-06-17", 1, 3),
	played("K3", "K", "POR", "UZB", "2026-06-23", 2, 0),
	played("K4", "K", "COD", "COL", "2026-06-23", 1, 2),
	open("K5", "K", "POR", "COL", "2026-06-26"),
	open("K6", "K", "COD", "UZB", "2026-06-26"),

	// Group L — England, Croatia, Ghana, Panama
	played("L1", "L", "ENG", "CRO", "2026-06-17", 4, 2),
	played("L2", "L", "GHA", "PAN", "2026-06-17", 1, 0),
	played("L3", "L", "ENG", "GHA", "2026-06-23", 3, 0),
	played("L4", "L", "CRO", "PAN", "2026-06-23", 2, 0),
	open("L5", "L", "ENG", "PAN", "2026-06-26"),
	open("L6", "L", "CRO", "GHA", "2026-06-26"),
}

// Fixtures returns the full group-stage fixture list. The slice is shared and
// must be treated as read-only.
func Fixtures() []Fixture { return fixtures }
