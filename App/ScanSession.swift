import ARKit
import BraSizeCore

/// Runs the LiDAR capture: a helper walks around the person while depth frames are merged
/// into one point cloud, which is then measured. Nothing is saved or sent anywhere; the
/// cloud is discarded as soon as the measurement is made.
final class ScanSession: NSObject, ObservableObject, ARSessionDelegate {
    enum Phase: Equatable {
        case ready
        case scanning
        case measuring
        case done(BraRecommendation)
        case failed(String)
    }

    static let sectorCount = 36

    @Published private(set) var phase: Phase = .ready
    @Published private(set) var coveredSectors = Array(repeating: false, count: ScanSession.sectorCount)
    @Published private(set) var hint = ""
    @Published private(set) var fullBodySeen = false

    let session = ARSession()

    var isReadyToMeasure: Bool {
        fullBodySeen && coveredSectors.filter { $0 }.count >= ScanSession.sectorCount - 3
    }

    static var isSupported: Bool {
        ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
    }

    // Only touched on `queue`, which is also the AR session's delegate queue.
    private let queue = DispatchQueue(label: "BraScan.capture", qos: .userInitiated)
    private let cloud = PointCloud(voxelSize: 0.005)
    private var isCapturing = false
    private var subject: SIMD3<Float>?
    private var facing: SIMD3<Float>?
    private var floorY: Float?
    private var lowestY = Float.greatestFiniteMagnitude
    private var highestY = -Float.greatestFiniteMagnitude
    private var sectors = Array(repeating: false, count: ScanSession.sectorCount)
    private var lastSample: TimeInterval = 0

    /// Only points this close to the person's vertical axis are kept.
    private let subjectRadius: Float = 0.45

    func start() {
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal]
        config.frameSemantics = [.sceneDepth]
        if ARWorldTrackingConfiguration.supportsFrameSemantics([.sceneDepth, .personSegmentation]) {
            config.frameSemantics.insert(.personSegmentation)
        }
        queue.sync {
            cloud.removeAll()
            subject = nil
            facing = nil
            floorY = nil
            lowestY = .greatestFiniteMagnitude
            highestY = -.greatestFiniteMagnitude
            sectors = Array(repeating: false, count: Self.sectorCount)
            isCapturing = true
        }
        session.delegate = self
        session.delegateQueue = queue
        session.run(config, options: [.resetTracking, .removeExistingAnchors])

        coveredSectors = Array(repeating: false, count: Self.sectorCount)
        fullBodySeen = false
        hint = "Stand about 2 m in front of them and point at the middle of their chest"
        phase = .scanning
    }

    func finish() {
        phase = .measuring
        queue.async { [self] in
            isCapturing = false
            session.pause()
            let points = cloud.points
            let floor = floorY.map { Double($0) }
            let facingPoint = facing.map { Vec3(Double($0.x), Double($0.y), Double($0.z)) }
            cloud.removeAll()

            let result: Phase
            do {
                let measurement = try TorsoMeasurer().measure(points: points, floorY: floor, facing: facingPoint)
                result = .done(BraSizer.recommend(measurement))
            } catch let error as MeasurementError {
                result = .failed(Self.explain(error))
            } catch {
                result = .failed("Something went wrong. Please scan again.")
            }
            DispatchQueue.main.async { self.phase = result }
        }
    }

    func reset() {
        session.pause()
        queue.async { [self] in
            isCapturing = false
            cloud.removeAll()
        }
        phase = .ready
    }

    // MARK: ARSessionDelegate (runs on `queue`)

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard isCapturing, frame.timestamp - lastSample > 0.2 else { return }
        guard case .normal = frame.camera.trackingState else {
            publish(hint: "Move a little slower")
            return
        }
        lastSample = frame.timestamp
        let camera = SIMD3<Float>(frame.camera.transform.columns.3.x,
                                  frame.camera.transform.columns.3.y,
                                  frame.camera.transform.columns.3.z)

        // Lock on to whoever is in the middle of the screen on the first good frame. The
        // person faces the phone at that moment, which tells the measurer where "front" is.
        if subject == nil {
            guard let center = DepthUnprojector.centerPoint(of: frame) else {
                publish(hint: "Point at the middle of their chest")
                return
            }
            subject = center
            facing = camera
        }
        guard let subject else { return }

        let radius = subjectRadius
        let floor = floorY
        let points = DepthUnprojector.worldPoints(from: frame) { p in
            let dx = p.x - subject.x, dz = p.z - subject.z
            guard dx * dx + dz * dz < radius * radius else { return false }
            if let floor { return p.y > floor + 0.02 }
            return true
        }
        for p in points {
            cloud.add(Vec3(Double(p.x), Double(p.y), Double(p.z)))
            lowestY = min(lowestY, p.y)
            highestY = max(highestY, p.y)
        }

        let angle = atan2(camera.z - subject.z, camera.x - subject.x)
        let sector = Int((angle + .pi) / (2 * .pi) * Float(Self.sectorCount)) % Self.sectorCount
        sectors[sector] = true

        let bottom = floorY ?? lowestY
        let seenWholeBody = floorY != nil && highestY - bottom > 1.3
        let covered = sectors.filter { $0 }.count
        let hint: String
        if !seenWholeBody {
            hint = "Step back until their whole body, head to feet, is on screen"
        } else if covered < Self.sectorCount - 3 {
            hint = "Come to about 1 m and walk slowly all the way round, phone at chest height"
        } else {
            hint = "All done. Tap Measure."
        }
        let snapshot = sectors
        DispatchQueue.main.async {
            self.coveredSectors = snapshot
            self.fullBodySeen = seenWholeBody
            self.hint = hint
        }
    }

    func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
        updateFloor(anchors)
    }

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        updateFloor(anchors)
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        DispatchQueue.main.async { self.phase = .failed("The camera stopped: \(error.localizedDescription)") }
    }

    private func updateFloor(_ anchors: [ARAnchor]) {
        for case let plane as ARPlaneAnchor in anchors where plane.alignment == .horizontal {
            if ARPlaneAnchor.isClassificationSupported {
                guard case .floor = plane.classification else { continue }
            }
            let y = plane.transform.columns.3.y
            // A floor is the lowest horizontal plane, and well below the chest.
            if let subject, y > subject.y - 0.8 { continue }
            floorY = min(floorY ?? y, y)
        }
    }

    private func publish(hint: String) {
        DispatchQueue.main.async { self.hint = hint }
    }

    private static func explain(_ error: MeasurementError) -> String {
        switch error {
        case .notEnoughPoints:
            return "Not enough of the body was captured. Stay within 1–2 m and keep the chest on screen."
        case .implausibleHeight:
            return "Couldn't see from head to floor. Start the scan further back so the whole body is in view."
        case .incompleteCoverage:
            return "Part of the torso was missed. Walk all the way round slowly, keeping the chest on screen."
        case .torsoNotFound:
            return "Couldn't find the bust line. Check arms are held out from the sides, then scan again."
        }
    }
}
