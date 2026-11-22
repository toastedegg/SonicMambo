import { useEffect, useRef } from 'react';
import { useAudioEngineControl } from '../context/AudioEngineContext';

interface TopBarProps {
  stageTitle: string | null;
  onBack: (() => void) | null;
  onOpenSetup?: () => void;
  demoMode?: boolean;
}

export function TopBar({ stageTitle, onBack, onOpenSetup, demoMode = false }: TopBarProps) {
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

  const showSignalMeter = (isListening && !isInputGated) || demoMode;
  const ampActive = ampSettings.enabled || demoMode;
  const micActive = isListening || demoMode;

  return (
    <header className="h-[60px] px-5 bg-[#FFFBF0] border-b-[2.5px] border-[#121212] flex items-center justify-between shrink-0 z-30">
      <div className="flex items-center gap-3.5 min-w-0">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="neo-btn-paper px-3.5 py-1.5 text-xs rounded-xl"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M11.03 3.97a.75.75 0 0 1 0 1.06L7.56 8.5l3.47 3.47a.75.75 0 1 1-1.06 1.06l-4-4a.75.75 0 0 1 0-1.06l4-4a.75.75 0 0 1 1.06 0z" />
            </svg>
            <span>ROADMAP</span>
          </button>
        ) : (
          <div className="flex items-center gap-2.5">
            {/* Guitar-Pick Lightning Emblem */}
            <div className="w-9 h-9 rounded-xl bg-[#D8FF2E] border-2 border-[#121212] shadow-brutal-xs flex items-center justify-center shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M13 2L4.5 13.5H11.5L10.5 22L19.5 10.5H12.5L13 2Z"
                  fill="#121212"
                  stroke="#121212"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-syne text-xl font-extrabold tracking-tight text-[#121212] leading-none">
                SonicMambo
              </span>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md bg-[#FF3B7F] text-white border-2 border-[#121212] font-mono text-[10px] font-bold uppercase tracking-wider -rotate-2 shadow-brutal-xs">
                ARCADE
              </span>
            </div>
          </div>
        )}

        {stageTitle && (
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-[#FFF4D8] border-2 border-[#121212] max-w-[360px]">
            <span className="w-2 h-2 rounded-full bg-[#2B59FF] shrink-0" />
            <span className="font-display text-xs font-extrabold text-[#121212] truncate">
              {stageTitle}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        {/* Guilt-free Weekly Groove Meter Pill */}
        <div
          className="hidden lg:inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FFF4D8] border-2 border-[#121212] shadow-brutal-xs"
          title="No punitive daily streaks — only weekly groove minutes!"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-[#1CE088] border border-[#121212]" />
          <span className="font-mono text-[11px] font-bold text-[#121212] tabular-nums">
            142m GROOVED
          </span>
          <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-[#D8FF2E] border border-[#121212] text-[#121212]">
            0 GUILT
          </span>
        </div>

        {asioStatus.asioConnected && (
          <button
            type="button"
            onClick={onOpenSetup}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#2B59FF] border-2 border-[#121212] text-white font-mono text-[11px] font-bold tabular-nums shadow-brutal-xs"
            title={`${asioStatus.driverName} (${asioStatus.bufferSize} samples @ ${asioStatus.sampleRate} Hz)`}
          >
            <span>&#9889; ASIO {asioStatus.latencyMs.toFixed(1)}ms</span>
          </button>
        )}

        {showSignalMeter && (
          <div
            className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-white border-2 border-[#121212] shadow-brutal-xs text-xs"
            title={
              detectedChannelCount > 1 && activeChannelIndex >= 0
                ? `Active input: Channel ${activeChannelIndex + 1} of ${detectedChannelCount}`
                : 'Live guitar pitch & signal level'
            }
          >
            <span
              ref={noteSpanRef}
              className="font-mono font-bold text-[#121212] w-7 text-center tabular-nums text-[11px]"
            >
              {demoMode && !isListening ? 'A4' : '—'}
            </span>
            <div className="w-14 h-2 rounded-full bg-[#FFF4D8] border border-[#121212] overflow-hidden">
              <div
                ref={meterFillRef}
                className="h-full bg-[#1CE088]"
                style={{ width: demoMode && !isListening ? '74%' : '0%' }}
              />
            </div>
            {detectedChannelCount > 1 && activeChannelIndex >= 0 && (
              <span className="font-mono text-[10px] font-bold text-[#57534A]">
                Ch{activeChannelIndex + 1}
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void updateAmpSettings({ enabled: !ampSettings.enabled })}
          className={`neo-btn-3d px-3 py-1 rounded-xl text-xs ${
            ampActive
              ? 'bg-[#FF8A00] text-[#121212]'
              : 'bg-white text-[#121212]'
          }`}
          title="Live guitar tube amp monitor (use headphones or interface)"
        >
          <span
            className={`w-2 h-2 rounded-full border border-[#121212] ${
              ampActive ? 'bg-[#D8FF2E]' : 'bg-[#D6CEBC]'
            }`}
          />
          <span className="font-mono text-[11px] font-bold">AMP</span>
        </button>

        <button
          type="button"
          onClick={() => (isListening ? stop() : void start())}
          className={`neo-btn-3d px-3 py-1 rounded-xl text-xs ${
            isInputGated
              ? 'bg-[#FF8A00] text-[#121212]'
              : micActive
                ? 'bg-[#D8FF2E] text-[#121212]'
                : 'bg-[#FFF4D8] text-[#121212]'
          }`}
          title={isListening ? 'Click to mute microphone' : 'Click to turn microphone on'}
        >
          <span
            className={`w-2 h-2 rounded-full border border-[#121212] ${
              isInputGated
                ? 'bg-white'
                : micActive
                  ? 'bg-[#1CE088]'
                  : 'bg-[#D6CEBC]'
            }`}
          />
          <span className="font-mono text-[11px] font-bold">
            {isInputGated ? 'SPKR' : micActive ? 'MIC ON' : 'MIC OFF'}
          </span>
        </button>

        {onOpenSetup && (
          <button
            type="button"
            onClick={onOpenSetup}
            className="neo-btn-paper p-2 rounded-xl"
            title="Audio device, channel & tuner"
            aria-label="Audio setup and tuner"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="#121212" strokeWidth="2.4" />
              <path
                d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.24.58.77.98 1.4 1.09.16.03.32.04.49.04H21a2 2 0 1 1 0 4h-.09c-.17 0-.33.01-.49.04-.63.11-1.16.51-1.4 1.09z"
                stroke="#121212"
                strokeWidth="2.2"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
