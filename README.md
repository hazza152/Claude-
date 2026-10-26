# BraScan

A LiDAR bra-size scanner for iPhone. Someone walks around the person with the phone, the
depth frames are merged into a 3D point cloud of the body, and underbust and bust are
measured around that cloud the way a tape measure would.

Nothing leaves the phone. No photos are taken or stored: depth points live only in memory
and are discarded as soon as the measurement is made.

## Requirements

- An iPhone or iPad with LiDAR (iPhone 12 Pro or later Pro models)
- Xcode 15+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen)

```sh
brew install xcodegen
xcodegen                 # creates BraScan.xcodeproj
open BraScan.xcodeproj   # set your signing team, run on a device
swift test               # unit tests for the measuring maths (runs on a Mac)
```

## How it works

| Step | Where |
|---|---|
| Capture LiDAR depth, keep high/medium-confidence pixels on the person (ARKit person mask), back-project to world space | `App/DepthUnprojector.swift` |
| Lock on to the person, keep points within 45 cm of their vertical axis, find the floor, track how far round the phone has gone | `App/ScanSession.swift` |
| Merge frames into a 5 mm voxel cloud | `PointCloud` in `Sources/BraSizeCore/Geometry.swift` |
| Slice the torso every 5 mm, separate arms by clustering, trace a denoised outline, take its convex-hull perimeter (what a tape reads) | `Sources/BraSizeCore/TorsoMeasurer.swift` |
| Bust = height where the front sticks out furthest; underbust = where the front surface stops falling away below it | `TorsoMeasurer` |
| Convert to UK/US/EU sizes with the modern UK method, plus sister sizes | `Sources/BraSizeCore/BraSizer.swift` |

The tests build synthetic bodies (with arms, sensor noise, and arbitrary position and
rotation) and check the measurements against the known geometry.

## What still needs real data

- **`Calibration` offsets are guesses.** A snug tape reads smaller than a scan of an
  uncompressed body. Collect scans alongside professional fittings and fit
  `underbustOffsetCm` and `bustOffsetCm` to them, then use "did this size fit?"
  feedback to refine further.
- **The shape advice thresholds** in `ResultView` are placeholders and need validating.
- **Full or low-set busts:** LiDAR can't see under breast tissue, so the scan relies on an
  unpadded bra to make the fold visible.
- **Self-scanning** (phone on a stand while the person turns) would need non-rigid
  alignment between frames, because a person can't rotate as a rigid object. This version
  assumes the person stands still while a helper walks around them.

## Privacy and safety

- Over-18 confirmation before first use.
- No images are stored. Depth points stay in memory and are cleared after measuring.
- There is no networking code.
- If you later collect data for calibration, use explicit, separate opt-in consent, a
  DPIA, and store measurements only, never images.
