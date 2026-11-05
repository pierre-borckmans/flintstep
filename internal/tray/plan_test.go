package tray

import "testing"

func TestPlanMenu(t *testing.T) {
	base := []Item{
		{ID: "status", Title: "Connected to SparkX", Disabled: true},
		{Separator: true},
		{ID: "login", Title: "Launch at Login"},
		{ID: "quit", Title: "Quit"},
	}
	with := func(f func([]Item)) []Item {
		c := append([]Item(nil), base...)
		f(c)
		return c
	}
	for _, c := range []struct {
		name string
		new  []Item
		want menuPlan
	}{
		{"same", with(func([]Item) {}), planNothing},
		{"title", with(func(m []Item) { m[0].Title = "Connecting…" }), planUpdate},
		{"enabled", with(func(m []Item) { m[3].Disabled = true }), planUpdate},
		{"checked", with(func(m []Item) { m[2].Checked = true }), planRebuild},
		{"id", with(func(m []Item) { m[3].ID = "open" }), planRebuild},
		{"separator moved", with(func(m []Item) { m[1], m[2] = m[2], m[1] }), planRebuild},
		{"longer", append(with(func([]Item) {}), Item{ID: "battery", Title: "Battery 80%"}), planRebuild},
		{"shorter", base[:3], planRebuild},
		{"separator fields ignored", with(func(m []Item) { m[1].Title = "x"; m[1].Checked = true }), planNothing},
	} {
		if got := planMenu(base, c.new); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
	if planMenu(nil, nil) != planNothing {
		t.Error("empty to empty is nothing")
	}
}
