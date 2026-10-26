import ARKit

/// Turns one LiDAR depth frame into world-space points.
enum DepthUnprojector {
    /// Back-projects every trusted depth pixel into ARKit world space (metres, +y up) and
    /// keeps those `keep` accepts. If the frame has a person mask, only pixels on a person are used.
    static func worldPoints(from frame: ARFrame, keep: (SIMD3<Float>) -> Bool) -> [SIMD3<Float>] {
        guard let depth = frame.sceneDepth, let confidence = depth.confidenceMap else { return [] }
        let depthMap = depth.depthMap
        let mask = frame.segmentationBuffer

        CVPixelBufferLockBaseAddress(depthMap, .readOnly)
        CVPixelBufferLockBaseAddress(confidence, .readOnly)
        if let mask { CVPixelBufferLockBaseAddress(mask, .readOnly) }
        defer {
            CVPixelBufferUnlockBaseAddress(depthMap, .readOnly)
            CVPixelBufferUnlockBaseAddress(confidence, .readOnly)
            if let mask { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
        }

        let width = CVPixelBufferGetWidth(depthMap)
        let height = CVPixelBufferGetHeight(depthMap)
        guard let depthBase = CVPixelBufferGetBaseAddress(depthMap),
              let confidenceBase = CVPixelBufferGetBaseAddress(confidence) else { return [] }
        let depthStride = CVPixelBufferGetBytesPerRow(depthMap)
        let confidenceStride = CVPixelBufferGetBytesPerRow(confidence)

        let maskBase = mask.flatMap { CVPixelBufferGetBaseAddress($0) }?.assumingMemoryBound(to: UInt8.self)
        let maskWidth = mask.map(CVPixelBufferGetWidth) ?? 0
        let maskHeight = mask.map(CVPixelBufferGetHeight) ?? 0
        let maskStride = mask.map(CVPixelBufferGetBytesPerRow) ?? 0

        // Intrinsics are for the full-size camera image; scale them to the depth map.
        let image = frame.camera.imageResolution
        let sx = Float(width) / Float(image.width)
        let sy = Float(height) / Float(image.height)
        let k = frame.camera.intrinsics
        let fx = k[0][0] * sx, fy = k[1][1] * sy
        let cx = k[2][0] * sx, cy = k[2][1] * sy
        let cameraToWorld = frame.camera.transform
        let minConfidence = UInt8(ARConfidenceLevel.medium.rawValue)

        var points: [SIMD3<Float>] = []
        points.reserveCapacity(width * height / 4)
        for v in 0..<height {
            let depthRow = (depthBase + v * depthStride).assumingMemoryBound(to: Float32.self)
            let confidenceRow = (confidenceBase + v * confidenceStride).assumingMemoryBound(to: UInt8.self)
            for u in 0..<width {
                guard confidenceRow[u] >= minConfidence else { continue }
                let d = depthRow[u]
                guard d > 0.2, d < 3.0 else { continue }
                if let maskBase {
                    let mu = u * maskWidth / width, mv = v * maskHeight / height
                    guard maskBase[mv * maskStride + mu] != 0 else { continue }
                }
                // Image coordinates have y down; ARKit camera space has y up and looks down -z.
                let local = SIMD4<Float>((Float(u) + 0.5 - cx) * d / fx,
                                         -(Float(v) + 0.5 - cy) * d / fy,
                                         -d, 1)
                let world = cameraToWorld * local
                let p = SIMD3<Float>(world.x, world.y, world.z)
                if keep(p) { points.append(p) }
            }
        }
        return points
    }

    /// The world point under the centre of the screen, if the depth there is trustworthy.
    static func centerPoint(of frame: ARFrame) -> SIMD3<Float>? {
        var closest: SIMD3<Float>?
        var best = Float.greatestFiniteMagnitude
        let cameraPosition = frame.camera.transform.columns.3
        let axis = SIMD3<Float>(cameraPosition.x, cameraPosition.y, cameraPosition.z)
        let forward = -SIMD3<Float>(frame.camera.transform.columns.2.x,
                                    frame.camera.transform.columns.2.y,
                                    frame.camera.transform.columns.2.z)
        // Of the points near the camera's line of sight, take the nearest one.
        for p in worldPoints(from: frame, keep: { _ in true }) {
            let toPoint = p - axis
            let along = simd_dot(toPoint, forward)
            guard along > 0.4, along < 2.5 else { continue }
            let offAxis = simd_length(toPoint - along * forward)
            if offAxis < 0.05 && along < best {
                best = along
                closest = p
            }
        }
        return closest
    }
}
