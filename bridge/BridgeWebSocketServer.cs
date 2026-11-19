using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SonicMamboBridge;

public sealed class BridgeWebSocketServer : IDisposable
{
    private const string WsGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    private readonly int _port;
    private readonly AsioHost _asio;
    private readonly RealTimeAudioCore _core;
    private readonly MpmPitchEngine _pitch;
    private List<AsioDriverEntry> _drivers;

    private TcpListener? _listener;
    private readonly CancellationTokenSource _cts = new();
    private readonly ConcurrentDictionary<Guid, WebSocket> _clients = new();

    public int ClientCount => _clients.Count;

    public BridgeWebSocketServer(
        int port,
        AsioHost asio,
        RealTimeAudioCore core,
        MpmPitchEngine pitch,
        List<AsioDriverEntry> drivers)
    {
        _port = port;
        _asio = asio;
        _core = core;
        _pitch = pitch;
        _drivers = drivers;
    }

    public void Start()
    {
        _listener = new TcpListener(IPAddress.Loopback, _port);
        _listener.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
        _listener.Start();
        _ = Task.Run(() => AcceptLoopAsync(_cts.Token));
    }

    public async Task BroadcastBinaryTelemetryAsync(ReadOnlyMemory<byte> payload)
    {
        if (_clients.IsEmpty) return;
        foreach (var kv in _clients)
        {
            var ws = kv.Value;
            if (ws.State != WebSocketState.Open)
            {
                _clients.TryRemove(kv.Key, out _);
                continue;
            }
            try
            {
                await ws.SendAsync(payload, WebSocketMessageType.Binary, true, _cts.Token);
            }
            catch
            {
                _clients.TryRemove(kv.Key, out _);
            }
        }
    }

    public async Task BroadcastStatusAsync()
    {
        var json = BuildStatusJson();
        var bytes = Encoding.UTF8.GetBytes(json);
        foreach (var kv in _clients)
        {
            if (kv.Value.State == WebSocketState.Open)
            {
                try
                {
                    await kv.Value.SendAsync(bytes, WebSocketMessageType.Text, true, _cts.Token);
                }
                catch
                {
                    _clients.TryRemove(kv.Key, out _);
                }
            }
        }
    }

