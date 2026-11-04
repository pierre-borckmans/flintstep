//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit
#import <AppKit/AppKit.h>

static void activateApp(void) {
	dispatch_async(dispatch_get_main_queue(), ^{
		[NSApp activateIgnoringOtherApps:YES];
	});
}
*/
import "C"

// activateApp brings the app forward. A menu-bar app (LSUIElement) is never the
// active app on its own, so showing its window would leave it behind the frontmost one.
func activateApp() { C.activateApp() }
