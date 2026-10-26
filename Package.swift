// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "BraSizeCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "BraSizeCore", targets: ["BraSizeCore"]),
    ],
    targets: [
        .target(name: "BraSizeCore"),
        .testTarget(name: "BraSizeCoreTests", dependencies: ["BraSizeCore"]),
    ]
)