    private string BuildStatusJson()
    {
        var payload = new
        {
            type = "status",
            asioConnected = _asio.IsRunning,
            driverName = _asio.DriverName,
            availableDrivers = _drivers.Select(d => d.Name).ToArray(),
            sampleRate = _asio.SampleRate,
            bufferSize = _asio.BufferSize,
            latencyMs = Math.Round(_asio.RoundTripLatencyMs, 2),
            inputChannels = _asio.InputChannels,
            activeChannel = _core.ActiveInputChannel,
            error = _asio.LastError,
        };
        return JsonSerializer.Serialize(payload);
    }

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener != null)
        {
            try
            {
                var tcp = await _listener.AcceptTcpClientAsync(ct);
                tcp.NoDelay = true; // Sub-0.2ms loopback delivery!
                _ = Task.Run(() => HandleClientAsync(tcp, ct), ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                // ignore transient socket error
            }
        }
    }

    private async Task HandleClientAsync(TcpClient tcp, CancellationToken ct)
    {
        using (tcp)
        {
            var stream = tcp.GetStream();
            var headerBuf = new byte[4096];
            int totalRead = 0;

            while (totalRead < headerBuf.Length)
            {
                int r = await stream.ReadAsync(headerBuf.AsMemory(totalRead, headerBuf.Length - totalRead), ct);
                if (r <= 0) return;
                totalRead += r;
                var textSoFar = Encoding.ASCII.GetString(headerBuf, 0, totalRead);
                if (textSoFar.Contains("\r\n\r\n", StringComparison.Ordinal))
                {
                    await ProcessHttpHandshakeAsync(stream, textSoFar, ct);
                    return;
                }
            }
        }
    }

    private async Task ProcessHttpHandshakeAsync(NetworkStream stream, string reqText, CancellationToken ct)
    {
        var lines = reqText.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length == 0) return;

        // Handle CORS / Private Network Access preflight
        if (lines[0].StartsWith("OPTIONS ", StringComparison.OrdinalIgnoreCase))
        {
            var preflight =
                "HTTP/1.1 204 No Content\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Access-Control-Allow-Methods: GET, OPTIONS\r\n" +
                "Access-Control-Allow-Headers: *\r\n" +
                "Access-Control-Allow-Private-Network: true\r\n" +
                "Connection: close\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(preflight), ct);
            return;
        }

        string? wsKey = null;
        foreach (var line in lines)
        {
            if (line.StartsWith("Sec-WebSocket-Key:", StringComparison.OrdinalIgnoreCase))
            {
                wsKey = line["Sec-WebSocket-Key:".Length..].Trim();
                break;
            }
        }

        // Plain HTTP /status check
        if (wsKey == null)
        {
            var body = BuildStatusJson();
            var bodyBytes = Encoding.UTF8.GetBytes(body);
            var httpResp =
                "HTTP/1.1 200 OK\r\n" +
                "Content-Type: application/json\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Access-Control-Allow-Private-Network: true\r\n" +
                $"Content-Length: {bodyBytes.Length}\r\n" +
                "Connection: close\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(httpResp), ct);
            await stream.WriteAsync(bodyBytes, ct);
            return;
        }

        // RFC-6455 WebSocket Upgrade
        var acceptHash = SHA1.HashData(Encoding.ASCII.GetBytes(wsKey + WsGuid));
        var acceptKey = Convert.ToBase64String(acceptHash);
        var upgradeResp =
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Private-Network: true\r\n" +
            $"Sec-WebSocket-Accept: {acceptKey}\r\n\r\n";

        await stream.WriteAsync(Encoding.ASCII.GetBytes(upgradeResp), ct);

        using var ws = WebSocket.CreateFromStream(stream, isServer: true, subProtocol: null, keepAliveInterval: TimeSpan.FromSeconds(25));
        var id = Guid.NewGuid();
        _clients[id] = ws;

        try
        {
            var statusBytes = Encoding.UTF8.GetBytes(BuildStatusJson());
            await ws.SendAsync(statusBytes, WebSocketMessageType.Text, true, ct);

            var recvBuf = new byte[8192];
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var res = await ws.ReceiveAsync(recvBuf, ct);
                if (res.MessageType == WebSocketMessageType.Close) break;
                if (res.MessageType == WebSocketMessageType.Text && res.Count > 0)
                {
                    var msgStr = Encoding.UTF8.GetString(recvBuf, 0, res.Count);
                    await HandleCommandJsonAsync(msgStr);
                }
            }
        }
        catch
        {
            // client closed
        }
        finally
        {
            _clients.TryRemove(id, out _);
        }
    }

    private async Task HandleCommandJsonAsync(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeProp)) return;
            var type = typeProp.GetString();

            switch (type)
            {
                case "amp":
                {
                    bool enabled = root.TryGetProperty("enabled", out var pEn) && pEn.GetBoolean();
                    string preset = root.TryGetProperty("preset", out var pPr) ? (pPr.GetString() ?? "blues-breakup") : "blues-breakup";
                    float drive = root.TryGetProperty("drive", out var pDr) ? pDr.GetSingle() : 0.45f;
                    float reverb = root.TryGetProperty("reverb", out var pRv) ? pRv.GetSingle() : 0.28f;
                    float volume = root.TryGetProperty("volume", out var pVo) ? pVo.GetSingle() : 0.70f;
                    _core.UpdateAmpParameters(enabled, preset, drive, reverb, volume);
                    break;
                }
                case "config":
                {
                    if (root.TryGetProperty("rmsThreshold", out var pRms))
                        _pitch.SetRmsThreshold(pRms.GetSingle());
                    if (root.TryGetProperty("channelMode", out var pCh))
                        _core.SetChannelMode(pCh.GetString() ?? "auto");
                    if (root.TryGetProperty("inputGated", out var pGate))
                        _core.SetInputGated(pGate.GetBoolean());
                    if (root.TryGetProperty("mixVolume", out var pVol))
                        _core.SetMasterMixVolume(pVol.GetSingle());
                    break;
                }
                case "reset-dsp":
                    _pitch.Reset();
                    break;
                case "clear-voices":
                    _core.ClearScheduledVoices();
                    break;
                case "voice":
                {
                    string kindStr = root.TryGetProperty("kind", out var pK) ? (pK.GetString() ?? "") : "";
                    float delayMs = root.TryGetProperty("delayMs", out var pD) ? pD.GetSingle() : 0f;
                    float freqHz = root.TryGetProperty("freqHz", out var pF) ? pF.GetSingle() : 220f;
                    float durSec = root.TryGetProperty("durSec", out var pDur) ? pDur.GetSingle() : 0.25f;
                    float vel = root.TryGetProperty("vel", out var pVel) ? pVel.GetSingle() : 0.8f;
                    bool slide = root.TryGetProperty("slide", out var pSl) && pSl.GetBoolean();
                    bool vib = root.TryGetProperty("vibrato", out var pVb) && pVb.GetBoolean();

                    var kind = kindStr switch
                    {
                        "kick" => SynthVoiceKind.Kick,
                        "snare" => SynthVoiceKind.Snare,
                        "hat-closed" => SynthVoiceKind.HiHatClosed,
                        "hat-open" => SynthVoiceKind.HiHatOpen,
                        "click" => SynthVoiceKind.Click,
                        "click-accent" => SynthVoiceKind.ClickAccent,
                        "guitar" => SynthVoiceKind.Guitar,
                        _ => SynthVoiceKind.None,
                    };

                    if (kind != SynthVoiceKind.None)
                    {
                        int delaySamples = Math.Max(0, (int)(delayMs * 0.001 * _core.SampleRate));
                        _core.EnqueueVoice(new ScheduledVoiceEvent
                        {
                            Kind = kind,
                            DelaySamples = delaySamples,
                            FrequencyHz = freqHz,
                            DurationSec = durSec,
                            Velocity = vel,
                            SlideIn = slide ? 1 : 0,
                            Vibrato = vib ? 1 : 0,
                        });
                    }
                    break;
                }
                case "open-panel":
                    _asio.OpenControlPanel();
                    break;
                case "select-driver":
                {
                    _drivers = AsioHost.EnumerateDrivers();
                    string? wanted = root.TryGetProperty("driverName", out var pDn) ? pDn.GetString() : null;
                    int targetBuf = root.TryGetProperty("bufferSize", out var pBs) ? pBs.GetInt32() : (_asio.BufferSize > 0 ? _asio.BufferSize : 64);
                    var match = !string.IsNullOrWhiteSpace(wanted)
                        ? _drivers.FirstOrDefault(d => d.Name.Equals(wanted, StringComparison.OrdinalIgnoreCase))
                        : _drivers.FirstOrDefault(d => d.Name.Contains("USB", StringComparison.OrdinalIgnoreCase)) ?? _drivers.FirstOrDefault();
                    if (match != null)
                    {
                        _asio.StartDriver(match, Math.Clamp(targetBuf, 16, 1024));
                    }
                    await BroadcastStatusAsync();
                    break;
                }
                case "set-buffer":
                {
                    int targetBuf = root.TryGetProperty("bufferSize", out var pBs) ? pBs.GetInt32() : 64;
                    _drivers = AsioHost.EnumerateDrivers();
                    var cur = _drivers.FirstOrDefault(d => d.Name.Equals(_asio.DriverName, StringComparison.OrdinalIgnoreCase))
                              ?? _drivers.FirstOrDefault(d => d.Name.Contains("USB", StringComparison.OrdinalIgnoreCase))
                              ?? _drivers.FirstOrDefault();
                    if (cur != null)
                    {
                        _asio.StartDriver(cur, Math.Clamp(targetBuf, 16, 1024));
                    }
                    await BroadcastStatusAsync();
                    break;
                }
            }
        }
        catch
        {
            // ignore malformed JSON
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { _listener?.Stop(); } catch { }
    }
}
