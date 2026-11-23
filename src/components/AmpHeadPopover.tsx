import { useEffect, useRef, useState } from 'react';
import type { AmpPresetId, AmpSettings } from '../audio/guitarAmpRig';
import { useAudioEngineControl } from '../context/AudioEngineContext';

export interface RisoRotaryKnobProps {
  label: string;
  valuePct: number; // 0..100
  onChangePct: (nextPct: number) => void;
  size?: number;
  accentColor?: string;
  textColor?: string;
}

/**
 * Tactile pointer-captured rotary potentiometer knob:
 * - Drag up/right to crank up, down/left to roll back
 * - Mouse wheel fine-adjusts by ±4%
 * - Double-click resets to 70%
 */
export function RisoRotaryKnob({
  label,
  valuePct,
  onChangePct,
  size = 42,
  accentColor = '#D8FF2E',
  textColor,
}: RisoRotaryKnobProps) {
  const dragRef = useRef<{ startY: number; startX: number; startVal: number } | null>(null);
  const clamped = Math.max(0, Math.min(100, Math.round(valuePct)));
  const angleDeg = -132 + (clamped / 100) * 264;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startY: e.clientY,
      startX: e.clientX,
      startVal: clamped,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    const dy = dragRef.current.startY - e.clientY;
    const dx = e.clientX - dragRef.current.startX;
    const delta = (dy + dx * 0.5) * 0.85;
    const next = Math.max(0, Math.min(100, Math.round(dragRef.current.startVal + delta)));
    if (next !== clamped) {
      onChangePct(next);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const step = e.deltaY < 0 ? 4 : -4;
    onChangePct(Math.max(0, Math.min(100, clamped + step)));
  };

  return (
    <div
      className="flex flex-col items-center select-none cursor-ns-resize group"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onChangePct(70);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault();
          onChangePct(Math.min(100, clamped + 5));
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault();
          onChangePct(Math.max(0, clamped - 5));
        }
      }}
      title={`Drag up/down or scroll to adjust ${label} (${clamped}%)`}
    >
      <div
        className="rounded-full bg-[#121212] border-2 border-[#FFFBF0] relative flex items-center justify-center shadow-sm transition-transform group-hover:scale-105 group-active:scale-110"
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        <span
          className="w-1 h-4 rounded-full origin-bottom -translate-y-1.5 pointer-events-none"
          style={{
            backgroundColor: accentColor,
            transform: `rotate(${angleDeg.toFixed(1)}deg)`,
          }}
        />
      </div>
      <span
        className="font-mono text-[8.5px] font-bold mt-0.5 tabular-nums whitespace-nowrap"
        style={textColor ? { color: textColor } : undefined}
      >
        {label} {clamped}%
      </span>
    </div>
  );
}

export const AMP_CHANNEL_CARDS: ReadonlyArray<{
  id: AmpPresetId;
  name: string;
  shortName: string;
  tag: string;
  bg: string;
  text: string;
  led: string;
  defaultDrive: number;
  defaultTone: number;
  defaultReverb: number;
}> = [
  {
    id: 'clean-studio',
    name: 'TWIN CLEAN',
    shortName: 'CLEAN',
    tag: '6L6 CHIME',
    bg: '#2B59FF',
    text: '#FFFFFF',
    led: '#D8FF2E',
    defaultDrive: 0.24,
    defaultTone: 0.58,
    defaultReverb: 0.34,
  },
  {
    id: 'blues-breakup',
    name: 'TEXAS OD',
    shortName: 'TEXAS OD',
    tag: 'TS9 SCREAMER',
    bg: '#FF8A00',
    text: '#121212',
    led: '#D8FF2E',
    defaultDrive: 0.64,
    defaultTone: 0.64,
    defaultReverb: 0.30,
  },
  {
    id: 'british-crunch',
    name: 'JCM CRUNCH',
    shortName: 'CRUNCH',
    tag: 'EL34 STACK',
    bg: '#FF3B7F',
    text: '#FFFFFF',
    led: '#D8FF2E',
    defaultDrive: 0.80,
    defaultTone: 0.70,
    defaultReverb: 0.24,
  },
  {
    id: 'insane-lead',
    name: 'NITRO 5150',
    shortName: 'NITRO 5150',
    tag: '☢ HIGH-GAIN',
    bg: '#121212',
    text: '#D8FF2E',
    led: '#FF3B7F',
    defaultDrive: 0.92,
    defaultTone: 0.78,
    defaultReverb: 0.18,
  },
];

