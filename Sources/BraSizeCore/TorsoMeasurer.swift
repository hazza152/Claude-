import Foundation

public struct TorsoMeasurement: Equatable {
    /// Raw circumference just below the breasts, as the scan sees it (cm).
    public let underbustCm: Double
    /// Raw circumference across the bust apex, bridging the gap between the breasts (cm).
    public let bustCm: Double
    /// How far the bust projects forward of the ribcage (cm).
    public let projectionCm: Double
    /// Heights above the floor (m), useful for showing where the "tape" went.
    public let underbustHeight: Double
    public let bustHeight: Double
    public let stature: Double
    /// Worst angular coverage of the two measured slices (0...1).
    public let coverage: Double
}

public enum MeasurementError: Error, Equatable {
    case notEnoughPoints(Int)
    case implausibleHeight(Double)
    /// Part of the torso wasn't scanned; the value is the coverage achieved (0...1).
    case incompleteCoverage(Double)
    case torsoNotFound
}

/// Measures underbust and bust circumferences from a point cloud of a standing person.
///
/// The cloud is cut into thin horizontal slices. In each slice the torso is separated from
/// the arms by clustering, and its convex hull perimeter is taken as the tape-measure
/// reading. The bust is the height where the front of the torso sticks out furthest; the
/// underbust is where the front surface stops falling away below it (the inframammary fold).
public struct TorsoMeasurer {
    public var sliceThickness = 0.008
    public var sliceStep = 0.005
    /// Points closer than this belong to the same body part. Arms must be held further
    /// than this from the torso (about 45° out from the sides is plenty).
    public var clusterLink = 0.035
    /// Where to look for the chest, as fractions of standing height above the floor.
    public var searchRange: ClosedRange<Double> = 0.58...0.80
    public var bustRange: ClosedRange<Double> = 0.64...0.78
    /// Furthest the underbust can sit below the bust apex (m).
    public var maxFoldDrop = 0.16
    /// Below the fold the front surface is near vertical; on the underside of the breast it
    /// recedes fast. This is the forward-change-per-height boundary between the two.
    public var foldSlope = 0.3
    public var minCoverage = 0.85
    public var minimumPoints = 2_000

    public init() {}

    private struct Slice {
        let height: Double
        /// Denoised torso outline in this slice.
        let points: [Vec2]
        let perimeter: Double
        let centroid: Vec2
        let coverage: Double
    }

    /// - Parameters:
    ///   - floorY: world height of the floor, if ARKit found it. Otherwise the lowest point is used.
    ///   - facing: any world point in front of the person (e.g. where the camera started).
    ///     Without it the front is inferred from the shape of the torso.
    public func measure(points: [Vec3], floorY: Double? = nil, facing: Vec3? = nil) throws -> TorsoMeasurement {
        guard points.count >= minimumPoints else { throw MeasurementError.notEnoughPoints(points.count) }

        let floor = floorY ?? points.map(\.y).min()!
        let top = points.map(\.y).max()!
        let stature = top - floor
        guard (1.2...2.2).contains(stature) else { throw MeasurementError.implausibleHeight(stature) }

        let slices = makeSlices(points, from: floor + searchRange.lowerBound * stature,
                                to: floor + searchRange.upperBound * stature)
        let usable = slices.filter { $0.coverage >= minCoverage }
        guard usable.count >= 10 else {
            throw MeasurementError.incompleteCoverage(slices.map(\.coverage).max() ?? 0)
        }

        // A fixed vertical axis through the torso; front extents are measured from it.
        let axis = usable.reduce(Vec2(0, 0)) { $0 + $1.centroid } / Double(usable.count)
        let front = frontDirection(slices: usable, axis: axis, facing: facing)

        let anterior = smooth(slices.map { s in s.points.map { ($0 - axis).dot(front) }.max() ?? 0 })
        let perimeter = smooth(slices.map(\.perimeter))

        let bustWindow = slices.indices.filter {
            bustRange.contains((slices[$0].height - floor) / stature) && slices[$0].coverage >= minCoverage
        }
        guard let bust = bustWindow.max(by: { anterior[$0] < anterior[$1] }) else {
            throw MeasurementError.torsoNotFound
        }

        let underbust = foldIndex(below: bust, slices: slices, anterior: anterior)
            ?? fallbackUnderbust(below: bust, slices: slices, perimeter: perimeter)
        guard let underbust else { throw MeasurementError.torsoNotFound }

        let coverage = min(slices[bust].coverage, slices[underbust].coverage)
        guard coverage >= minCoverage else { throw MeasurementError.incompleteCoverage(coverage) }

        return TorsoMeasurement(
            underbustCm: perimeter[underbust] * 100,
            bustCm: perimeter[bust] * 100,
            projectionCm: (anterior[bust] - anterior[underbust]) * 100,
            underbustHeight: slices[underbust].height - floor,
            bustHeight: slices[bust].height - floor,
            stature: stature,
            coverage: coverage
        )
    }

