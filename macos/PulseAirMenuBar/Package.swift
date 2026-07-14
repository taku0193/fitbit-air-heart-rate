// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PulseAirMenuBar",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "PulseAirMenuBar", targets: ["PulseAirMenuBar"]),
        .executable(name: "PulseAirMenuBarSelfTest", targets: ["PulseAirMenuBarSelfTest"])
    ],
    targets: [
        .target(name: "PulseAirCore"),
        .executableTarget(name: "PulseAirMenuBar", dependencies: ["PulseAirCore"]),
        .executableTarget(name: "PulseAirMenuBarSelfTest", dependencies: ["PulseAirCore"])
    ]
)
