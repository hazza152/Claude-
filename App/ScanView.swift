import ARKit
import SwiftUI

struct ScanView: View {
    @ObservedObject var scan: ScanSession

    var body: some View {
        ZStack {
            CameraPreview(session: scan.session).ignoresSafeArea()

            // Crosshair: the person's chest goes here when the scan starts.
            Image(systemName: "plus")
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(.white)

            VStack {
                Text(scan.hint)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .padding(12)
                    .frame(maxWidth: .infinity)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
                    .padding()

                Spacer()

                HStack(alignment: .center, spacing: 20) {
                    CoverageRing(sectors: scan.coveredSectors)
                        .frame(width: 84, height: 84)
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Whole body", systemImage: scan.fullBodySeen ? "checkmark.circle.fill" : "circle")
                        Label("All the way round", systemImage: scan.isReadyToMeasure ? "checkmark.circle.fill" : "circle")
                    }
                    .font(.subheadline)
                    Spacer()
                }
                .padding()
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
                .padding(.horizontal)

                HStack {
                    Button("Cancel") { scan.reset() }
                        .buttonStyle(.bordered)
                    Spacer()
                    Button("Measure") { scan.finish() }
                        .buttonStyle(.borderedProminent)
                        .disabled(!scan.isReadyToMeasure)
                }
                .controlSize(.large)
                .padding()
            }
        }
    }
}

/// One arc per 10° around the person; green once the phone has been there.
struct CoverageRing: View {
    let sectors: [Bool]

    var body: some View {
        ZStack {
            ForEach(sectors.indices, id: \.self) { i in
                let span = 1.0 / Double(sectors.count)
                Circle()
                    .trim(from: Double(i) * span + 0.004, to: Double(i + 1) * span - 0.004)
                    .stroke(sectors[i] ? Color.green : Color.white.opacity(0.3),
                            style: StrokeStyle(lineWidth: 10, lineCap: .butt))
            }
        }
        .padding(5)
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.session = session
        view.automaticallyUpdatesLighting = false
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {}
}