    private func makeSlices(_ points: [Vec3], from low: Double, to high: Double) -> [Slice] {
        let half = sliceThickness / 2
        let band = points.filter { $0.y >= low - half && $0.y <= high + half }.sorted { $0.y < $1.y }
        var slices: [Slice] = []
        var start = 0
        var y = low
        while y <= high {
            while start < band.count && band[start].y < y - half { start += 1 }
            var flat: [Vec2] = []
            var i = start
            while i < band.count && band[i].y <= y + half {
                flat.append(Vec2(band[i].x, band[i].z))
                i += 1
            }
            // The torso is the biggest connected blob at chest height; arms are smaller.
            let torso = Planar.clusters(flat, link: clusterLink).max { $0.count < $1.count } ?? []
            if torso.count >= 20 {
                let centroid = torso.reduce(Vec2(0, 0), +) / Double(torso.count)
                let (outline, coverage) = Planar.radialOutline(torso, around: centroid)
                slices.append(Slice(height: y,
                                    points: outline,
                                    perimeter: Planar.perimeter(Planar.convexHull(outline)),
                                    centroid: centroid,
                                    coverage: coverage))
            }
            y += sliceStep
        }
        return slices
    }

    private func frontDirection(slices: [Slice], axis: Vec2, facing: Vec3?) -> Vec2 {
        if let facing {
            let d = Vec2(facing.x, facing.z) - axis
            if d.length > 0.1 { return d.normalized }
        }
        // The ribcage is wider than it is deep, so the front lies along the short axis of
        // the lowest slice. Pick whichever end of that axis has the bigger bulge above it.
        let ribs = slices[0].points
        var sxx = 0.0, syy = 0.0, sxy = 0.0
        for p in ribs {
            let d = p - axis
            sxx += d.x * d.x; syy += d.y * d.y; sxy += d.x * d.y
        }
        let majorAngle = 0.5 * atan2(2 * sxy, sxx - syy)
        let minor = Vec2(-sin(majorAngle), cos(majorAngle))
        func bulge(_ dir: Vec2) -> Double {
            let extents = slices.map { s in s.points.map { ($0 - axis).dot(dir) }.max() ?? 0 }
            return (extents.max() ?? 0) - (extents.min() ?? 0)
        }
        let opposite = Vec2(-minor.x, -minor.y)
        return bulge(minor) >= bulge(opposite) ? minor : opposite
    }

    /// Walk down from the apex until the front surface stops receding quickly.
    private func foldIndex(below bust: Int, slices: [Slice], anterior: [Double]) -> Int? {
        let lowest = slices[bust].height - maxFoldDrop
        var i = bust
        var leftBreast = false
        while i > 0 && slices[i - 1].height >= lowest {
            let slope = (anterior[i] - anterior[i - 1]) / (slices[i].height - slices[i - 1].height)
            if slope > foldSlope {
                leftBreast = true
            } else if leftBreast {
                return i - 1
            }
            i -= 1
        }
        return nil
    }

    private func fallbackUnderbust(below bust: Int, slices: [Slice], perimeter: [Double]) -> Int? {
        let window = slices.indices.filter {
            let drop = slices[bust].height - slices[$0].height
            return drop >= 0.04 && drop <= 0.14 && slices[$0].coverage >= minCoverage
        }
        return window.min { perimeter[$0] < perimeter[$1] }
    }

    private func smooth(_ values: [Double]) -> [Double] {
        values.indices.map { i in
            let lo = max(0, i - 2), hi = min(values.count - 1, i + 2)
            return values[lo...hi].reduce(0, +) / Double(hi - lo + 1)
        }
    }
}
