//go:build darwin && cgo

// The AppKit half of the tray. It lives in its own file because cgo compiles a Go
// file's preamble twice when that file has //export functions, and an Objective-C
// class defined twice does not link.

#import <Cocoa/Cocoa.h>

#include "_cgo_export.h"

@interface SXTrayTarget : NSObject
- (void)clicked:(NSMenuItem *)item;
@end

@implementation SXTrayTarget
- (void)clicked:(NSMenuItem *)item {
	NSString *s = item.representedObject;
	if (s != nil) goTrayClick((char *)[s UTF8String]);
}
@end

// Touched only on the main queue.
static NSStatusItem *gItem;
static NSMenu *gMenu;
static NSString *gTip;
static SXTrayTarget *gTarget;

void trayStart(const void *png, int len) {
	@autoreleasepool {
		NSData *data = len > 0 ? [NSData dataWithBytes:png length:len] : nil;
		dispatch_async(dispatch_get_main_queue(), ^{
			if (gItem != nil) return;
			gItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
			NSImage *img = data != nil ? [[NSImage alloc] initWithData:data] : nil;
			if (img != nil && img.size.height > 0) {
				// 18 pt high whatever the PNG's pixel size: a 36 px PNG is drawn @2x.
				CGFloat h = 18;
				img.size = NSMakeSize(img.size.width * h / img.size.height, h);
				img.template = YES;
				gItem.button.image = img;
			} else {
				gItem.button.title = @"Flintstep";
			}
			if (gMenu != nil) gItem.menu = gMenu;
			if (gTip != nil) gItem.button.toolTip = gTip;
		});
	}
}

void traySetMenu(trayItem *items, int n) {
	@autoreleasepool {
		// Copy into Objective-C objects now: the caller frees the C strings on return.
		NSMutableArray *spec = [NSMutableArray arrayWithCapacity:n];
		for (int i = 0; i < n; i++) {
			[spec addObject:@[
				[NSString stringWithUTF8String:items[i].id] ?: @"",
				[NSString stringWithUTF8String:items[i].title] ?: @"",
				@(items[i].flags),
			]];
		}
		dispatch_async(dispatch_get_main_queue(), ^{
			if (gTarget == nil) gTarget = [[SXTrayTarget alloc] init];
			NSMenu *m = [[NSMenu alloc] initWithTitle:@""];
			m.autoenablesItems = NO;
			for (NSArray *e in spec) {
				int flags = [e[2] intValue];
				if (flags & flagSeparator) {
					[m addItem:[NSMenuItem separatorItem]];
					continue;
				}
				NSString *ident = e[0];
				NSMenuItem *it = [[NSMenuItem alloc] initWithTitle:e[1] action:nil keyEquivalent:@""];
				if (ident.length > 0) {
					it.target = gTarget;
					it.action = @selector(clicked:);
					it.representedObject = ident;
				}
				it.enabled = (flags & flagDisabled) == 0;
				it.state = (flags & flagChecked) ? NSControlStateValueOn : NSControlStateValueOff;
				[m addItem:it];
			}
			gMenu = m;
			if (gItem != nil) gItem.menu = m;
		});
	}
}

void traySetTooltip(const char *s) {
	@autoreleasepool {
		NSString *tip = [NSString stringWithUTF8String:s] ?: @"";
		dispatch_async(dispatch_get_main_queue(), ^{
			gTip = tip;
			if (gItem != nil) gItem.button.toolTip = tip;
		});
	}
}
