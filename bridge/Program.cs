using System.Runtime.InteropServices;

namespace SonicMamboBridge;

internal static class Program
{
    private const int DefaultPort = 17420;

    public static async Task<int> Main(string[] args)
    {
        bool checkOnly = args.Contains("--check", StringComparer.OrdinalIgnoreCase);

        Console.Title = "SonicMambo Native ASIO Bridge";
        Console.WriteLine("==========================================================");
        Console.WriteLine("  SonicMambo Native ASIO Audio Bridge (x64 Zero-GC Core)");
        Console.WriteLine("==========================================================");

        var drivers = AsioHost.EnumerateDrivers();
        if (drivers.Count == 0)
        {
            Console.WriteLine("[!] No ASIO drivers found in HKLM\\SOFTWARE\\ASIO.");
        }
        else
        {
            Console.WriteLine($"[+] Discovered {drivers.Count} ASIO driver(s):");
            foreach (var d in drivers)
            {
                Console.WriteLine($"    - {d.Name} ({d.Clsid})");
            }
        }

        using var audioCore = new RealTimeAudioCore();
        using var asio = new AsioHost(audioCore);
        var pitchEngine = new MpmPitchEngine();

        // Prefer USB ASIO interface first (e.g. Focusrite USB ASIO over Thunderbolt stub)
        var preferred = drivers
            .OrderByDescending(d => d.Name.Contains("USB", StringComparison.OrdinalIgnoreCase))
            .ToList();

        foreach (var candidate in preferred)
        {
            Console.WriteLine($"[*] Opening ASIO driver: {candidate.Name} ...");
            if (asio.StartDriver(candidate))
            {
                Console.WriteLine(
                    $"[OK] ASIO Active: {asio.DriverName} | {asio.SampleRate:F0} Hz | " +
                    $"{asio.BufferSize} samples | RTL: {asio.RoundTripLatencyMs:F2} ms " +
                    $"({asio.InputChannels} in / {asio.OutputChannels} out)");
                break;
            }
            else
            {
                Console.WriteLine($"[-] {asio.LastError}");
            }
        }

        if (checkOnly)
        {
            return 0;
        }

        using var server = new BridgeWebSocketServer(DefaultPort, asio, audioCore, pitchEngine, drivers);
        server.Start();
        Console.WriteLine($"[+] Localhost WebSocket ready at ws://127.0.0.1:{DefaultPort} (TCP_NODELAY=1)");
        Console.WriteLine("[*] Open SonicMambo in Chrome — it will auto-connect to ASIO.");
        Console.WriteLine("    Press Ctrl+C to quit.\n");

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        var dryChunk = new float[2048];
        var packetFloats = new float[9];
        var packetBytes = new byte[36];
        double lastSentMs = -100;
        float lastSentMidi = -999;

        try
        {
            while (!cts.IsCancellationRequested)
            {
                if (asio.IsRunning)
                {
                    int n = audioCore.ReadDrySamples(dryChunk);
                    if (n > 0)
                    {
                        var frames = pitchEngine.PushSamples(
                            dryChunk.AsSpan(0, n),
                            asio.SampleRate,
                            audioCore.AudioTimeMs);

                        if (server.ClientCount > 0 && frames.Count > 0)
                        {
                            var latest = frames[^1];
                            float midiVal = latest.Midi ?? -1f;
                            bool pitchChanged = MathF.Abs(midiVal - lastSentMidi) >= 0.4f;

                            if (pitchChanged || (latest.TimeMs - lastSentMs) >= 8.0)
                            {
                                lastSentMs = latest.TimeMs;
                                lastSentMidi = midiVal;

                                packetFloats[0] = 1.0f; // magic = pitch telemetry
                                packetFloats[1] = (float)latest.TimeMs;
                                packetFloats[2] = latest.Rms;
                                packetFloats[3] = latest.RawHz ?? 0f;
                                packetFloats[4] = latest.SmoothedHz ?? 0f;
                                packetFloats[5] = midiVal;
                                packetFloats[6] = latest.Confidence;
                                packetFloats[7] = latest.TuningOffsetCents;
                                packetFloats[8] = audioCore.ActiveInputChannel;

                                MemoryMarshal.AsBytes(packetFloats.AsSpan()).CopyTo(packetBytes);
                                await server.BroadcastBinaryTelemetryAsync(packetBytes);
                            }
                        }
                        continue;
                    }
                }

                await Task.Delay(3, cts.Token);
            }
        }
        catch (OperationCanceledException)
        {
            // normal shutdown
        }

        Console.WriteLine("Shutting down ASIO bridge...");
        return 0;
    }
}
