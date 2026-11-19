import { useCallback, useEffect, useRef, useState } from 'react';
import { AMP_PRESETS, type AmpPresetId } from '../audio/guitarAmpRig';
import {
  readInputProfile,
  writeInputProfile,
} from '../audio/soundPolicy';
import { useSharedAudioEngine } from '../context/AudioEngineContext';
import type { InputChannelSelection } from '../hooks/useAudioEngine';
import { exportAllDataJson, importAllDataJson } from '../storage/backup';
import { LatencyCheck } from './LatencyCheck';
import { MicCheck } from './MicCheck';
import {
  AmpIcon,
  AppIcon,
  CableIcon,
  ComputerIcon,
  GuitarIcon,
  InterfaceIcon,
  MicIcon,
  SignalChainDiagram,
  UsbIcon,
} from './SignalChainDiagram';
import { Tuner } from './Tuner';

type InputProfile = 'interface' | 'laptop-mic' | 'micd-amp';

interface SetupProps {
  onReachedScrollEnd?: () => void;
}

export function Setup({ onReachedScrollEnd }: SetupProps) {
  const {
    isListening,
    loudness,
    rmsThreshold,
    audioLatencyMs,
    currentNote,
    frequency,
    smoothedFrequency,
    error,
    inputDevices,
    selectedDeviceId,
    channelSelection,
    detectedChannelCount,
    activeChannelIndex,
    ampSettings,
    asioStatus,
    detectionRef,
    start,
    stop,
    refreshDevices,
    setSelectedDeviceId,
    setChannelSelection,
    updateAmpSettings,
    probeAsioBridge,
    selectAsioDriver,
    setAsioBufferSize,
    openAsioControlPanel,
    setRmsThreshold,
    resetNoiseCalibration,
    subscribeNoteEvents,
  } = useSharedAudioEngine();

  const [profile, setProfile] = useState<InputProfile | null>(() => readInputProfile());
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollEndSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    const sentinel = scrollEndSentinelRef.current;
    if (!sentinel || !onReachedScrollEnd) return;

    const root = sentinel.closest('main');
    let wasIntersecting = false;

    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries[0]?.isIntersecting ?? false;
        if (hit && !wasIntersecting) {
          onReachedScrollEnd();
        }
        wasIntersecting = hit;
      },
      { root: root ?? undefined, rootMargin: '0px 0px -12px 0px', threshold: 0.72 },
    );

    io.observe(sentinel);
    return () => io.disconnect();
  }, [onReachedScrollEnd]);

  const handleProfileSelect = useCallback((p: InputProfile) => {
    setProfile(p);
    writeInputProfile(p);
  }, []);

  const handleChannelChange = (val: string) => {
    if (val === 'auto') setChannelSelection('auto');
    else if (val === 'sum') setChannelSelection('sum');
    else setChannelSelection(Number(val) as InputChannelSelection);
  };

  const handleExportBackup = useCallback(async () => {
    try {
      const json = await exportAllDataJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sonicmambo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMessage('Backup JSON exported.');
    } catch (err) {
      setBackupMessage(err instanceof Error ? err.message : 'Export failed');
    }
  }, []);

  const handleImportBackup = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importAllDataJson(text);
      setBackupMessage(`Restored ${res.sessionsImported} sessions from backup.`);
    } catch (err) {
      setBackupMessage(err instanceof Error ? err.message : 'Import failed');
    } finally {
      e.target.value = '';
    }
  }, []);

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto pb-16">
      <header className="mb-8">
        <span className="sp-section-label">Audio &amp; Tuner</span>
        <h1 className="sp-heading-lg mt-1 mb-2">Guitar Input &amp; Tuning Studio</h1>
        <p className="text-sp-text-sub max-w-2xl">
          Connect your USB audio interface or microphone, select your active input jack
          (Channel 1 or Channel 2), calibrate room noise, and tune up.
        </p>
      </header>

      {/* Native Local ASIO Ultra-Low-Latency Bridge Panel */}
      <section
        className={`rounded-2xl border p-5 mb-8 space-y-4 ${
          asioStatus.asioConnected
            ? 'bg-sky-950/25 border-sky-400/40'
            : 'bg-sp-base border-white/10'
        }`}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold uppercase tracking-widest text-sky-400">
                &#9889; Native ASIO Desktop Bridge
              </span>
              {asioStatus.asioConnected ? (
                <span className="px-2.5 py-0.5 rounded-full bg-sky-400/20 text-sky-300 text-[11px] font-extrabold tabular-nums">
                  {asioStatus.driverName} &middot; {asioStatus.latencyMs.toFixed(1)} ms RTL
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-white/8 text-sp-text-muted text-[11px] font-semibold">
                  Not Connected (Using Browser WebAudio)
                </span>
              )}
            </div>
            <p className="text-xs text-sp-text-sub mt-1 max-w-2xl">
              {asioStatus.asioConnected
                ? `Hardware DMA active at ${asioStatus.sampleRate} Hz (${asioStatus.bufferSize} samples). Guitar Amp, Drums, and Pitch Tracking are running natively with BIAS-FX-grade latency.`
                : 'For ~5–8 ms hardware ASIO guitar amp monitoring on Windows, start the local companion in a terminal with "npm run bridge" — Chrome connects automatically.'}
            </p>
            {asioStatus.error && (
              <p className="text-xs text-amber-300 mt-1">{asioStatus.error}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {asioStatus.asioConnected && (
              <button
                type="button"
                onClick={openAsioControlPanel}
                className="sp-btn-secondary text-xs"
              >
                ASIO Control Panel
              </button>
            )}
            <button
              type="button"
              onClick={() => void probeAsioBridge()}
              className="sp-btn-secondary text-xs"
            >
              {asioStatus.bridgeReachable ? 'Refresh ASIO' : 'Check ASIO Bridge'}
            </button>
          </div>
        </div>

        {asioStatus.bridgeReachable && (
          <div className="grid gap-4 sm:grid-cols-2 pt-3 border-t border-white/10 text-xs">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-sp-text-muted mb-1.5">
                ASIO Driver
              </label>
              <select
                value={asioStatus.driverName}
                onChange={(e) => selectAsioDriver(e.target.value)}
                className="w-full bg-sp-elevated text-white font-semibold px-3 py-2 rounded-lg border border-white/15 focus:outline-none"
              >
                {asioStatus.availableDrivers.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-sp-text-muted mb-1.5">
                ASIO Hardware Buffer Size
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {[32, 48, 64, 128, 256].map((sz) => {
                  const active = asioStatus.bufferSize === sz;
                  return (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setAsioBufferSize(sz)}
                      className={`px-3 py-1.5 rounded-lg font-bold border transition-colors ${
                        active
                          ? 'bg-sky-400 text-black border-sky-400'
                          : 'bg-sp-elevated text-sp-text-sub border-white/10 hover:text-white'
                      }`}
                    >
                      {sz} smp
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      <StepHeader number={1} title="Choose how you&rsquo;re connecting" />
      <div className="grid gap-3 md:grid-cols-2 mb-8">
        <SignalChainDiagram
          title="Electric guitar via audio interface"
          description="Uses the 1/4&quot; Instrument (Hi-Z) jack of a Focusrite Scarlett, UA Volt, Steinberg, or similar USB interface."
          badge="Recommended"
          highlighted={profile === 'interface'}
          onClick={() => handleProfileSelect('interface')}
          steps={[
            { label: 'Electric guitar', icon: <GuitarIcon /> },
            { label: '1/4" cable', icon: <CableIcon /> },
            { label: 'Audio interface', sub: 'Ch 1 or Ch 2', icon: <InterfaceIcon /> },
            { label: 'USB', icon: <UsbIcon /> },
            { label: 'Computer', icon: <ComputerIcon /> },
            { label: 'SonicMambo', icon: <AppIcon /> },
          ]}
        />
        <SignalChainDiagram
          title="Acoustic guitar via laptop mic"
          description="Zero extra gear needed. Works cleanly in a quiet room aimed 30–60 cm from your guitar."
          highlighted={profile === 'laptop-mic'}
          onClick={() => handleProfileSelect('laptop-mic')}
          steps={[
            { label: 'Acoustic guitar', icon: <GuitarIcon /> },
            { label: 'Laptop mic', icon: <MicIcon /> },
            { label: 'SonicMambo', icon: <AppIcon /> },
          ]}
        />
        <SignalChainDiagram
          title="Mic&rsquo;d amp"
          description="Clean amp channel with a microphone in front of the speaker cone into an audio interface."
          highlighted={profile === 'micd-amp'}
          onClick={() => handleProfileSelect('micd-amp')}
          steps={[
            { label: 'Electric guitar', icon: <GuitarIcon /> },
            { label: 'Clean amp', icon: <AmpIcon /> },
            { label: 'Mic', icon: <MicIcon /> },
            { label: 'Interface', icon: <InterfaceIcon /> },
            { label: 'SonicMambo', icon: <AppIcon /> },
          ]}
        />
      </div>

      {profile === 'interface' && <FocusriteTips />}
      {profile === 'laptop-mic' && <LaptopMicTips />}
      {profile === 'micd-amp' && <MicdAmpTips />}

      <StepHeader number={2} title="Enable microphone &amp; pick input channel" />
      <div className="sp-card-padded mb-8 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-base font-bold text-white">Live Guitar Capture</h3>
            <p className="text-xs text-sp-text-sub mt-0.5">
              Browser voice filters (echo cancellation, AGC, noise suppression) are automatically turned off so guitar sustain rings naturally.
            </p>
          </div>
          {!isListening ? (
            <button
              type="button"
              onClick={() => void start()}
              className="sp-btn-primary-compact"
            >
              Turn on mic
            </button>
          ) : (
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sp-green/15 text-sp-green font-bold text-xs">
                <span className="sp-mic-dot sp-mic-dot-on" />
                Mic Active
                {detectedChannelCount > 1 && activeChannelIndex >= 0
                  ? ` (Ch ${activeChannelIndex + 1}/${detectedChannelCount})`
                  : ''}
              </span>
              <button type="button" onClick={stop} className="sp-btn-secondary text-xs">
                Turn off
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-brand-red/15 border border-brand-red/35 text-sm text-brand-red">
            <strong>Couldn&rsquo;t start the mic:</strong> {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 pt-3 border-t border-white/10">
          {/* Audio Input Device Selector */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-sp-text-muted mb-1.5">
              Input Device
            </label>
            <select
              value={selectedDeviceId}
              onChange={(e) => void setSelectedDeviceId(e.target.value)}
              className="w-full bg-sp-elevated text-white text-sm font-semibold px-3 py-2 rounded-lg border border-white/15 focus:outline-none focus:border-sp-green"
            >
              <option value="">System Default Audio Input</option>
              {inputDevices.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-sp-text-muted mt-1">
              Turn on mic once if device names appear generic (browser privacy until permission is granted).
            </p>
          </div>

          {/* Interface Channel Selector (Fixes Focusrite Ch 2 Instrument Jack!) */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-sp-text-muted mb-1.5">
              Interface Input Channel
            </label>
            <select
              value={String(channelSelection)}
              onChange={(e) => handleChannelChange(e.target.value)}
              className="w-full bg-sp-elevated text-white text-sm font-semibold px-3 py-2 rounded-lg border border-white/15 focus:outline-none focus:border-sp-green"
            >
              <option value="auto">Auto-Detect Active Jack (Recommended)</option>
              <option value="0">Channel 1 Only (Left / Input 1)</option>
              <option value="1">Channel 2 Only (Right / Guitar Inst 2)</option>
              <option value="sum">Sum Channels 1 + 2</option>
            </select>
            <p className="text-[11px] text-sp-text-muted mt-1">
              On Focusrite Scarlett Solo / 2i2, the 1/4&quot; guitar jack is Channel 2 &mdash; Auto-Detect locks onto it automatically.
            </p>
          </div>
        </div>

        {/* Built-in Low-Latency Guitar Amplifier */}
        <div className="pt-4 border-t border-white/10 space-y-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h4 className="text-sm font-bold text-white">
                Built-In Guitar Amplifier &amp; Cabinet Sim
              </h4>
              <p className="text-xs text-sp-text-sub mt-0.5">
                Hear your dry interface guitar through warm tube breakup &amp; studio room air while pitch detection stays 100% clean. Wear headphones to avoid speaker feedback.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void updateAmpSettings({ enabled: !ampSettings.enabled })}
              className={`px-4 py-1.5 rounded-full text-xs font-extrabold border transition-colors ${
                ampSettings.enabled
                  ? 'bg-amber-400 text-black border-amber-400'
                  : 'bg-white/[0.06] text-sp-text-sub border-white/15 hover:text-white'
              }`}
            >
              {ampSettings.enabled ? 'Amp Monitor: ON' : 'Turn On Amp Monitor'}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            {AMP_PRESETS.map((p) => {
              const active = ampSettings.preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    void updateAmpSettings({
                      preset: p.id as AmpPresetId,
                      drive: p.defaultDrive,
                      reverb: p.defaultReverb,
                    })
                  }
                  className={`p-2.5 rounded-lg text-left border transition-colors ${
                    active
                      ? 'bg-amber-400/15 border-amber-400/50 text-amber-300'
                      : 'bg-sp-elevated/60 border-white/10 text-sp-text-sub hover:text-white'
                  }`}
                >
                  <div className="text-xs font-bold">{p.label}</div>
                </button>
              );
            })}
          </div>

          <div className="grid gap-4 sm:grid-cols-3 pt-1 text-xs">
            <label className="space-y-1">
              <div className="flex justify-between text-sp-text-muted font-semibold">
                <span>Tube Drive</span>
                <span>{Math.round(ampSettings.drive * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(ampSettings.drive * 100)}
                onChange={(e) =>
                  void updateAmpSettings({ drive: Number(e.target.value) / 100 })
                }
                className="w-full accent-amber-400 cursor-pointer"
              />
            </label>

            <label className="space-y-1">
              <div className="flex justify-between text-sp-text-muted font-semibold">
                <span>Room Ambience</span>
                <span>{Math.round(ampSettings.reverb * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(ampSettings.reverb * 100)}
                onChange={(e) =>
                  void updateAmpSettings({ reverb: Number(e.target.value) / 100 })
                }
                className="w-full accent-amber-400 cursor-pointer"
              />
            </label>

            <label className="space-y-1">
              <div className="flex justify-between text-sp-text-muted font-semibold">
                <span>Amp Level</span>
                <span>{Math.round(ampSettings.volume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(ampSettings.volume * 100)}
                onChange={(e) =>
                  void updateAmpSettings({ volume: Number(e.target.value) / 100 })
                }
                className="w-full accent-amber-400 cursor-pointer"
              />
            </label>
          </div>
        </div>
      </div>

      <StepHeader number={3} title="Check signal &amp; calibrate noise floor" />
      <div className="mb-8">
        <MicCheck
          isListening={isListening}
          loudness={loudness}
          rmsThreshold={rmsThreshold}
          currentNote={currentNote}
          frequency={frequency}
          error={error}
          onCalibrateNoiseFloor={setRmsThreshold}
          onResetCalibration={resetNoiseCalibration}
        />
      </div>

      <StepHeader number={4} title="Tune your guitar" />
      <div className="space-y-4 mb-8">
        <Tuner isListening={isListening} smoothedFrequency={smoothedFrequency} />
        <LatencyCheck
          isListening={isListening}
          audioLatencyMs={audioLatencyMs}
          subscribeNoteEvents={subscribeNoteEvents}
          detectionRef={detectionRef}
        />
      </div>

      <StepHeader number={5} title="Practice data backup" />
      <div className="sp-card-padded mb-8 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h4 className="font-bold text-white">Export or restore progress</h4>
          <p className="text-xs text-sp-text-sub mt-0.5">
            Save your session history and calibration locally as JSON anytime.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button type="button" onClick={handleExportBackup} className="sp-btn-secondary text-xs">
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="sp-btn-secondary text-xs"
          >
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportBackup}
            className="hidden"
          />
          {backupMessage && (
            <span className="text-xs text-sp-green font-semibold">{backupMessage}</span>
          )}
        </div>
      </div>

      <div ref={scrollEndSentinelRef} className="h-2 w-full shrink-0" aria-hidden />
    </div>
  );
}

function StepHeader({ number, title }: { number: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-3 mt-6">
      <span className="w-8 h-8 rounded-full bg-sp-green/15 text-sp-green font-extrabold flex items-center justify-center text-sm shrink-0">
        {number}
      </span>
      <h2 className="sp-heading-md" dangerouslySetInnerHTML={{ __html: title }} />
    </div>
  );
}

function FocusriteTips() {
  return (
    <div className="sp-card-padded mb-8 border border-sp-green/20">
      <h4 className="font-bold text-white mb-2">Tips for your audio interface</h4>
      <ul className="text-sm text-sp-text-sub space-y-1.5">
        <li>
          Plug into the <strong>Instrument (INST / Hi-Z)</strong> jack and engage the{' '}
          <strong>INST</strong> button so pickups aren&rsquo;t loaded down.
        </li>
        <li>
          SonicMambo automatically listens to both Input 1 and Input 2, so Scarlett Solo/2i2 Input 2 works out of the box.
        </li>
        <li>
          Use a clean guitar signal (turn off heavy distortion or reverb pedals for best pitch tracking).
        </li>
      </ul>
    </div>
  );
}

function LaptopMicTips() {
  return (
    <div className="sp-card-padded mb-8 border border-sp-green/20">
      <h4 className="font-bold text-white mb-2">Tips for the laptop mic</h4>
      <ul className="text-sm text-sp-text-sub space-y-1.5">
        <li>Sit 30&ndash;60 cm from the laptop with the guitar aimed toward the mic.</li>
        <li>Run the 1.5s Room Noise calibration below so fan hum never triggers false notes.</li>
      </ul>
    </div>
  );
}

function MicdAmpTips() {
  return (
    <div className="sp-card-padded mb-8 border border-sp-green/20">
      <h4 className="font-bold text-white mb-2">Tips for mic&rsquo;d amp</h4>
      <ul className="text-sm text-sp-text-sub space-y-1.5">
        <li>Use your amp&rsquo;s <strong>clean</strong> channel with minimal reverb during detection.</li>
        <li>Aim the microphone 5&ndash;10 cm off-axis from the speaker cone.</li>
      </ul>
    </div>
  );
}
