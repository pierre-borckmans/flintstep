//go:build linux && cgo && desktop

package main

// The GTK half of the Linux theme, only in the real app build (Wails' "desktop" tag):
// tests and CI lint build package main without GTK headers.

/*
#cgo linux pkg-config: gtk+-3.0
#include <gtk/gtk.h>

static gboolean applyPreferDark(gpointer data) {
	GtkSettings *s = gtk_settings_get_default();
	if (s != NULL) {
		g_object_set(s, "gtk-application-prefer-dark-theme", GPOINTER_TO_INT(data) ? TRUE : FALSE, NULL);
	}
	return G_SOURCE_REMOVE;
}

// setPreferDark runs on GTK's main loop, whichever thread asks.
static void setPreferDark(int dark) {
	g_idle_add(applyPreferDark, GINT_TO_POINTER(dark));
}
*/
import "C"

// setGtkPreferDark asks GTK for its theme's dark variant, or not.
func setGtkPreferDark(dark bool) {
	d := 0
	if dark {
		d = 1
	}
	C.setPreferDark(C.int(d))
}
