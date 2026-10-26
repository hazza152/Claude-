import SwiftUI

@main
struct BraScanApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @AppStorage("confirmedAdult") private var confirmedAdult = false
    @StateObject private var scan = ScanSession()

    var body: some View {
        if !confirmedAdult {
            AgeGateView { confirmedAdult = true }
        } else if !ScanSession.isSupported {
            MessageView(title: "LiDAR needed",
                        message: "This scanner needs an iPhone or iPad with a LiDAR sensor (iPhone 12 Pro or later Pro models).")
        } else {
            switch scan.phase {
            case .ready:
                IntroView { scan.start() }
            case .scanning:
                ScanView(scan: scan)
            case .measuring:
                ProgressView("Measuring…")
            case .done(let recommendation):
                ResultView(recommendation: recommendation) { scan.reset() }
            case .failed(let reason):
                MessageView(title: "Let's try that again", message: reason, action: ("Scan again", { scan.reset() }))
            }
        }
    }
}

struct AgeGateView: View {
    let onConfirm: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text("BraScan").font(.largeTitle.bold())
            Text("This app scans your body shape with the camera. You need to be 18 or over to use it.")
                .multilineTextAlignment(.center)
            Text("The scan is processed on this phone only. No photos are taken or stored, and nothing is uploaded.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Spacer()
            Button("I'm 18 or over", action: onConfirm)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
        .padding(32)
    }
}

struct IntroView: View {
    let onStart: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Before you scan").font(.largeTitle.bold())
                step(1, "Wear an unpadded, unlined bra or a thin fitted top", "Padding, push-up and loose tops all throw off the measurement.")
                step(2, "Stand still with your arms held out about 45°", "There needs to be a clear gap between your arms and your sides. Breathe normally.")
                step(3, "Ask someone to hold the phone", "They start about 2 m in front of you so you're fully in view, then come to about 1 m and walk slowly all the way around you.")
                step(4, "Keep the space around you clear", "Stand at least a metre from walls and furniture.")
                Label("Everything stays on this phone. No images are saved or sent anywhere.", systemImage: "lock.fill")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button(action: onStart) {
                    Text("Start scan").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .padding(24)
        }
    }

    private func step(_ number: Int, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text("\(number)")
                .font(.headline)
                .frame(width: 30, height: 30)
                .background(Circle().fill(Color.accentColor.opacity(0.15)))
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(detail).foregroundStyle(.secondary)
            }
        }
    }
}

struct MessageView: View {
    let title: String
    let message: String
    var action: (String, () -> Void)? = nil

    var body: some View {
        VStack(spacing: 16) {
            Text(title).font(.title2.bold())
            Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary)
            if let action {
                Button(action.0, action: action.1).buttonStyle(.borderedProminent)
            }
        }
        .padding(32)
    }
}
