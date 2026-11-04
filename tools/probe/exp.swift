import CoreBluetooth
import Foundation
// Spark Control X expression probe: prints every FFCA message type with a count per
// second, and the expression values (0x0c) when they change. Read-only apart from the
// bare cable request 0d.
//
//   swift tools/probe/exp.swift <pedal identifier> [seconds]
let ID = UUID(uuidString: CommandLine.arguments.dropFirst().first ?? "")!
let SECONDS = Double(CommandLine.arguments.dropFirst(2).first ?? "25") ?? 25
let CMD_TX = CBUUID(string: "FFC9"), CMD_RX = CBUUID(string: "FFCA")
let t0 = Date()
func log(_ s: String) { print(String(format: "%6.2fs", Date().timeIntervalSince(t0)), s); fflush(stdout) }
func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined(separator: " ") }

final class P: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  var cm: CBCentralManager!; var p: CBPeripheral?
  var counts: [UInt8: Int] = [:]; var lastExp = ""
  override init() { super.init(); cm = CBCentralManager(delegate: self, queue: nil) }
  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    guard c.state == .poweredOn, let per = c.retrievePeripherals(withIdentifiers: [ID]).first else { return }
    p = per; per.delegate = self; c.connect(per)
  }
  func centralManager(_ c: CBCentralManager, didConnect per: CBPeripheral) { log("connected"); per.discoverServices([CBUUID(string: "FFC8")]) }
  func centralManager(_ c: CBCentralManager, didDisconnectPeripheral per: CBPeripheral, error: Error?) { log("DISCONNECTED"); exit(1) }
  func peripheral(_ per: CBPeripheral, didDiscoverServices e: Error?) { for s in per.services ?? [] { per.discoverCharacteristics(nil, for: s) } }
  func peripheral(_ per: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
    for ch in s.characteristics ?? [] {
      if ch.uuid == CMD_RX { per.setNotifyValue(true, for: ch) }
      if ch.uuid == CMD_TX { per.writeValue(Data([0x0d] + [UInt8](repeating: 0, count: 31)), for: ch, type: .withResponse) }
    }
    tickCounts()
  }
  func tickCounts() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      log("per second: " + self.counts.sorted { $0.key < $1.key }.map { String(format: "%02x×%d", $0.key, $0.value) }.joined(separator: " "))
      self.counts = [:]; self.tickCounts()
    }
  }
  func peripheral(_ per: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
    guard let v = ch.value, let t = v.first else { return }
    counts[t, default: 0] += 1
    if t == 0x0c {
      let h = hex(v); if h != lastExp { lastExp = h; log("exp \(h)") }
    } else { log("msg \(hex(v))") }
  }
}
let probe = P()
DispatchQueue.main.asyncAfter(deadline: .now() + SECONDS) {
  if let p = probe.p { probe.cm.cancelPeripheralConnection(p) }; log("done"); exit(0)
}
RunLoop.main.run()
