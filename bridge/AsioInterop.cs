using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace SonicMamboBridge;

public sealed record AsioDriverEntry(string Name, Guid Clsid);

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct AsioBufferInfo
{
    public int IsInput;
    public int ChannelNum;
    public IntPtr Buffer0;
    public IntPtr Buffer1;
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public unsafe struct AsioChannelInfo
{
    public int Channel;
    public int IsInput;
    public int IsActive;
    public int ChannelGroup;
    public int SampleType;
    public fixed byte Name[32];
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public unsafe struct AsioCallbacks
{
    public delegate* unmanaged[Cdecl]<int, int, void> BufferSwitch;
    public delegate* unmanaged[Cdecl]<double, void> SampleRateDidChange;
    public delegate* unmanaged[Cdecl]<int, int, void*, double*, int> AsioMessage;
    public delegate* unmanaged[Cdecl]<void*, int, int, void*> BufferSwitchTimeInfo;
}

public static class AsioSampleType
{
    public const int Int16LSB = 16;
    public const int Int24LSB = 17;
    public const int Int32LSB = 18;
    public const int Float32LSB = 19;
    public const int Float64LSB = 20;
}

/// <summary>
/// Zero-allocation 64-bit Windows COM ASIO 2.3 Host (`IASIO` vtable).
/// Runs driver initialization and message pump on a dedicated STA thread,
/// while the DMA audio callback runs directly in unmanaged/pinned memory.
/// </summary>
public sealed unsafe class AsioHost : IDisposable
{
    private const uint CLSCTX_INPROC_SERVER = 1;
    private const int ASE_OK = 0;
    private const int ASE_SUCCESS = 0x3f4847a0;

    [DllImport("ole32.dll")]
    private static extern int CoInitializeEx(IntPtr pvReserved, uint dwCoInit);

    [DllImport("ole32.dll")]
    private static extern void CoUninitialize();

    [DllImport("ole32.dll")]
    private static extern int CoCreateInstance(
        ref Guid rclsid,
        IntPtr pUnkOuter,
        uint dwClsContext,
        ref Guid riid,
        out IntPtr ppv);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowExW(
        uint dwExStyle, string lpClassName, string lpWindowName, uint dwStyle,
        int x, int y, int nWidth, int nHeight,
        IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool PeekMessageW(out Win32Msg lpMsg, IntPtr hWnd, uint min, uint max, uint remove);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref Win32Msg lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessageW(ref Win32Msg lpMsg);

    [StructLayout(LayoutKind.Sequential)]
    private struct Win32Msg
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    // Active singleton pointer accessed inside static [UnmanagedCallersOnly] DMA callback
    private static AsioHost? s_active;

    private Thread? _staThread;
    private readonly BlockingCollectionQueue _cmdQueue = new();
    private IntPtr _iasio = IntPtr.Zero;
    private IntPtr _hwnd = IntPtr.Zero;
    private AsioBufferInfo* _bufferInfos = null;
    private AsioCallbacks* _callbacks = null;
    private int _totalCreatedBuffers = 0;
    private int _numInputBuffers = 0;
    private int _numOutputBuffers = 0;
    private int _inSampleType = AsioSampleType.Int32LSB;
    private int _outSampleType = AsioSampleType.Int32LSB;
    private bool _supportsOutputReady = false;
    private volatile bool _running = false;
    private volatile bool _resetRequested = false;

    public string DriverName { get; private set; } = "";
    public double SampleRate { get; private set; } = 48000;
    public int BufferSize { get; private set; } = 128;
    public int InputLatencySamples { get; private set; }
    public int OutputLatencySamples { get; private set; }
    public int InputChannels { get; private set; }
    public int OutputChannels { get; private set; }
    public bool IsRunning => _running;
    public string? LastError { get; private set; }

    public double RoundTripLatencyMs =>
        SampleRate > 0 ? ((InputLatencySamples + OutputLatencySamples) / SampleRate) * 1000.0 : 0.0;

    private readonly RealTimeAudioCore _audioCore;

    public AsioHost(RealTimeAudioCore audioCore)
    {
        _audioCore = audioCore;
    }

    public static List<AsioDriverEntry> EnumerateDrivers()
    {
        var list = new List<AsioDriverEntry>();
        using var root = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\ASIO");
        if (root == null) return list;

        foreach (var subName in root.GetSubKeyNames())
        {
            using var sub = root.OpenSubKey(subName);
            var clsidStr = sub?.GetValue("CLSID") as string;
            var desc = (sub?.GetValue("Description") as string) ?? subName;
            if (!string.IsNullOrWhiteSpace(clsidStr) && Guid.TryParse(clsidStr, out var guid))
            {
                list.Add(new AsioDriverEntry(string.IsNullOrWhiteSpace(desc) ? subName : desc, guid));
            }
        }
        return list;
    }

    public bool StartDriver(AsioDriverEntry driver, int targetBufferSize = 64)
    {
        StopDriver();

        var startedTcs = new TaskCompletionSource<bool>();
        _staThread = new Thread(() => StaThreadLoop(driver, targetBufferSize, startedTcs))
        {
            IsBackground = true,
            Priority = ThreadPriority.Highest,
            Name = "SonicMambo-ASIO-STA",
        };
        _staThread.SetApartmentState(ApartmentState.STA);
        _staThread.Start();

        return startedTcs.Task.GetAwaiter().GetResult();
    }

    public void OpenControlPanel()
    {
        if (!_running || _iasio == IntPtr.Zero) return;
        _cmdQueue.Enqueue(() =>
        {
            if (_iasio != IntPtr.Zero)
            {
                var vtbl = *(IntPtr**)_iasio;
                var fnControlPanel = (delegate* unmanaged[Stdcall]<IntPtr, int>)vtbl[21];
                fnControlPanel(_iasio);
            }
        });
    }

    public void StopDriver()
    {
        if (_staThread == null) return;
        _cmdQueue.SignalExit();
        _staThread.Join(2000);
        _staThread = null;
    }

    private void StaThreadLoop(AsioDriverEntry driver, int targetBufferSize, TaskCompletionSource<bool> startedTcs)
    {
        CoInitializeEx(IntPtr.Zero, 2 /* COINIT_APARTMENTTHREADED */);
        try
        {
            // Create hidden Win32 HWND on this STA thread (required by Focusrite & Steinberg ASIO drivers)
            _hwnd = CreateWindowExW(0, "STATIC", "SonicMamboAsioHost", 0, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);

            var clsid = driver.Clsid;
            var iid = driver.Clsid; // ASIO drivers use their own CLSID as IID (or IUnknown)
            int hr = CoCreateInstance(ref clsid, IntPtr.Zero, CLSCTX_INPROC_SERVER, ref iid, out _iasio);
            if (hr < 0 || _iasio == IntPtr.Zero)
            {
                var iunk = new Guid("00000000-0000-0000-C000-000000000046");
                hr = CoCreateInstance(ref clsid, IntPtr.Zero, CLSCTX_INPROC_SERVER, ref iunk, out _iasio);
            }

            if (hr < 0 || _iasio == IntPtr.Zero)
            {
                LastError = $"CoCreateInstance failed (0x{hr:X8}) for {driver.Name}.";
                startedTcs.TrySetResult(false);
                return;
            }

            var vtbl = *(IntPtr**)_iasio;
            var fnInit = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int>)vtbl[3];
            var fnGetError = (delegate* unmanaged[Stdcall]<IntPtr, byte*, void>)vtbl[6];
            var fnStart = (delegate* unmanaged[Stdcall]<IntPtr, int>)vtbl[7];
            var fnStop = (delegate* unmanaged[Stdcall]<IntPtr, int>)vtbl[8];
            var fnGetChannels = (delegate* unmanaged[Stdcall]<IntPtr, int*, int*, int>)vtbl[9];
            var fnGetLatencies = (delegate* unmanaged[Stdcall]<IntPtr, int*, int*, int>)vtbl[10];
            var fnGetBufferSize = (delegate* unmanaged[Stdcall]<IntPtr, int*, int*, int*, int*, int>)vtbl[11];
            var fnGetSampleRate = (delegate* unmanaged[Stdcall]<IntPtr, double*, int>)vtbl[13];
            var fnSetSampleRate = (delegate* unmanaged[Stdcall]<IntPtr, double, int>)vtbl[14];
            var fnGetChannelInfo = (delegate* unmanaged[Stdcall]<IntPtr, AsioChannelInfo*, int>)vtbl[18];
            var fnCreateBuffers = (delegate* unmanaged[Stdcall]<IntPtr, AsioBufferInfo*, int, int, AsioCallbacks*, int>)vtbl[19];
            var fnDisposeBuffers = (delegate* unmanaged[Stdcall]<IntPtr, int>)vtbl[20];
            var fnOutputReady = (delegate* unmanaged[Stdcall]<IntPtr, int>)vtbl[23];
            var fnRelease = (delegate* unmanaged[Stdcall]<IntPtr, uint>)vtbl[2];

            if (fnInit(_iasio, _hwnd) == 0)
            {
                byte* errBuf = stackalloc byte[128];
                fnGetError(_iasio, errBuf);
                var msg = Marshal.PtrToStringAnsi((IntPtr)errBuf) ?? "Hardware not connected or busy";
                LastError = $"{driver.Name}: {msg}";
                fnRelease(_iasio);
                _iasio = IntPtr.Zero;
                startedTcs.TrySetResult(false);
                return;
            }

            int inCh = 0, outCh = 0;
            fnGetChannels(_iasio, &inCh, &outCh);
            InputChannels = inCh;
            OutputChannels = outCh;

            if (inCh < 1 || outCh < 1)
            {
                LastError = $"{driver.Name} reported {inCh} inputs and {outCh} outputs.";
                fnRelease(_iasio);
                _iasio = IntPtr.Zero;
                startedTcs.TrySetResult(false);
                return;
            }

            double sr = 0;
            fnGetSampleRate(_iasio, &sr);
            if (sr < 44100 || sr > 192000)
            {
                fnSetSampleRate(_iasio, 48000.0);
                fnGetSampleRate(_iasio, &sr);
            }
            if (sr <= 0) sr = 48000.0;
            SampleRate = sr;

            int minBuf = 0, maxBuf = 0, prefBuf = 0, gran = 0;
            fnGetBufferSize(_iasio, &minBuf, &maxBuf, &prefBuf, &gran);
            Console.WriteLine($"    [ASIO Buffer Caps] min={minBuf}, max={maxBuf}, preferred={prefBuf}, granularity={gran}");
            int chosenBuf = PickOptimalLowLatencyBuffer(minBuf, maxBuf, prefBuf, gran, targetBufferSize);
            BufferSize = chosenBuf;

            // Request up to 2 input channels (Ch 1 Mic + Ch 2 Guitar Inst) and 2 output channels (Stereo L/R)
            _numInputBuffers = Math.Min(2, inCh);
            _numOutputBuffers = Math.Min(2, outCh);
            _totalCreatedBuffers = _numInputBuffers + _numOutputBuffers;

            _bufferInfos = (AsioBufferInfo*)NativeMemory.AllocZeroed((nuint)_totalCreatedBuffers, (nuint)sizeof(AsioBufferInfo));
            for (int c = 0; c < _numInputBuffers; c++)
            {
                _bufferInfos[c].IsInput = 1;
                _bufferInfos[c].ChannelNum = c;
            }
            for (int c = 0; c < _numOutputBuffers; c++)
            {
                _bufferInfos[_numInputBuffers + c].IsInput = 0;
                _bufferInfos[_numInputBuffers + c].ChannelNum = c;
            }

            // Query sample formats for Input 0 and Output 0
            AsioChannelInfo chInfo = default;
            chInfo.Channel = 0;
            chInfo.IsInput = 1;
            if (fnGetChannelInfo(_iasio, &chInfo) == ASE_OK)
            {
                _inSampleType = chInfo.SampleType;
            }

            AsioChannelInfo outInfo = default;
            outInfo.Channel = 0;
            outInfo.IsInput = 0;
            if (fnGetChannelInfo(_iasio, &outInfo) == ASE_OK)
            {
                _outSampleType = outInfo.SampleType;
            }

            _callbacks = (AsioCallbacks*)NativeMemory.AllocZeroed(1, (nuint)sizeof(AsioCallbacks));
            _callbacks->BufferSwitch = &OnBufferSwitch;
            _callbacks->SampleRateDidChange = &OnSampleRateChanged;
            _callbacks->AsioMessage = &OnAsioMessage;
            _callbacks->BufferSwitchTimeInfo = &OnBufferSwitchTimeInfo;

            _audioCore.Configure(SampleRate, BufferSize);
            s_active = this;

            int cbErr = fnCreateBuffers(_iasio, _bufferInfos, _totalCreatedBuffers, chosenBuf, _callbacks);
            if (cbErr != ASE_OK)
            {
                LastError = $"createBuffers failed ({cbErr}).";
                CleanupDriver(fnDisposeBuffers, fnStop, fnRelease);
                startedTcs.TrySetResult(false);
                return;
            }

            int latIn = 0, latOut = 0;
            fnGetLatencies(_iasio, &latIn, &latOut);
            InputLatencySamples = latIn > 0 ? latIn : chosenBuf;
            OutputLatencySamples = latOut > 0 ? latOut : chosenBuf;

            _supportsOutputReady = fnOutputReady(_iasio) == ASE_OK;

            int startErr = fnStart(_iasio);
            if (startErr != ASE_OK)
            {
                LastError = $"ASIO start() failed ({startErr}).";
                CleanupDriver(fnDisposeBuffers, fnStop, fnRelease);
                startedTcs.TrySetResult(false);
                return;
            }

            DriverName = driver.Name;
            LastError = null;
            _running = true;
            _resetRequested = false;
            startedTcs.TrySetResult(true);

            // Pump Win32 messages (required for ASIO Control Panel GUI & driver notifications) + commands
            while (!_cmdQueue.IsExiting)
            {
                while (PeekMessageW(out var msg, IntPtr.Zero, 0, 0, 1 /* PM_REMOVE */))
                {
                    TranslateMessage(ref msg);
                    DispatchMessageW(ref msg);
                }

                while (_cmdQueue.TryDequeue(out var action))
                {
                    action();
                }

                if (_resetRequested)
                {
                    // Driver changed buffer size in Control Panel -> notify caller
                    _resetRequested = false;
                    break;
                }

                Thread.Sleep(15);
            }

            _running = false;
            CleanupDriver(fnDisposeBuffers, fnStop, fnRelease);
        }
        catch (Exception ex)
        {
            LastError = ex.Message;
            startedTcs.TrySetResult(false);
        }
        finally
        {
            if (_hwnd != IntPtr.Zero)
            {
                DestroyWindow(_hwnd);
                _hwnd = IntPtr.Zero;
            }
            CoUninitialize();
        }
    }

    private static int PickOptimalLowLatencyBuffer(int minBuf, int maxBuf, int prefBuf, int gran, int targetSamples)
    {
        if (minBuf <= 0 || maxBuf <= 0 || minBuf >= maxBuf)
        {
            return prefBuf > 0 ? prefBuf : 128;
        }
        int clamped = Math.Clamp(targetSamples, minBuf, maxBuf);
        if (gran == -1)
        {
            // Power-of-two sizes between minBuf and maxBuf
            int p = minBuf;
            while (p < clamped && p * 2 <= maxBuf) p *= 2;
            return p;
        }
        if (gran > 0)
        {
            int steps = (clamped - minBuf) / gran;
            return Math.Clamp(minBuf + steps * gran, minBuf, maxBuf);
        }
        return prefBuf > 0 ? prefBuf : clamped;
    }

    private void CleanupDriver(
        delegate* unmanaged[Stdcall]<IntPtr, int> fnDisposeBuffers,
        delegate* unmanaged[Stdcall]<IntPtr, int> fnStop,
        delegate* unmanaged[Stdcall]<IntPtr, uint> fnRelease)
    {
        s_active = null;
        if (_iasio != IntPtr.Zero)
        {
            try { fnStop(_iasio); } catch { }
            try { fnDisposeBuffers(_iasio); } catch { }
            try { fnRelease(_iasio); } catch { }
            _iasio = IntPtr.Zero;
        }
        if (_bufferInfos != null)
        {
            NativeMemory.Free(_bufferInfos);
            _bufferInfos = null;
        }
        if (_callbacks != null)
        {
            NativeMemory.Free(_callbacks);
            _callbacks = null;
        }
    }

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvCdecl)])]
    private static void OnBufferSwitch(int index, int directProcess)
    {
        var host = s_active;
        if (host == null || !host._running || host._bufferInfos == null) return;
        host.ProcessDmaBuffer(index);
    }

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvCdecl)])]
    private static void* OnBufferSwitchTimeInfo(void* timeInfo, int index, int directProcess)
    {
        var host = s_active;
        if (host != null && host._running && host._bufferInfos != null)
        {
            host.ProcessDmaBuffer(index);
        }
        return timeInfo;
    }

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvCdecl)])]
    private static void OnSampleRateChanged(double sRate)
    {
        var host = s_active;
        if (host != null && sRate > 0)
        {
            host.SampleRate = sRate;
        }
    }

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvCdecl)])]
    private static int OnAsioMessage(int selector, int value, void* message, double* opt)
    {
        switch (selector)
        {
            case 1: // kAsioSelectorSupported
                return value is 2 or 3 or 4 or 5 or 6 ? 1 : 0;
            case 2: // kAsioEngineVersion
                return 2;
            case 3: // kAsioResetRequest
            case 4: // kAsioBufferSizeChange
                if (s_active != null) s_active._resetRequested = true;
                return 1;
            case 5: // kAsioResyncRequest
            case 6: // kAsioLatenciesChanged
                return 1;
            default:
                return 0;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private void ProcessDmaBuffer(int doubleBufferIndex)
    {
        int n = BufferSize;
        if (n <= 0 || n > 4096) return;

        IntPtr inPtr0 = _numInputBuffers >= 1
            ? (doubleBufferIndex == 0 ? _bufferInfos[0].Buffer0 : _bufferInfos[0].Buffer1)
            : IntPtr.Zero;
        IntPtr inPtr1 = _numInputBuffers >= 2
            ? (doubleBufferIndex == 0 ? _bufferInfos[1].Buffer0 : _bufferInfos[1].Buffer1)
            : IntPtr.Zero;

        IntPtr outPtrL = _numOutputBuffers >= 1
            ? (doubleBufferIndex == 0
                ? _bufferInfos[_numInputBuffers].Buffer0
                : _bufferInfos[_numInputBuffers].Buffer1)
            : IntPtr.Zero;
        IntPtr outPtrR = _numOutputBuffers >= 2
            ? (doubleBufferIndex == 0
                ? _bufferInfos[_numInputBuffers + 1].Buffer0
                : _bufferInfos[_numInputBuffers + 1].Buffer1)
            : IntPtr.Zero;

        float* fIn0 = _audioCore.ScratchIn0;
        float* fIn1 = _audioCore.ScratchIn1;
        float* fOutL = _audioCore.ScratchOutL;
        float* fOutR = _audioCore.ScratchOutR;

        ReadSamplesToFloat(inPtr0, fIn0, n, _inSampleType);
        if (inPtr1 != IntPtr.Zero)
            ReadSamplesToFloat(inPtr1, fIn1, n, _inSampleType);
        else
            new Span<float>(fIn1, n).Clear();

        _audioCore.ProcessAsioBlock(fIn0, fIn1, fOutL, fOutR, n);

        if (outPtrL != IntPtr.Zero)
            WriteFloatToSamples(fOutL, outPtrL, n, _outSampleType);
        if (outPtrR != IntPtr.Zero)
            WriteFloatToSamples(fOutR, outPtrR, n, _outSampleType);

        if (_supportsOutputReady && _iasio != IntPtr.Zero)
        {
            var vtbl = *(IntPtr**)_iasio;
            var fnOutputReady = (delegate* unmanaged[Stdcall]<IntPtr, int>)vtbl[23];
            fnOutputReady(_iasio);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void ReadSamplesToFloat(IntPtr src, float* dst, int count, int sampleType)
    {
        if (src == IntPtr.Zero)
        {
            new Span<float>(dst, count).Clear();
            return;
        }

        switch (sampleType)
        {
            case AsioSampleType.Int32LSB:
            {
                const float inv = 1.0f / 2147483648.0f;
                int* p = (int*)src;
                for (int i = 0; i < count; i++) dst[i] = p[i] * inv;
                break;
            }
            case AsioSampleType.Float32LSB:
            {
                Buffer.MemoryCopy((void*)src, dst, count * 4L, count * 4L);
                break;
            }
            case AsioSampleType.Int24LSB:
            {
                const float inv24 = 1.0f / 8388608.0f;
                byte* b = (byte*)src;
                for (int i = 0; i < count; i++)
                {
                    int v = b[0] | (b[1] << 8) | ((sbyte)b[2] << 16);
                    dst[i] = v * inv24;
                    b += 3;
                }
                break;
            }
            case AsioSampleType.Int16LSB:
            {
                const float inv16 = 1.0f / 32768.0f;
                short* p = (short*)src;
                for (int i = 0; i < count; i++) dst[i] = p[i] * inv16;
                break;
            }
            default:
                new Span<float>(dst, count).Clear();
                break;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void WriteFloatToSamples(float* src, IntPtr dst, int count, int sampleType)
    {
        switch (sampleType)
        {
            case AsioSampleType.Int32LSB:
            {
                int* p = (int*)dst;
                for (int i = 0; i < count; i++)
                {
                    float c = Math.Clamp(src[i], -0.999999f, 0.999999f);
                    p[i] = (int)(c * 2147483647.0f);
                }
                break;
            }
            case AsioSampleType.Float32LSB:
            {
                for (int i = 0; i < count; i++)
                {
                    ((float*)dst)[i] = Math.Clamp(src[i], -1.0f, 1.0f);
                }
                break;
            }
            case AsioSampleType.Int24LSB:
            {
                byte* b = (byte*)dst;
                for (int i = 0; i < count; i++)
                {
                    float c = Math.Clamp(src[i], -0.999999f, 0.999999f);
                    int v = (int)(c * 8388607.0f);
                    b[0] = (byte)(v & 0xFF);
                    b[1] = (byte)((v >> 8) & 0xFF);
                    b[2] = (byte)((v >> 16) & 0xFF);
                    b += 3;
                }
                break;
            }
            case AsioSampleType.Int16LSB:
            {
                short* p = (short*)dst;
                for (int i = 0; i < count; i++)
                {
                    float c = Math.Clamp(src[i], -0.9999f, 0.9999f);
                    p[i] = (short)(c * 32767.0f);
                }
                break;
            }
        }
    }

    public void Dispose()
    {
        StopDriver();
    }

    private sealed class BlockingCollectionQueue
    {
        private readonly Queue<Action> _q = new();
        private volatile bool _exiting;
        public bool IsExiting => _exiting;

        public void Enqueue(Action a)
        {
            lock (_q) _q.Enqueue(a);
        }

        public bool TryDequeue(out Action action)
        {
            lock (_q)
            {
                if (_q.Count > 0)
                {
                    action = _q.Dequeue();
                    return true;
                }
            }
            action = null!;
            return false;
        }

        public void SignalExit() => _exiting = true;
    }
}
