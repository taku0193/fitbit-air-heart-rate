@preconcurrency import CoreBluetooth
import Combine
import Foundation
import PulseAirCore

@MainActor
final class HeartRateMonitor: NSObject, ObservableObject {
    enum ConnectionStatus: Equatable {
        case unavailable
        case disconnected
        case scanning
        case connecting
        case connected(String)

        var label: String {
            switch self {
            case .unavailable: return "Bluetoothを利用できません"
            case .disconnected: return "未接続"
            case .scanning: return "心拍計を検索中…"
            case .connecting: return "接続中…"
            case .connected(let name): return name
            }
        }

        var isBusy: Bool { self == .scanning || self == .connecting }
        var isConnected: Bool {
            if case .connected = self { return true }
            return false
        }
    }

    @Published private(set) var bpm: Int?
    @Published private(set) var status: ConnectionStatus = .disconnected
    @Published private(set) var lastUpdated: Date?
    @Published private(set) var errorMessage: String?

    private let heartRateService = CBUUID(string: "180D")
    private let heartRateMeasurement = CBUUID(string: "2A37")
    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    var menuBarText: String {
        bpm.map(String.init) ?? "--"
    }

    func connect() {
        errorMessage = nil
        guard central.state == .poweredOn else {
            status = .unavailable
            return
        }

        status = .scanning
        central.scanForPeripherals(
            withServices: [heartRateService],
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )
    }

    func disconnect() {
        central.stopScan()
        if let peripheral { central.cancelPeripheralConnection(peripheral) }
        resetConnection()
    }

    private func resetConnection() {
        peripheral?.delegate = nil
        peripheral = nil
        bpm = nil
        lastUpdated = nil
        status = central.state == .poweredOn ? .disconnected : .unavailable
    }
}

extension HeartRateMonitor: CBCentralManagerDelegate {
    nonisolated func centralManagerDidUpdateState(_ central: CBCentralManager) {
        Task { @MainActor in
            if central.state != .poweredOn { resetConnection() }
            else if status == .unavailable { status = .disconnected }
        }
    }

    nonisolated func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        Task { @MainActor in
            guard status == .scanning else { return }
            central.stopScan()
            self.peripheral = peripheral
            peripheral.delegate = self
            status = .connecting
            central.connect(peripheral)
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        Task { @MainActor in
            status = .connected(peripheral.name ?? "心拍計")
            peripheral.discoverServices([heartRateService])
        }
    }

    nonisolated func centralManager(
        _ central: CBCentralManager,
        didFailToConnect peripheral: CBPeripheral,
        error: Error?
    ) {
        Task { @MainActor in
            errorMessage = error?.localizedDescription ?? "心拍計へ接続できませんでした。"
            resetConnection()
        }
    }

    nonisolated func centralManager(
        _ central: CBCentralManager,
        didDisconnectPeripheral peripheral: CBPeripheral,
        error: Error?
    ) {
        Task { @MainActor in
            if let error { errorMessage = error.localizedDescription }
            resetConnection()
        }
    }
}

extension HeartRateMonitor: CBPeripheralDelegate {
    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        Task { @MainActor in
            if let error {
                errorMessage = error.localizedDescription
                disconnect()
                return
            }
            peripheral.services?.forEach {
                peripheral.discoverCharacteristics([heartRateMeasurement], for: $0)
            }
        }
    }

    nonisolated func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        Task { @MainActor in
            if let error {
                errorMessage = error.localizedDescription
                disconnect()
                return
            }
            guard let characteristic = service.characteristics?.first(where: { $0.uuid == heartRateMeasurement }) else {
                errorMessage = "Heart Rate Measurementが見つかりません。"
                disconnect()
                return
            }
            peripheral.setNotifyValue(true, for: characteristic)
        }
    }

    nonisolated func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        Task { @MainActor in
            guard error == nil, let data = characteristic.value else {
                errorMessage = error?.localizedDescription ?? "心拍数を読み取れませんでした。"
                return
            }
            do {
                bpm = try HeartRateParser.parse(data)
                lastUpdated = Date()
                errorMessage = nil
            } catch {
                errorMessage = "受信した心拍数データが不正です。"
            }
        }
    }
}
