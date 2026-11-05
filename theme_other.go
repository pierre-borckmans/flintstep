//go:build !darwin || !cgo

package main

import "flintstep/internal/store"

func setNativeTheme(store.Theme) {}

func systemIsDark() bool { return true }
