//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit
#import <AppKit/AppKit.h>

// The window backgrounds, style.css's --color-bg in each theme.
static NSColor *themeBackground(void) {
	return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *a) {
		NSAppearanceName n = [a bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]];
		if ([n isEqualToString:NSAppearanceNameDarkAqua]) {
			return [NSColor colorWithSRGBRed:0x14/255.0 green:0x15/255.0 blue:0x14/255.0 alpha:1];
		}
		return [NSColor colorWithSRGBRed:0xd9/255.0 green:0xd6/255.0 blue:0xcd/255.0 alpha:1];
	}];
}

// mode: 0 system, 1 dark, 2 light.
static void setTheme(int mode) {
	dispatch_async(dispatch_get_main_queue(), ^{
		NSAppearance *a = nil;
		if (mode == 1) a = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
		if (mode == 2) a = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
		NSApp.appearance = a;
		Class wails = NSClassFromString(@"WailsWindow");
		for (NSWindow *w in NSApp.windows) {
			// Wails pins the window's own appearance at launch; let it follow the app's.
			w.appearance = nil;
			if (wails && [w isKindOfClass:wails]) w.backgroundColor = themeBackground();
		}
	});
}

static bool systemIsDark(void) {
	NSString *style = [[NSUserDefaults standardUserDefaults] stringForKey:@"AppleInterfaceStyle"];
	return [style isEqualToString:@"Dark"];
}
*/
import "C"

import "flintstep/internal/store"

// setNativeTheme gives the app and its window the theme's appearance and background.
// The background is dynamic, so under "system" it follows macOS on its own.
func setNativeTheme(t store.Theme) {
	mode := 0
	switch t {
	case store.ThemeDark:
		mode = 1
	case store.ThemeLight:
		mode = 2
	}
	C.setTheme(C.int(mode))
}

// systemIsDark reports whether macOS is in dark mode. It reads the user default, so it
// works before NSApp exists.
func systemIsDark() bool { return bool(C.systemIsDark()) }
