import Foundation

/// A point in ARKit world space, in metres. +y is up (gravity aligned).
public struct Vec3: Equatable {
    public var x: Double
    public var y: Double
    public var z: Double

    public init(_ x: Double, _ y: Double, _ z: Double) {
        self.x = x
        self.y = y
        self.z = z
    }
}

/// A point on a horizontal plane (world x and z).
public struct Vec2: Equatable {
    public var x: Double
    public var y: Double

    public init(_ x: Double, _ y: Double) {
        self.x = x
        self.y = y
    }

    static func - (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x - b.x, a.y - b.y) }
    static func + (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x + b.x, a.y + b.y) }
    static func / (a: Vec2, s: Double) -> Vec2 { Vec2(a.x / s, a.y / s) }

    func dot(_ o: Vec2) -> Double { x * o.x + y * o.y }
    var length: Double { (x * x + y * y).squareRoot() }
    var normalized: Vec2 { let l = length; return l > 0 ? self / l : self }
}

/// Accumulates points from many depth frames, averaging everything that lands in the
/// same voxel so overlapping frames don't bias the density.
public final class PointCloud {
    private struct Key: Hashable { let x: Int32, y: Int32, z: Int32 }

    public let voxelSize: Double
    private var voxels: [Key: (x: Double, y: Double, z: Double, n: Int)] = [:]

    public init(voxelSize: Double = 0.005) {
        self.voxelSize = voxelSize
    }

    public var count: Int { voxels.count }

    public func add(_ p: Vec3) {
        let key = Key(x: Int32((p.x / voxelSize).rounded(.down)),
                      y: Int32((p.y / voxelSize).rounded(.down)),
                      z: Int32((p.z / voxelSize).rounded(.down)))
        if var v = voxels[key] {
            v.x += p.x; v.y += p.y; v.z += p.z; v.n += 1
            voxels[key] = v
        } else {
            voxels[key] = (p.x, p.y, p.z, 1)
        }
    }

    public var points: [Vec3] {
        voxels.values.map { Vec3($0.x / Double($0.n), $0.y / Double($0.n), $0.z / Double($0.n)) }
    }

    public func removeAll() {
        voxels.removeAll()
    }
}

enum Planar {
    /// Convex hull (Andrew's monotone chain), counter-clockwise.
    static func convexHull(_ points: [Vec2]) -> [Vec2] {
        let pts = points.sorted { $0.x == $1.x ? $0.y < $1.y : $0.x < $1.x }
        guard pts.count > 2 else { return pts }
        func cross(_ o: Vec2, _ a: Vec2, _ b: Vec2) -> Double {
            (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
        }
        var lower: [Vec2] = []
        for p in pts {
            while lower.count >= 2 && cross(lower[lower.count - 2], lower[lower.count - 1], p) <= 0 { lower.removeLast() }
            lower.append(p)
        }
        var upper: [Vec2] = []
        for p in pts.reversed() {
            while upper.count >= 2 && cross(upper[upper.count - 2], upper[upper.count - 1], p) <= 0 { upper.removeLast() }
            upper.append(p)
        }
        return Array(lower.dropLast() + upper.dropLast())
    }

    /// The length of a closed polygon. For a convex hull this is what a tape measure
    /// reads: it bridges the hollows (e.g. between the breasts) rather than following them.
    static func perimeter(_ polygon: [Vec2]) -> Double {
        guard polygon.count > 1 else { return 0 }
        var total = 0.0
        for i in polygon.indices {
            total += (polygon[(i + 1) % polygon.count] - polygon[i]).length
        }
        return total
    }

    /// Splits points into groups whose members are linked by gaps no bigger than `link`.
    /// Used to separate the torso from the arms in each horizontal slice.
    static func clusters(_ points: [Vec2], link: Double) -> [[Vec2]] {
        struct Cell: Hashable { let x: Int, y: Int }
        var parent = Array(points.indices)
        func find(_ i: Int) -> Int {
            var i = i
            while parent[i] != i { parent[i] = parent[parent[i]]; i = parent[i] }
            return i
        }
        var grid: [Cell: [Int]] = [:]
        for (i, p) in points.enumerated() {
            grid[Cell(x: Int((p.x / link).rounded(.down)), y: Int((p.y / link).rounded(.down))), default: []].append(i)
        }
        let linkSquared = link * link
        for (cell, members) in grid {
            for dx in -1...1 {
                for dy in -1...1 {
                    guard let others = grid[Cell(x: cell.x + dx, y: cell.y + dy)] else { continue }
                    for i in members {
                        for j in others where j > i {
                            let d = points[i] - points[j]
                            if d.dot(d) <= linkSquared {
                                let a = find(i), b = find(j)
                                if a != b { parent[a] = b }
                            }
                        }
                    }
                }
            }
        }
        var groups: [Int: [Vec2]] = [:]
        for i in points.indices { groups[find(i), default: []].append(points[i]) }
        return Array(groups.values)
    }

    /// A denoised outline: the median-distance point in each angular sector around `center`.
    /// Taking a hull of raw noisy points picks up the outliers and overstates the perimeter
    /// by several cm; the median sits on the true surface.
    /// Also returns the fraction of sectors with any points; a low value means part of the
    /// body wasn't scanned.
    static func radialOutline(_ points: [Vec2], around center: Vec2, sectors: Int = 72) -> (outline: [Vec2], coverage: Double) {
        var bins = Array(repeating: [(r: Double, p: Vec2)](), count: sectors)
        for p in points {
            let d = p - center
            var angle = atan2(d.y, d.x)
            if angle < 0 { angle += 2 * .pi }
            bins[min(sectors - 1, Int(angle / (2 * .pi) * Double(sectors)))].append((d.length, p))
        }
        var outline: [Vec2] = []
        for bin in bins where !bin.isEmpty {
            let sorted = bin.sorted { $0.r < $1.r }
            let mid = sorted.count / 2
            outline.append(sorted.count % 2 == 1 ? sorted[mid].p : (sorted[mid - 1].p + sorted[mid].p) / 2)
        }
        return (outline, Double(outline.count) / Double(sectors))
    }
}
