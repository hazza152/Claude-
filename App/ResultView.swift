import BraSizeCore
import SwiftUI

struct ResultView: View {
    let recommendation: BraRecommendation
    let onScanAgain: () -> Void

    private var size: BraSize { recommendation.size }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Your starting size").foregroundStyle(.secondary)
                    Text(size.uk).font(.system(size: 64, weight: .bold, design: .rounded))
                    Text("UK  ·  US \(size.us)  ·  EU \(size.eu)").foregroundStyle(.secondary)
                }

                if !size.sisterSizes.isEmpty {
                    section("Also try") {
                        Text(size.sisterSizes.map(\.uk).joined(separator: "  ·  "))
                            .font(.title3.weight(.semibold))
                        Text("Same cup volume on a different band. Go down a band if the band rides up; go up if it digs in.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }

                section("Measurements") {
                    row("Underbust", recommendation.underbustCm)
                    row("Bust", recommendation.bustCm)
                    row("Projection", recommendation.projectionCm)
                }

                section("Shape") {
                    Text(shapeAdvice)
                }

                section("Check the fit") {
                    Text("• The band sits level and snug on the loosest hook.\n• No gaping or spilling at the top of the cup.\n• The centre of the underwire lies flat against your breastbone.\n• Underwires sit behind the breast tissue at the sides, not on it.")
                }

                Text("Sizing differs between brands, so treat this as a starting point. These results are not saved.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Button(action: onScanAgain) {
                    Text("Scan again").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }
            .padding(24)
        }
    }

    private var shapeAdvice: String {
        // Rough guide only: projection relative to the cup's bust-underbust difference.
        let difference = recommendation.bustCm - recommendation.underbustCm
        guard difference > 2 else { return "A soft or lightly lined cup is likely to fit you best." }
        let ratio = recommendation.projectionCm / difference
        if ratio > 0.55 {
            return "Your bust projects forward. Look for deeper cups with narrower wires, e.g. seamed balconettes or full cups."
        } else if ratio < 0.35 {
            return "Your bust is shallower and spreads wider. Look for shallower cups with wider wires, e.g. plunges and moulded T-shirt bras."
        } else {
            return "Your bust has an even shape. Most cup styles should work; balconettes and plunges are good places to start."
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            content()
        }
    }

    private func row(_ label: String, _ cm: Double) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(String(format: "%.1f cm  (%.1f in)", cm, cm / 2.54)).monospacedDigit()
        }
    }
}
