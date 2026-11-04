#pragma once

#include <stdlib.h>

typedef struct {
	const char *id;
	const char *title;
	int flags;
} trayItem;

enum { flagDisabled = 1, flagSeparator = 2, flagChecked = 4 };

void trayStart(const void *png, int len);
void traySetMenu(trayItem *items, int n);
void traySetTooltip(const char *s);
