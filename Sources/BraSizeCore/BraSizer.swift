import Foundation

public struct BraSize: Equatable, Hashable {
    /// UK/US band in inches (28, 30, 32, ...).
    public let band: Int
    /// 0 = AA, 1 = A, 2 = B, ... one step per inch of bust-band difference.
    public let cupIndex: Int

    public init(band: Int, cupIndex: Int) {
        self.band = band
        self.cupIndex = cupIndex
    }

    static let ukCups = ["AA", "A", "B", "C", "D", "DD", "E", "F", "FF", "G", "GG", "H", "HH", "J", "JJ", "K", "KK", "L"]
    static let usCups = ["AA", "A", "B", "C", "D", "DD", "DDD", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q"]
    static let euCups = ["AA", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q"]

    public var isInRange: Bool { BraSize.ukCups.indices.contains(cupIndex) && (26...56).contains(band) }

    public var uk: String { "\(band)\(Self.cup(Self.ukCups, cupIndex))" }
    public var us: String { "\(band)\(Self.cup(Self.usCups, cupIndex))" }
    /// EU bands step by 5 cm: UK 32 = EU 70.
    public var eu: String { "\(70 + (band - 32) / 2 * 5)\(Self.cup(Self.euCups, cupIndex))" }

    /// Same cup volume on a looser and a tighter band.
    public var sisterSizes: [BraSize] {
        [BraSize(band: band - 2, cupIndex: cupIndex + 1), BraSize(band: band + 2, cupIndex: cupIndex - 1)]
            .filter(\.isInRange)
    }

    private static func cup(_ table: [String], _ index: Int) -> String {
        table.indices.contains(index) ? table[index] : "?"
    }
}

/// Converts scanned circumferences into what a fitter's tape would read.
/// These defaults are starting guesses; replace them with values fitted to real fittings.
public struct Calibration: Equatable {
    /// A snug tape compresses soft tissue under the bust; the scan doesn't.
    public var underbustOffsetCm = -1.5
    /// Thickness of the top or bra worn during the scan.
    public var bustOffsetCm = -0.3

    public init() {}
}

public struct BraRecommendation: Equatable {
    public let size: BraSize
    public let sisterSizes: [BraSize]
    public let underbustCm: Double
    public let bustCm: Double
    public let projectionCm: Double
}

public enum BraSizer {
    /// Modern UK method: band is the snug underbust rounded to the nearest even inch (no "+4"),
    /// and every inch the bust exceeds the band is one cup size.
    public static func size(underbustCm: Double, bustCm: Double) -> BraSize {
        let underbust = underbustCm / 2.54
        let bust = bustCm / 2.54
        let band = Int((underbust / 2).rounded()) * 2
        let cup = max(0, Int((bust - Double(band)).rounded()))
        return BraSize(band: band, cupIndex: cup)
    }

    public static func recommend(_ m: TorsoMeasurement, calibration: Calibration = Calibration()) -> BraRecommendation {
        let underbust = m.underbustCm + calibration.underbustOffsetCm
        let bust = m.bustCm + calibration.bustOffsetCm
        let size = size(underbustCm: underbust, bustCm: bust)
        return BraRecommendation(size: size, sisterSizes: size.sisterSizes,
                                 underbustCm: underbust, bustCm: bust, projectionCm: m.projectionCm)
    }
}
