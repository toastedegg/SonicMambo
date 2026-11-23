import { useEffect, useRef } from 'react';
import { useAudioEngineControl } from '../context/AudioEngineContext';

export type NavViewKind = 'roadmap' | 'setup' | 'history';

interface TopBarProps {
  activeNav: NavViewKind | null;
  stageTitle: string | null;
  onNavigate: (nav: NavViewKind) => void;
  onBack: (() => void) | null;
  demoMode?: boolean;
  dimmed?: boolean;
}

const WEEKLY_PIPS = [true, true, true, true, false] as const;

export function TopBar({
  activeNav,
  stageTitle,
  onNavigate,
  onBack,
  demoMode = false,
  dimmed = false,
}: TopBarProps) {
  const {
    isListening,
    isInputGated,
    ampSettings,
    asioStatus,
    detectionRef,
    start,
    stop,
    updateAmpSettings,
  } = useAudioEngineControl();

  const noteSpanRef = useRef<HTMLSpanElement | null>(null);
  const meterFillRef = useRef<HTMLDivElement | null>(null);

  // Zero-re-render DOM telemetry tick
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

  const showSignalPill = (isListening && !isInputGated) || demoMode;
  const ampActive = ampSettings.enabled || demoMode;
  const micActive = isListening || demoMode;

  return (
    <header
      className={`h-[56px] px-4 md:px-5 bg-[#FFFBF0] border-b-[2.5px] border-[#121212] flex items-center justify-between gap-3 shrink-0 z-30 transition-opacity duration-300 ${
        dimmed ? 'opacity-25 hover:opacity-100' : 'opacity-100'
      }`}
    >
      {/* Left: Brand Emblem + Global Nav Switcher (or Back to Tour Map) */}
      <div className="flex items-center gap-3 min-w-0">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="neo-btn-paper px-3 py-1 text-[11px] font-mono uppercase rounded-xl"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M11.03 3.97a.75.75 0 0 1 0 1.06L7.56 8.5l3.47 3.47a.75.75 0 1 1-1.06 1.06l-4-4a.75.75 0 0 1 0-1.06l4-4a.75.75 0 0 1 1.06 0z" />
            </svg>
            <span>Tour Map</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate('roadmap')}
            className="flex items-center gap-2 shrink-0 group"
          >
            <div className="w-8 h-8 rounded-xl bg-[#D8FF2E] border-2 border-[#121212] shadow-brutal-xs flex items-center justify-center group-hover:-translate-y-0.5 transition-transform">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M13 2L4.5 13.5H11.5L10.5 22L19.5 10.5H12.5L13 2Z"
                  fill="#121212"
                  stroke="#121212"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="font-syne text-lg font-extrabold tracking-tight text-[#121212] leading-none">
              SonicMambo
            </span>
          </button>
        )}

        {/* Single-row global navigation pills (replaces left Sidebar completely!) */}
        {!onBack && (
          <nav
            aria-label="Primary navigation"
            className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F4ECDC] border-2 border-[#121212]"
          >
            {(
              [
                { id: 'roadmap', label: 'Tour Map' },
                { id: 'setup', label: 'Rig & Tuner' },
                { id: 'history', label: 'Log' },
              ] as const
            ).map((item) => {
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`px-3 py-1 rounded-lg font-mono text-[11px] font-bold uppercase tracking-wide transition-all ${
                    active
                      ? 'bg-[#D8FF2E] text-[#121212] border-2 border-[#121212] shadow-brutal-xs -my-0.5'
                      : 'text-[#423E37] hover:text-[#121212] border-2 border-transparent'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        )}

        {stageTitle && (
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-[#F4ECDC] border-2 border-[#121212] max-w-[380px]">
            <span className="w-2 h-2 rounded-full bg-[#2B59FF] shrink-0" />
            <span className="font-mono text-[11px] font-bold text-[#121212] truncate">
              {stageTitle}
            </span>
          </div>
        )}
      </div>

      {/* Right: Calm Weekly Tape Counter + Live Input Pill + Amp & Mic Hardware Toggles */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Silent, Guilt-Free Weekly Groove Tape Counter */}
        <div
          className="hidden lg:inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#F4ECDC] border-2 border-[#121212]"
          title="Weekly practice minutes"
        >
          <span className="font-mono text-[11px] font-bold text-[#121212] tabular-nums">
            142/180m
          </span>
          <div className="flex items-center gap-0.5" aria-hidden>
            {WEEKLY_PIPS.map((filled, idx) => (
              <span
                key={idx}
                className={`w-2 h-2.5 rounded-[2px] border border-[#121212] ${
                  filled ? 'bg-[#1CE088]' : 'bg-white'
                }`}
              />
            ))}
          </div>
        </div>

        {asioStatus.asioConnected && (
          <button
            type="button"
            onClick={() => onNavigate('setup')}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#2B59FF] border-2 border-[#121212] text-white font-mono text-[10px] font-bold tabular-nums shadow-brutal-xs"
            title={`${asioStatus.driverName} (${asioStatus.bufferSize} smp @ ${asioStatus.sampleRate} Hz)`}
          >
            <span>ASIO {asioStatus.latencyMs.toFixed(1)}ms</span>
          </button>
        )}

        {showSignalPill && (
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-white border-2 border-[#121212] shadow-brutal-xs">
            <span
              ref={noteSpanRef}
              className="font-mono font-bold text-[#121212] w-6 text-center tabular-nums text-[11px]"
            >
              {demoMode && !isListening ? 'F#4' : '—'}
            </span>
            <div className="w-10 h-1.5 rounded-full bg-[#F4ECDC] border border-[#121212] overflow-hidden">
              <div
                ref={meterFillRef}
                className="h-full bg-[#1CE088]"
                style={{ width: demoMode && !isListening ? '76%' : '0%' }}
              />
            </div>
            <span className="font-mono text-[9px] font-bold text-[#57534A]">HI-Z</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => void updateAmpSettings({ enabled: !ampSettings.enabled })}
          className={`neo-btn-3d px-2.5 py-1 rounded-xl text-[11px] font-mono ${
            ampActive ? 'bg-[#FF8A00] text-[#121212]' : 'bg-white text-[#121212]'
          }`}
          title="Tube amp monitor"
        >
          <span
            className={`w-2 h-2 rounded-full border border-[#121212] ${
              ampActive ? 'bg-[#D8FF2E]' : 'bg-[#D6CEBC]'
            }`}
          />
          <span>AMP</span>
        </button>

        <button
          type="button"
          onClick={() => (isListening ? stop() : void start())}
          className={`neo-btn-3d px-2.5 py-1 rounded-xl text-[11px] font-mono ${
            isInputGated
              ? 'bg-[#FF8A00] text-[#121212]'
              : micActive
                ? 'bg-[#D8FF2E] text-[#121212]'
                : 'bg-[#F4ECDC] text-[#121212]'
          }`}
          title={isListening ? 'Mute input' : 'Enable guitar input'}
        >
          <span
            className={`w-2 h-2 rounded-full border border-[#121212] ${
              isInputGated ? 'bg-white' : micActive ? 'bg-[#1CE088]' : 'bg-[#D6CEBC]'
            }`}
          />
          <span>{isInputGated ? 'SPKR' : micActive ? 'MIC ON' : 'MIC'}</span>
        </button>
      </div>
    </header>
  );
}
