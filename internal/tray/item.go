package tray

// Item is one line of the menu. A Separator ignores the other fields.
type Item struct {
	ID, Title string
	Disabled  bool
	Separator bool
	Checked   bool
}
