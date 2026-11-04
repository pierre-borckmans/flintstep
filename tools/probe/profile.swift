import CoreBluetooth
import Foundation
// Spark Control X profile probe: does anything push the active profile when it changes
// (long press A = next, long press B = previous)?
// Read-only: subscribes, reads, and sends the bare profile request 08 every 2 s. Never
// writes to 85DA4F4B, which is writable.
//
//   swift tools/probe/profile.swift <pedal identifier> [seconds]
let ID = UUID(uuidString: CommandLine.arguments.dropFirst().first ?? "")!
let SECONDS = Double(CommandLine.arguments.dropFirst(2).first ?? "45") ?? 45
let CMD_TX = CBUUID(string: "FFC9"), CMD_RX = CBUUID(string: "FFCA")
let WATCH = ["85DA4F4B-A2CA-4C7C-8C7D-FCD9E2DAAD56", "BD066DA4-F9EC-4F0D-A53C-1CD99147A641",
             "DA2E7828-FBCE-4E01-AE9E-261174997C48", "362F71A0-6C96-11E3-981F-0800200C9A66"].map { CBUUID(string: $0) }
let PROFILE = CBUUID(string: "85DA4F4B-A2CA-4C7C-8C7D-FCD9E2DAAD56")
let t0 = Date()
func log(_ s: String) { print(String(format: "%6.2fs", Date().timeIntervalSince(t0)), s); fflush(stdout) }
func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined(separator: " ") }

final class P: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  var cm: CBCentralManager!; var p: CBPeripheral?; var tx: CBCharacteristic?; var prof: CBCharacteristic?
  var last: [String: String] = [:]
  override init() { super.init(); cm = CBCentralManager(delegate: self, queue: nil) }
  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    guard c.state == .poweredOn, let per = c.retrievePeripherals(withIdentifiers: [ID]).first else { return }
    p = per; per.delegate = self; c.connect(per)
  }
  func centralManager(_ c: CBCentralManager, didConnect per: CBPeripheral) { log("connected"); per.discoverServices(nil) }
  func centralManager(_ c: CBCentralManager, didDisconnectPeripheral per: CBPeripheral, error: Error?) { log("DISCONNECTED"); exit(1) }
  func peripheral(_ per: CBPeripheral, didDiscoverServices e: Error?) { for s in per.services ?? [] { per.discoverCharacteristics(nil, for: s) } }
  func peripheral(_ per: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
    for ch in s.characteristics ?? [] {
      if WATCH.contains(ch.uuid) || ch.uuid == CMD_RX {
        if ch.properties.contains(.notify) { per.setNotifyValue(true, for: ch) }
        if ch.properties.contains(.read) { per.readValue(for: ch) }
      }
      if ch.uuid == PROFILE { prof = ch }
      if ch.uuid == CMD_TX { tx = ch; DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.tick() } }
    }
  }
  var n = 0
  func tick() {
    guard let p, let tx else { return }
    if n % 2 == 0 { p.writeValue(Data([0x08, 0, 0, 0]), for: tx, type: .withResponse) }
    if let prof { p.readValue(for: prof) }
    n += 1
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.tick() }
  }
  func peripheral(_ per: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
    guard let v = ch.value else { return }
    var key = String(ch.uuid.uuidString.prefix(8))
    if ch.uuid == CMD_RX {
      guard let t = v.first, t != 0x0c else { return } // skip the exp stream
      key = "FFCA/" + String(format: "%02x", t)
      if t == 0x03 { log("\(key) = \(hex(v))  (press command)"); return }
    }
    if key.hasPrefix("362F71A0") { if v.first != 0 { log("switches = \(hex(v))") }; return }
    let h = hex(v)
    if last[key] != h { log("\(key) = \(h)"); last[key] = h }
  }
}
let probe = P()
DispatchQueue.main.asyncAfter(deadline: .now() + SECONDS) {
  if let p = probe.p { probe.cm.cancelPeripheralConnection(p) }; log("done"); exit(0)
}
RunLoop.main.run()