interface AmpControlPillProps {
  compact?: boolean;
  demoMode?: boolean;
}

/**
 * Split Neo-Brutalist `[● AMP | 🎛️]` pill with anchored live Tube Amp Head popover.
 * Lets the player toggle the amp OR dial Gain, Bite, Room Air, Master Level, and
 * Nitro 5150 High-Gain from ANY screen in real time!
 */
export function AmpControlPill({ compact = false, demoMode = false }: AmpControlPillProps) {
  const { ampSettings, asioStatus, updateAmpSettings, probeAsioBridge } =
    useAudioEngineControl();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const ampOn = ampSettings.enabled || demoMode;

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (ev: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const applyLive = (partial: Partial<AmpSettings>) => {
    void updateAmpSettings({ enabled: true, ...partial });
  };

  const drivePct = Math.round(ampSettings.drive * 100);
  const tonePct = Math.round((ampSettings.tone ?? 0.66) * 100);
  const reverbPct = Math.round(ampSettings.reverb * 100);
  const volPct = Math.round(ampSettings.volume * 100);

  return (
    <div ref={wrapperRef} className="relative inline-flex items-center">
      <div
        className={`inline-flex items-center rounded-xl border-2 border-[#121212] overflow-hidden shadow-brutal-xs ${
          ampOn ? 'bg-[#FF8A00] text-[#121212]' : 'bg-[#FFFBF0] text-[#121212]'
        }`}
      >
        <button
          type="button"
          onClick={() => void updateAmpSettings({ enabled: !ampSettings.enabled })}
          className={`flex items-center gap-1.5 font-mono font-bold hover:brightness-95 transition ${
            compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1 text-[11px]'
          }`}
          title={ampOn ? 'Bypass guitar amp' : 'Turn on guitar amp'}
        >
          <span
            className={`w-2 h-2 rounded-full border border-[#121212] ${
              ampOn ? 'bg-[#D8FF2E]' : 'bg-[#D6CEBC]'
            }`}
          />
          <span>AMP</span>
        </button>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`border-l-2 border-[#121212] font-mono font-extrabold hover:bg-[#D8FF2E] hover:text-[#121212] transition ${
            open ? 'bg-[#121212] text-[#D8FF2E]' : 'bg-black/5 text-[#121212]'
          } ${compact ? 'px-1.5 py-1 text-[10px]' : 'px-2 py-1 text-[10px]'}`}
          aria-expanded={open}
          aria-label="Open interactive tube amp controls"
          title="Dial Amp Gain, Bite, Presets & Nitro 5150 Drive"
        >
          🎛️
        </button>
      </div>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] w-[404px] neo-card-lg bg-[#FFFBF0] p-3.5 z-50 text-[#121212] shadow-brutal"
          role="dialog"
          aria-label="Interactive Guitar Tube Amp Head"
        >
          {/* Top Amp Head Nameplate + ASIO Badge + GO NUTS Button */}
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b-2 border-[#121212]">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void updateAmpSettings({ enabled: !ampSettings.enabled })}
                className={`px-2.5 py-1 rounded-lg border-2 border-[#121212] font-mono text-[10px] font-extrabold ${
                  ampSettings.enabled
                    ? 'bg-[#D8FF2E] text-[#121212]'
                    : 'bg-[#F4ECDC] text-[#57534A]'
                }`}
              >
                {ampSettings.enabled ? '● ON' : '○ OFF'}
              </button>

              {asioStatus.asioConnected ? (
                <span className="px-2 py-0.5 rounded-md bg-[#2B59FF] text-white border border-[#121212] font-mono text-[9.5px] font-bold">
                  ⚡ ASIO {asioStatus.latencyMs.toFixed(1)}ms
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void probeAsioBridge()}
                  className="px-2 py-0.5 rounded-md bg-[#F4ECDC] border border-[#121212] font-mono text-[9.5px] font-bold text-[#57534A]"
                >
                  WASM AMP
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                void updateAmpSettings({
                  enabled: true,
                  preset: 'insane-lead',
                  drive: 0.95,
                  tone: 0.80,
                  reverb: 0.18,
                  volume: 0.86,
                })
              }
              className="px-2.5 py-1 rounded-lg border-2 border-[#121212] bg-[#FF3B7F] text-white font-mono text-[10px] font-extrabold shadow-brutal-xs hover:brightness-110"
              title="Crank 3-stage Nitro 5150 high-gain stack to 11!"
            >
              🔥 GO NUTS (11)
            </button>
          </div>

          {/* 4 Amp Channel Selector Buttons */}
          <div className="grid grid-cols-4 gap-1.5 my-2.5">
            {AMP_CHANNEL_CARDS.map((ch) => {
              const active = ampSettings.preset === ch.id;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() =>
                    applyLive({
                      preset: ch.id,
                      drive: ch.defaultDrive,
                      tone: ch.defaultTone,
                      reverb: ch.defaultReverb,
                    })
                  }
                  className={`px-1.5 py-1.5 rounded-xl border-2 border-[#121212] text-center transition-transform ${
                    active ? '-translate-y-0.5 ring-2 ring-[#D8FF2E] shadow-brutal-xs' : 'opacity-85 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: ch.bg, color: ch.text }}
                >
                  <div className="font-mono text-[10px] font-extrabold leading-tight">
                    {ch.id === 'blues-breakup'
                      ? 'TEXAS'
                      : ch.id === 'insane-lead'
                        ? '5150'
                        : ch.shortName}
                  </div>
                  <div className="font-mono text-[8px] font-bold opacity-85 truncate mt-0.5">
                    {ch.tag}
                  </div>
                </button>
              );
            })}
          </div>

          {/* 4 Tactile Rotary Knobs (Drag up/down or use sliders below) */}
          <div className="grid grid-cols-4 gap-2 py-2 px-2 rounded-xl bg-[#F4ECDC] border-2 border-[#121212]">
            <RisoRotaryKnob
              label="GAIN"
              valuePct={drivePct}
              onChangePct={(v) => applyLive({ drive: v / 100 })}
              size={44}
              accentColor="#FF3B7F"
              textColor="#121212"
            />
            <RisoRotaryKnob
              label="BITE"
              valuePct={tonePct}
              onChangePct={(v) => applyLive({ tone: v / 100 })}
              size={44}
              accentColor="#D8FF2E"
              textColor="#121212"
            />
            <RisoRotaryKnob
              label="AIR"
              valuePct={reverbPct}
              onChangePct={(v) => applyLive({ reverb: v / 100 })}
              size={44}
              accentColor="#2B59FF"
              textColor="#121212"
            />
            <RisoRotaryKnob
              label="LVL"
              valuePct={volPct}
              onChangePct={(v) => applyLive({ volume: v / 100 })}
              size={44}
              accentColor="#1CE088"
              textColor="#121212"
            />
          </div>

          {/* Direct Precision Faders for Instant Sweeps */}
          <div className="mt-2.5 space-y-1.5 font-mono text-[10px] font-bold">
            <label className="flex items-center gap-2">
              <span className="w-11 text-[#121212]">GAIN</span>
              <input
                type="range"
                min={0}
                max={100}
                value={drivePct}
                onChange={(e) => applyLive({ drive: Number(e.target.value) / 100 })}
                className="flex-1 accent-[#FF3B7F] cursor-pointer h-2"
              />
              <span className="w-8 text-right tabular-nums">{drivePct}%</span>
            </label>

            <label className="flex items-center gap-2">
              <span className="w-11 text-[#121212]">BITE</span>
              <input
                type="range"
                min={0}
                max={100}
                value={tonePct}
                onChange={(e) => applyLive({ tone: Number(e.target.value) / 100 })}
                className="flex-1 accent-[#FF8A00] cursor-pointer h-2"
              />
              <span className="w-8 text-right tabular-nums">{tonePct}%</span>
            </label>

            <label className="flex items-center gap-2">
              <span className="w-11 text-[#121212]">AIR</span>
              <input
                type="range"
                min={0}
                max={100}
                value={reverbPct}
                onChange={(e) => applyLive({ reverb: Number(e.target.value) / 100 })}
                className="flex-1 accent-[#2B59FF] cursor-pointer h-2"
              />
              <span className="w-8 text-right tabular-nums">{reverbPct}%</span>
            </label>

            <label className="flex items-center gap-2">
              <span className="w-11 text-[#121212]">LEVEL</span>
              <input
                type="range"
                min={0}
                max={100}
                value={volPct}
                onChange={(e) => applyLive({ volume: Number(e.target.value) / 100 })}
                className="flex-1 accent-[#1CE088] cursor-pointer h-2"
              />
              <span className="w-8 text-right tabular-nums">{volPct}%</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
