package sparkx

import "strings"

// WHICH PEDALS SPEAK THIS PROTOCOL.
//
// The Spark Control X is AirTurn hardware (its Device Information service says
// "AirTurn"), and Positive Grid sells the same chassis as the REACTOR Control. A pedal is
// recognised two ways:
//
//   - by name, before connecting: the name it advertises starts with one of a known
//     model's prefixes (case-insensitive). Only these are ever picked without the user
//     asking, and only they are what IsName means.
//   - by its services, after connecting: a pedal that has both the AirTurn switch service
//     and the FFC8 command service is accepted whatever its name, as Compatible. The
//     switch service alone is not enough: plain AirTurn page turners (BT500S and the
//     like) have it but no FFC8, and do not speak this protocol.
//
// See docs/PROTOCOL-NOTES.md, "REACTOR Control", for what is known about the second
// model and what is not.

// Model is one pedal model.
type Model struct {
	// ID is stable: it goes to the UI and may be saved.
	ID string
	// DisplayName is what the app calls it: "Connected to <DisplayName>".
	DisplayName string
	// NamePrefixes start the names this model advertises. Matched case-insensitively,
	// after trimming spaces.
	NamePrefixes []string
}

// ModelInfo is a Model as the UI gets it.
type ModelInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Info is m for the UI.
func (m Model) Info() ModelInfo { return ModelInfo{ID: m.ID, Name: m.DisplayName} }

// Model IDs.
const (
	IDSparkControlX  = "spark-control-x"
	IDReactorControl = "reactor-control"
	IDCompatible     = "compatible"
)

// The known models. The REACTOR Control prefixes are a guess from Positive Grid's naming:
// nobody has published what the pedal advertises yet. "REACTOR" alone is not one of
// them: the REACTOR amps advertise "REACTOR 50 BT Control", "REACTOR 100 BT Audio" and
// the like (Positive Grid's REACTOR App FAQ), and none of these prefixes matches those.
// A REACTOR Control whose name is none of these is still accepted by its services, once
// the user picks it from Scan.
var (
	SparkControlX = Model{
		ID:           IDSparkControlX,
		DisplayName:  "Spark Control X",
		NamePrefixes: []string{"SparkX"}, // "SparkX v4.1.23 fbfc"
	}
	ReactorControl = Model{
		ID:           IDReactorControl,
		DisplayName:  "REACTOR Control",
		NamePrefixes: []string{"REACTOR Control", "ReactorControl", "REACTOR-Control", "REACTOR Ctrl", "ReactorX", "RCTR"},
	}
	// Compatible is a pedal with an unknown name that has both services, checked after
	// connecting. It has no prefixes: nothing is recognised as Compatible by name.
	Compatible = Model{
		ID:          IDCompatible,
		DisplayName: "compatible AirTurn-based pedal",
	}
)

// Models is every model recognised by name, in the order they are tried.
var Models = []Model{SparkControlX, ReactorControl}

// ModelForName is the model whose prefix starts name, if any.
func ModelForName(name string) (Model, bool) {
	n := strings.ToLower(strings.TrimSpace(name))
	if n == "" {
		return Model{}, false
	}
	for _, m := range Models {
		for _, p := range m.NamePrefixes {
			if strings.HasPrefix(n, strings.ToLower(p)) {
				return m, true
			}
		}
	}
	return Model{}, false
}

// IsName reports whether an advertised name is a known model's.
func IsName(name string) bool {
	_, ok := ModelForName(name)
	return ok
}

// ModelByID is the model with this ID, Compatible included.
func ModelByID(id string) (Model, bool) {
	for _, m := range append(Models, Compatible) {
		if m.ID == id {
			return m, true
		}
	}
	return Model{}, false
}

// CommandServiceUUID is CommandSvc (FFC8) as a 128-bit UUID, lower case, as the radios
// spell service UUIDs.
const CommandServiceUUID = "0000ffc8-0000-1000-8000-00805f9b34fb"

// HasServices reports whether a device offering these service UUIDs (any case, 16-bit
// ones in their 128-bit form) is a compatible pedal: the switch service AND the command
// service.
func HasServices(uuids []string) bool {
	var sw, cmd bool
	for _, u := range uuids {
		switch strings.ToLower(u) {
		case strings.ToLower(SwitchService):
			sw = true
		case CommandServiceUUID:
			cmd = true
		}
	}
	return sw && cmd
}
