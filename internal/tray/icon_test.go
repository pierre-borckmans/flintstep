package tray

import (
	"bytes"
	"image/png"
	"testing"
)

func TestIcon(t *testing.T) {
	img, err := png.Decode(bytes.NewReader(Icon))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 36 || b.Dy() != 36 {
		t.Fatalf("icon is %v, want 36x36", b)
	}
	// A template image: every pixel black, only alpha varies.
	b := img.Bounds()
	opaque := 0
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, a := img.At(x, y).RGBA()
			if a > 0 && (r|g|bl) > 0x0800 {
				t.Fatalf("pixel (%d,%d) is not black: %d %d %d %d", x, y, r, g, bl, a)
			}
			if a > 0 {
				opaque++
			}
		}
	}
	if opaque == 0 {
		t.Fatal("icon is empty")
	}
}
