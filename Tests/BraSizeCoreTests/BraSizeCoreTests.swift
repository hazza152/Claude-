import XCTest
@testable import BraSizeCore

/// Deterministic noise so the tests don't flake.
private struct NoiseSource {
    var state: UInt64 = 42
    /// Uniform in -amplitude...amplitude.
    mutating func next(_ amplitude: Double) -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return (Double(state >> 11) / Double(1 << 53) * 2 - 1) * amplitude
    }
}

/// A crude standing body: elliptical torso facing +z, two breasts, arms held away from the
/// sides, and thin columns for legs and head so the standing height is right.
private func syntheticBody(stature: Double = 1.65,
                           ribHalfWidth: Double = 0.135,
                           ribHalfDepth: Double = 0.095,
                           bustProjection: Double = 0.06,
                           breastRadius: Double = 0.075,
                           armGap: Double = 0.07,
                           noise: Double = 0) -> (points: [Vec3], ribPerimeterCm: Double, bustHeight: Double) {
    let bustHeight = 0.715 * stature
    var rng = NoiseSource()
    var points: [Vec3] = []
    var y = 0.55 * stature
    while y <= 0.82 * stature {
        for step in 0..<720 {
            let t = Double(step) / 2 * .pi / 180
            var x = ribHalfWidth * cos(t)
            var z = ribHalfDepth * sin(t)
            if z > 0 {
                // Push the front surface forward over each breast, fading out towards the sides.
                for cx in [-0.085, 0.085] {
                    let d2 = ((x - cx) * (x - cx) + (y - bustHeight) * (y - bustHeight)) / (breastRadius * breastRadius)
                    if d2 < 1 {
                        z = max(z, (ribHalfDepth + bustProjection * (1 - d2).squareRoot()) * sin(t))
                    }
                }
            }
            points.append(Vec3(x + rng.next(noise), y, z + rng.next(noise)))
            // Arms: small circles beside the torso.
            if step % 20 == 0 {
                let r = 0.04
                for side in [-1.0, 1.0] {
                    x = side * (ribHalfWidth + armGap + r) + r * cos(t * 10)
                    points.append(Vec3(x, y, r * sin(t * 10)))
                }
            }
        }
        y += 0.003
    }
    // Legs and head, just to set the floor and top.
    var h = 0.0
    while h < stature {
        if h < 0.55 * stature || h > 0.82 * stature {
            points.append(Vec3(0.08, h, 0))
            points.append(Vec3(-0.08, h, 0))
        }
        h += 0.01
    }
    points.append(Vec3(0, stature, 0))
    // Ramanujan's ellipse perimeter.
    let a = ribHalfWidth, b = ribHalfDepth
    let ribPerimeter = Double.pi * (3 * (a + b) - ((3 * a + b) * (a + 3 * b)).squareRoot())
    return (points, ribPerimeter * 100, bustHeight)
}

final class TorsoMeasurerTests: XCTestCase {
    func testMeasuresSyntheticTorso() throws {
        let body = syntheticBody()
        let m = try TorsoMeasurer().measure(points: body.points, facing: Vec3(0, 1.2, 2))

        XCTAssertEqual(m.stature, 1.65, accuracy: 0.01)
        XCTAssertEqual(m.bustHeight, body.bustHeight, accuracy: 0.015)
        XCTAssertEqual(m.underbustCm, body.ribPerimeterCm, accuracy: 0.5)
        XCTAssertGreaterThan(m.bustCm, m.underbustCm + 7)
        // Furthest-forward point of the model is 4.26 cm in front of the ribcage.
        XCTAssertEqual(m.projectionCm, 4.26, accuracy: 0.5)
        XCTAssertLessThan(m.bustHeight - m.underbustHeight, 0.1)
    }

    func testToleratesSensorNoise() throws {
        let clean = try TorsoMeasurer().measure(points: syntheticBody().points)
        let body = syntheticBody(noise: 0.005)
        let m = try TorsoMeasurer().measure(points: body.points)
        XCTAssertEqual(m.underbustCm, body.ribPerimeterCm, accuracy: 1.0)
        XCTAssertEqual(m.bustCm, clean.bustCm, accuracy: 1.0)
    }

    func testRotatedAndOffsetBody() throws {
        let angle = 130.0 * .pi / 180
        let moved = syntheticBody().points.map {
            Vec3($0.x * cos(angle) - $0.z * sin(angle) + 1.3, $0.y - 0.4, $0.x * sin(angle) + $0.z * cos(angle) - 2.1)
        }
        let m = try TorsoMeasurer().measure(points: moved)
        let reference = try TorsoMeasurer().measure(points: syntheticBody().points)
        XCTAssertEqual(m.underbustCm, reference.underbustCm, accuracy: 0.3)
        XCTAssertEqual(m.bustCm, reference.bustCm, accuracy: 0.3)
    }

    func testInfersFrontWithoutHint() throws {
        let body = syntheticBody()
        let withHint = try TorsoMeasurer().measure(points: body.points, facing: Vec3(0, 1.2, 2))
        let without = try TorsoMeasurer().measure(points: body.points)
        XCTAssertEqual(withHint.bustCm, without.bustCm, accuracy: 0.5)
        XCTAssertEqual(withHint.underbustCm, without.underbustCm, accuracy: 0.5)
    }

    func testRejectsHalfScannedTorso() {
        let back = syntheticBody().points.filter { $0.z < 0 || $0.y < 0.5 || $0.y > 1.4 }
        XCTAssertThrowsError(try TorsoMeasurer().measure(points: back))
    }

    func testVoxelCloudMergesDuplicates() {
        let cloud = PointCloud(voxelSize: 0.01)
        cloud.add(Vec3(0.001, 0.001, 0.001))
        cloud.add(Vec3(0.003, 0.003, 0.003))
        cloud.add(Vec3(0.5, 0.5, 0.5))
        XCTAssertEqual(cloud.count, 2)
    }
}

final class BraSizerTests: XCTestCase {
    func testModernUKMethod() {
        // 30.5" underbust, 36" bust -> 30 band, 6" difference -> E.
        let size = BraSizer.size(underbustCm: 30.5 * 2.54, bustCm: 36 * 2.54)
        XCTAssertEqual(size.uk, "30E")
        XCTAssertEqual(size.us, "30DDD")
        XCTAssertEqual(size.eu, "65F")
    }

    func testSmallAndEqualMeasurements() {
        XCTAssertEqual(BraSizer.size(underbustCm: 34 * 2.54, bustCm: 34 * 2.54).uk, "34AA")
        XCTAssertEqual(BraSizer.size(underbustCm: 32 * 2.54, bustCm: 35 * 2.54).uk, "32C")
    }

    func testSisterSizes() {
        let sisters = BraSize(band: 32, cupIndex: 6).sisterSizes.map(\.uk)
        XCTAssertEqual(sisters, ["30F", "34DD"])
    }

    func testCalibrationApplied() {
        let m = TorsoMeasurement(underbustCm: 78.7, bustCm: 91.7, projectionCm: 6,
                                 underbustHeight: 1.1, bustHeight: 1.18, stature: 1.65, coverage: 1)
        let rec = BraSizer.recommend(m)
        XCTAssertEqual(rec.underbustCm, 77.2, accuracy: 0.01)
        XCTAssertEqual(rec.size.uk, "30E")
    }
}
