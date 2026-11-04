import CoreBluetooth
import Foundation
// Spark Control X probe: listen to buttons/commands/exp and drive the LEDs.
// Sends only info requests (0b, 08, 0f, 0d, 12, 14) and lamp messages (01). Never profile writes.
let SECONDS = Double(CommandLine.arguments.dropFirst().first ?? "90") ?? 90
let BITS   = CBUUID(string: "362F71A0-6C96-11E3-981F-0800200C9A66")
let CMD_TX = CBUUID(string: "FFC9")   // host -> pedal
let CMD_RX = CBUUID(string: "FFCA")   // pedal -> host
let BATT   = CBUUID(string: "2A19")
let NAMES  = ["I", "II", "A", "III", "IV", "B"]   // bit n == lamp n
let t0 = Date()
func ts() -> String { String(format: "%6.2fs", Date().timeIntervalSince(t0)) }
func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined(separator: " ") }
func log(_ s: String) { print(ts(), s); fflush(stdout) }
let COLORS: [(String, UInt8, UInt8, UInt8)] = [("off", 0, 0, 0), ("red", 255, 0, 0), ("green", 0, 255, 0), ("blue", 0, 0, 255)]

final class P: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  var cm: CBCentralManager!; var p: CBPeripheral?; var tx: CBCharacteristic?
  var lastBits: UInt8 = 0; var colorIdx = [Int](repeating: 0, count: 6); var lastExp = Date.distantPast
  override init() { super.init(); cm = CBCentralManager(delegate: self, queue: nil) }
  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    guard c.state == .poweredOn else { return }
    log("scanning for SparkX… (quit Rigel if it keeps the pedal)"); c.scanForPeripherals(withServices: nil)
  }
  func centralManager(_ c: CBCentralManager, didDiscover per: CBPeripheral, advertisementData ad: [String: Any], rssi: NSNumber) {
    let name = (ad[CBAdvertisementDataLocalNameKey] as? String) ?? per.name ?? ""
    guard name.hasPrefix("SparkX"), p == nil else { return }
    c.stopScan(); p = per; per.delegate = self; log("connecting to \(name)"); c.connect(per)
  }
  func centralManager(_ c: CBCentralManager, didConnect per: CBPeripheral) { log("connected"); per.discoverServices(nil) }
  func centralManager(_ c: CBCentralManager, didDisconnectPeripheral per: CBPeripheral, error: Error?) { log("DISCONNECTED \(error.map { "\($0.localizedDescription)" } ?? "")"); exit(1) }
  func peripheral(_ per: CBPeripheral, didDiscoverServices e: Error?) { for s in per.services ?? [] { per.discoverCharacteristics(nil, for: s) } }
  func peripheral(_ per: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
    for ch in s.characteristics ?? [] {
      if [BITS, CMD_RX, BATT].contains(ch.uuid) { per.setNotifyValue(true, for: ch) }
      if ch.uuid == BATT { per.readValue(for: ch) }
      if ch.uuid == CMD_TX { tx = ch; DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.start() } }
    }
  }
  func send(_ b: [UInt8], quiet: Bool = false) {
    guard let p, let tx else { return }
    if !quiet { log("TX \(hex(Data(b)))") }
    p.writeValue(Data(b), for: tx, type: .withResponse)
  }
  func lamp(_ n: Int, _ r: UInt8, _ g: UInt8, _ b: UInt8, bright: UInt8 = 0x7F) {
    for state: UInt8 in [1, 2] { send([0x01, 0, 0, 0, 0x01, UInt8(n), state, bright, 0, b, g, r, 0], quiet: true) }
  }
  func start() {
    log("asking firmware, profile, battery, exp status, profile name/layout")
    send([0x0b] + [UInt8](repeating: 0, count: 27))
    send([0x08, 0, 0, 0]); send([0x0f, 0, 0, 0]); send([0x0d] + [UInt8](repeating: 0, count: 27))
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      log("rainbow test on all six LEDs")
      let rb: [(UInt8, UInt8, UInt8)] = [(255,0,0),(255,128,0),(255,255,0),(0,255,0),(0,0,255),(160,0,255)]
      for i in 0..<6 { self.lamp(i, rb[i].0, rb[i].1, rb[i].2) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
        for i in 0..<6 { self.lamp(i, 0, 0, 0) }
        log(">>> ready: press switches; each press cycles its LED off→red→green→blue")
      }
    }
  }
  func peripheral(_ per: CBPeripheral, didWriteValueFor ch: CBCharacteristic, error: Error?) {
    if let error { log("write error: \(error.localizedDescription)") }
  }
  func peripheral(_ per: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
    guard let v = ch.value, !v.isEmpty else { return }
    let b = [UInt8](v)
    switch ch.uuid {
    case BITS:
      let bits = b[0]; let down = bits & ~lastBits; let up = lastBits & ~bits; lastBits = bits
      for i in 0..<6 where down & (1 << i) != 0 {
        colorIdx[i] = (colorIdx[i] + 1) % COLORS.count; let c = COLORS[colorIdx[i]]
        log("DOWN \(NAMES[i])  -> LED \(c.0)"); lamp(i, c.1, c.2, c.3)
      }
      for i in 0..<6 where up & (1 << i) != 0 { log("UP   \(NAMES[i])") }
    case CMD_RX:
      switch b[0] {
      case 0x0c:
        if Date().timeIntervalSince(lastExp) > 0.5, b.count >= 10 {
          lastExp = Date(); log(String(format: "EXP  1=%5d  2=%5d", Int(b[5]) | Int(b[6]) << 8, Int(b[8]) | Int(b[9]) << 8))
        }
      case 0x03: log(String(format: "CMD  profile command 0x%02x", b.last ?? 0))
      case 0x0b: log("FW   \(String(decoding: b.dropFirst(5).filter { $0 != 0 }, as: UTF8.self))")
      case 0x08: log("PROFILE \(b.last ?? 0)"); send([0x12, 0, 0, 0, b.last ?? 1]); send([0x14, 0, 0, 0, b.last ?? 1])
      case 0x12: log("PROFILE NAME \"\(String(decoding: b.dropFirst(5).filter { $0 != 0 }, as: UTF8.self))\"")
      case 0x14: log("LAYOUT I II A III IV B exp1 exp2 = \(hex(Data(b.dropFirst(5))))")
      case 0x0f: log("BATTERY \(b.last ?? 0)%")
      case 0x0d: log("EXP CABLES \(b.last ?? 0) (0 none, 1, 2, 3 both)")
      default: log("RX   \(hex(v))")
      }
    case BATT: log("BATTERY (std) \(b[0])%")
    default: break
    }
  }
}
let probe = P()
DispatchQueue.main.asyncAfter(deadline: .now() + SECONDS) {
  if let p = probe.p { for i in 0..<6 { probe.lamp(i, 0, 0, 0) }; DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { probe.cm.cancelPeripheralConnection(p); log("done"); exit(0) } } else { log("never found the pedal"); exit(2) }
}
RunLoop.main.run()
