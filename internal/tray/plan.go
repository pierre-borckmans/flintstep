package tray

// Menu updates for trays that keep their own item objects (the Linux StatusNotifierItem
// tray). The bridge calls SetMenu with the whole menu on every state change, up to 20
// times a second while an expression pedal moves, and almost always nothing has
// changed. planMenu says what the least work is: nothing, an in-place update of titles
// and enabled states, or a rebuild when the items themselves differ.

type menuPlan int

const (
	planNothing menuPlan = iota
	planUpdate           // same items: set titles / enabled states in place
	planRebuild          // items added, removed, reordered, or checked changed
)

// planMenu compares the menu shown (old) with the one wanted (new). A change of Checked
// rebuilds: a StatusNotifierItem item is a checkbox or not from its creation, and only
// checked items are made checkboxes, so an unchecked item shows no empty box (as an
// NSMenu shows none).
func planMenu(old, new []Item) menuPlan {
	if len(old) != len(new) {
		return planRebuild
	}
	plan := planNothing
	for i := range old {
		o, n := old[i], new[i]
		if o.Separator != n.Separator || o.ID != n.ID || (!n.Separator && o.Checked != n.Checked) {
			return planRebuild
		}
		if !n.Separator && (o.Title != n.Title || o.Disabled != n.Disabled) {
			plan = planUpdate
		}
	}
	return plan
}
