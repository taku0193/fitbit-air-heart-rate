import AppKit
import SwiftUI

@main
struct PulseAirMenuBarApp: App {
    @NSApplicationDelegateAdaptor(PulseAirAppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}

@MainActor
private final class PulseAirAppDelegate: NSObject, NSApplicationDelegate {
    private let monitor = HeartRateMonitor()
    private let popover = NSPopover()
    private var statusItem: NSStatusItem?
    private var animationTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)

        popover.behavior = .transient
        popover.animates = true
        popover.contentSize = NSSize(width: 276, height: 248)
        popover.contentViewController = NSHostingController(rootView: PulsePopover(monitor: monitor))

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem = item
        if let button = item.button {
            button.target = self
            button.action = #selector(togglePopover)
            button.imagePosition = .imageLeading
            button.imageHugsTitle = true
            button.title = " --"
            button.toolTip = "Pulse Air"
            button.setAccessibilityLabel("Pulse Air 心拍数 未取得")
        }

        updateStatusItem(at: Date())
        animationTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 12.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.updateStatusItem(at: Date()) }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        animationTimer?.invalidate()
    }

    @objc private func togglePopover() {
        guard let button = statusItem?.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    private func updateStatusItem(at date: Date) {
        guard let button = statusItem?.button else { return }
        let scale = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 1 : heartbeatScale(at: date)
        button.image = heartImage(scale: scale)
        button.title = " \(monitor.menuBarText)"
        button.setAccessibilityLabel(
            monitor.bpm.map { "Pulse Air 心拍数 \($0) BPM" } ?? "Pulse Air 心拍数 未取得"
        )
    }

    private func heartImage(scale: Double) -> NSImage? {
        let canvasSize = NSSize(width: 18, height: 18)
        let pointSize = 11 * scale
        let configuration = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .semibold)
        guard let symbol = NSImage(systemSymbolName: "heart.fill", accessibilityDescription: nil)?
            .withSymbolConfiguration(configuration) else { return nil }

        let canvas = NSImage(size: canvasSize)
        canvas.lockFocus()
        let rect = NSRect(
            x: (canvasSize.width - symbol.size.width) / 2,
            y: (canvasSize.height - symbol.size.height) / 2,
            width: symbol.size.width,
            height: symbol.size.height
        )
        symbol.draw(in: rect)
        canvas.unlockFocus()
        canvas.isTemplate = true
        return canvas
    }

    private func heartbeatScale(at date: Date) -> Double {
        let currentBPM = min(max(Double(monitor.bpm ?? 64), 40), 180)
        let period = 60 / currentBPM
        let phase = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period

        // 1拍の中に大きい収縮と小さい収縮を置き、自然な「ドクン、ドクン」にする。
        let firstBeat = pulse(phase, center: 0.12, width: 0.10) * 0.18
        let secondBeat = pulse(phase, center: 0.31, width: 0.08) * 0.10
        return 1 + firstBeat + secondBeat
    }

    private func pulse(_ phase: Double, center: Double, width: Double) -> Double {
        let distance = abs(phase - center)
        guard distance < width else { return 0 }
        let amount = 1 - distance / width
        return amount * amount
    }
}

private struct PulsePopover: View {
    @ObservedObject var monitor: HeartRateMonitor

    var body: some View {
        VStack(spacing: 0) {
            header
            reading
            Divider().padding(.horizontal, 18)
            controls
        }
        .frame(width: 276)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var header: some View {
        HStack {
            Label("Pulse Air", systemImage: "waveform.path.ecg")
                .font(.system(size: 13, weight: .semibold))
            Spacer()
            Circle()
                .fill(monitor.status.isConnected ? Color.mint : Color.secondary.opacity(0.45))
                .frame(width: 7, height: 7)
        }
        .padding(.horizontal, 18)
        .padding(.top, 16)
    }

    private var reading: some View {
        VStack(spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(monitor.menuBarText)
                    .font(.system(size: 58, weight: .medium, design: .rounded))
                    .monospacedDigit()
                Text("BPM")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.secondary)
            }

            Text(monitor.status.label)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)

            if let updated = monitor.lastUpdated {
                Text(updated, style: .relative)
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 128)
        .padding(.horizontal, 18)
        .padding(.vertical, 8)
    }

    private var controls: some View {
        VStack(spacing: 10) {
            if let message = monitor.errorMessage {
                Text(message)
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Button(action: monitor.status.isConnected ? monitor.disconnect : monitor.connect) {
                HStack {
                    Image(systemName: monitor.status.isConnected ? "xmark" : "dot.radiowaves.left.and.right")
                    Text(monitor.status.isConnected ? "接続を解除" : "心拍計に接続")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(monitor.status.isBusy)

            HStack {
                Text("医療用途には使用できません")
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
                Spacer()
                Button("終了") { NSApplication.shared.terminate(nil) }
                    .buttonStyle(.plain)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(18)
    }
}
