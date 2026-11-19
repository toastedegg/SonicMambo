import { useEffect, useRef } from 'react';
import { useAudioEngineControl } from '../context/AudioEngineContext';

interface TopBarProps {
  stageTitle: string | null;
  onBack: (() => void) | null;
  onOpenSetup?: () => void;
}

export function TopBar({ stageTitle, onBack, onOpenSetup }: TopBarProps) {
  const {
    isListening,
    isInputGated,
    detectedChannelCount,
    activeChannelIndex,
    ampSettings,
    asioStatus,
    detectionRef,
    start,
    stop,
    updateAmpSettings,
  } = useAudioEngineControl();

  const noteSpanRef = useRef<HTMLSpanElement | null>(null);
  const meterFillRef = useRef<HTMLDivElement | null>(null);

  // Direct DOM updates for the tiny live-note & level indicator -> ZERO React re-renders!
  useEffect(() => {
    if (!isListening || isInputGated) return undefined;

    const id = window.setInterval(() => {
      const det = detectionRef.current;
      if (noteSpanRef.current) {
        const nextText = det.label ?? '—';
        if (noteSpanRef.current.textContent !== nextText) {
          noteSpanRef.current.textContent = nextText;
        }
      }
      if (meterFillRef.current) {
        const pct = Math.min(100, Math.round(Math.sqrt(Math.max(0, det.rms)) * 220));
        meterFillRef.current.style.width = `${pct}%`;
      }
    }, 80);

    return () => window.clearInterval(id);
  }, [detectionRef, isInputGated, isListening]);

  return (
    <header className="h-12 px-5 bg-[#0a0c10] border-b border-white/[0.06] flex items-center justify-between shrink-0">
      <div className="flex items-center gap-4 min-w-0">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-sp-text-sub hover:text-white transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M11.03 3.97a.75.75 0 0 1 0 1.06L7.56 8.5l3.47 3.47a.75.75 0 1 1-1.06 1.06l-4-4a.75.75 0 0 1 0-1.06l4-4a.75.75 0 0 1 1.06 0z" />
            </svg>
            <span>Roadmap</span>
          </button>
        ) : (
          <span className="text-base font-extrabold tracking-tight text-white">
            Sonic<span className="text-sp-green">Mambo</span>
          </span>
        )}

        {stageTitle && (
          <span className="text-xs font-semibold text-sp-text-muted truncate max-w-[340px] hidden sm:inline">
            {stageTitle}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {asioStatus.asioConnected && (
          <button
            type="button"
            onClick={onOpenSetup}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-400/15 border border-sky-400/40 text-sky-300 text-[11px] font-bold tabular-nums"
            title={`${asioStatus.driverName} (${asioStatus.bufferSize} samples @ ${asioStatus.sampleRate} Hz)`}
          >
            <span>&#9889; ASIO {asioStatus.latencyMs.toFixed(1)}ms</span>
          </button>
        )}

        {isListening && !isInputGated && (
          <div
            className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.07] text-xs"
            title={
              detectedChannelCount > 1 && activeChannelIndex >= 0
                ? `Active input: Channel ${activeChannelIndex + 1} of ${detectedChannelCount}`
                : 'Live guitar signal'
            }
          >
            <span
              ref={noteSpanRef}
              className="font-bold text-white w-6 text-center tabular-nums text-[11px]"
            >
              &mdash;
            </span>
            <div className="w-12 h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                ref={meterFillRef}
                className="h-full bg-sp-green"
                style={{ width: '0%' }}
              />
            </div>
            {detectedChannelCount > 1 && activeChannelIndex >= 0 && (
              <span className="text-[10px] font-semibold text-sp-text-muted">
                Ch{activeChannelIndex + 1}
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void updateAmpSettings({ enabled: !ampSettings.enabled })}
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border transition-colors ${
            ampSettings.enabled
              ? 'bg-amber-400/15 border-amber-400/40 text-amber-300'
              : 'bg-white/[0.04] hover:bg-white/[0.10] border-white/[0.08] text-sp-text-sub'
          }`}
          title="Live guitar tube amp monitor (use headphones or interface)"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              ampSettings.enabled ? 'bg-amber-400' : 'bg-white/25'
            }`}
          />
          <span className="text-xs font-semibold">Amp</span>
        </button>

        <button
          type="button"
          onClick={() => (isListening ? stop() : void start())}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.08] transition-colors"
          title={isListening ? 'Click to mute microphone' : 'Click to turn microphone on'}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isInputGated
                ? 'bg-amber-400'
                : isListening
                  ? 'bg-sp-green'
                  : 'bg-white/25'
            }`}
          />
          <span className="text-xs font-semibold text-sp-text-sub">
            {isInputGated ? 'Speaker' : isListening ? 'Mic On' : 'Mic Off'}
          </span>
        </button>

        {onOpenSetup && (
          <button
            type="button"
            onClick={onOpenSetup}
            className="p-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.10] border border-white/[0.08] text-sp-text-sub hover:text-white transition-colors"
            title="Audio device, channel & tuner"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" strokeWidth="2" />
              <path
                d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.24.58.77.98 1.4 1.09.16.03.32.04.49.04H21a2 2 0 1 1 0 4h-.09c-.17 0-.33.01-.49.04-.63.11-1.16.51-1.4 1.09z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
