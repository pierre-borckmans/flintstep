// Renders icon.svg into the template PNGs the tray embeds.
// Run from this directory: swift render_icon.swift
// Needs macOS 14+, where NSImage reads SVG.
import AppKit

let svg = URL(fileURLWithPath: "icon.svg")
guard let img = NSImage(contentsOf: svg) else { fatalError("cannot read icon.svg") }
for (px, name) in [(36, "icon@2x.png"), (18, "icon.png")] {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0)
    else { fatalError("bitmap") }
    rep.size = NSSize(width: px, height: px)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    img.draw(in: NSRect(x: 0, y: 0, width: px, height: px))
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: name))
}
