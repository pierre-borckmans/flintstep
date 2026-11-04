import CoreBluetooth
import Foundation
// Spark Control X power probe: is there a "charging" / "on USB" signal?
// Read-only: sends only the bare info requests 0f (battery), 10 and 11 (unknown, sent
// routinely by a Spark II amp), and reads every readable GATT characteristic. Prints a
// line only when a value changes. Plug and unplug the USB cable while it runs.
//
//   swift tools/probe/power.swift <pedal identifier> [seconds]
let ID = UUID(uuidString: CommandLine.arguments.dropFirst().first ?? "")!
let SECONDS = Double(CommandLine.arguments.dropFirst(2).first ?? "60") ?? 60
let CMD_TX = CBUUID(string: "FFC9"), CMD_RX = CBUUID(string: "FFCA")
let t0 = Date()
func log(_ s: String) { print(String(format: "%6.2fs", Date().timeIntervalSince(t0)), s); fflush(stdout) }
func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined(separator: " ") }

final class P: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  var cm: CBCentralManager!; var p: CBPeripheral?; var tx: CBCharacteristic?
  var readable: [CBCharacteristic] = []; var last: [String: String] = [:]
  override init() { super.init(); cm = CBCentralManager(delegate: self, queue: nil) }
  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    guard c.state == .poweredOn, let per = c.retrievePeripherals(withIdentifiers: [ID]).first else { return }
    p = per; per.delegate = self; log("connecting \(per.name ?? "?")"); c.connect(per)
  }
  func centralManager(_ c: CBCentralManager, didConnect per: CBPeripheral) { log("connected"); per.discoverServices(nil) }
  func centralManager(_ c: CBCentralManager, didDisconnectPeripheral per: CBPeripheral, error: Error?) { log("DISCONNECTED"); exit(1) }
  func peripheral(_ per: CBPeripheral, didDiscoverServices e: Error?) {
    for s in per.services ?? [] { log("service \(s.uuid)"); per.discoverCharacteristics(nil, for: s) }
  }
  func peripheral(_ per: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
    for ch in s.characteristics ?? [] {
      log("  char \(ch.uuid) props 0x\(String(ch.properties.rawValue, radix: 16)) in \(s.uuid)")
      if ch.properties.contains(.read) { readable.append(ch); per.readValue(for: ch) }
      if ch.properties.contains(.notify) && ch.uuid != CBUUID(string: "362F71A0-6C96-11E3-981F-0800200C9A66") { per.setNotifyValue(true, for: ch) }
      if ch.uuid == CMD_TX { tx = ch; DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.tick() } }
    }
  }
  func tick() {
    guard let p, let tx else { return }
    for k: UInt8 in [0x0f, 0x10, 0x11] { p.writeValue(Data([k, 0, 0, 0]), for: tx, type: .withResponse) }
    for ch in readable { p.readValue(for: ch) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.tick() }
  }
  func peripheral(_ per: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
    guard let v = ch.value else { return }
    var key = ch.uuid.uuidString
    if ch.uuid == CMD_RX {
      guard let t = v.first, [0x0f, 0x10, 0x11, 0x0d].contains(t) else { return } // skip exp stream, presses
      key = "FFCA/" + String(format: "%02x", t)
    }
    let h = hex(v)
    if last[key] != h { log("\(key) = \(h)"); last[key] = h }
  }
}
let probe = P()
DispatchQueue.main.asyncAfter(deadline: .now() + SECONDS) {
  if let p = probe.p { probe.cm.cancelPeripheralConnection(p) }; log("done"); exit(0)
}
RunLoop.main.run()
