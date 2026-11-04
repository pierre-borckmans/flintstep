//go:build !darwin || !cgo

package main

import "sparkbridge/internal/store"

func setNativeTheme(store.Theme) {}

func systemIsDark() bool { return true }
