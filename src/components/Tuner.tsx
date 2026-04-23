import { useEffect, useMemo, useState } from 'react';

interface TunerProps {
  isListening: boolean;
  smoothedFrequency: number | null;
}

interface GuitarString {
  name: string;
  label: string;
  hz: number;
}

/**
 * Standard tuning, low to high. `label` is shown in the pill, `name` is an
 * extra "what-it's-called" helper ("Low E", "A", "D", ...).
 */
const GUITAR_STRINGS: GuitarString[] = [
  { name: 'Low E',  label: 'E2', hz: 82.41 },
  { name: 'A',      label: 'A2', hz: 110.00 },
  { name: 'D',      label: 'D3', hz: 146.83 },
  { name: 'G',      label: 'G3', hz: 196.00 },
  { name: 'B',      label: 'B3', hz: 246.94 },
  { name: 'High E', label: 'E4', hz: 329.63 },
];

const ACTIVE_CENTS_WINDOW = 60;
const IN_TUNE_CENTS = 5;
const IN_TUNE_HOLD_MS = 250;

function centsBetween(detected: number, target: number): number {
  return 1200 * Math.log2(detected / target);
}

export function Tuner({ isListening, smoothedFrequency }: TunerProps) {
  const active = useMemo(() => {
    if (!isListening || smoothedFrequency == null) return null;
    let best: { index: number; cents: number } | null = null;
    for (let i = 0; i < GUITAR_STRINGS.length; i += 1) {
      const c = centsBetween(smoothedFrequency, GUITAR_STRINGS[i].hz);
      if (!best || Math.abs(c) < Math.abs(best.cents)) {
        best = { index: i, cents: c };
      }
    }
    if (!best || Math.abs(best.cents) > ACTIVE_CENTS_WINDOW) return null;
    return best;
  }, [isListening, smoothedFrequency]);

  const [tunedFlags, setTunedFlags] = useState<boolean[]>(
    () => GUITAR_STRINGS.map(() => false)
  );

  // Track how long a string has been within IN_TUNE_CENTS; mark it tuned once held.
  useEffect(() => {
    if (!active) return;
    if (Math.abs(active.cents) > IN_TUNE_CENTS) return;

    const start = performance.now();
    const idx = active.index;
    const t = window.setTimeout(() => {
      // Re-check that we're still in-tune on this string when the timer fires.
      if (performance.now() - start >= IN_TUNE_HOLD_MS) {
        setTunedFlags((prev) => {
          if (prev[idx]) return prev;
          const next = prev.slice();
          next[idx] = true;
          return next;
        });
      }
    }, IN_TUNE_HOLD_MS);

    return () => window.clearTimeout(t);
  }, [active?.index, active?.cents, active]);

  const allTuned = tunedFlags.every(Boolean);

  return (
    <div className="sp-card-padded">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div>
          <h3 className="sp-heading-md">Tune your guitar</h3>
          <p className="text-sm text-sp-text-sub mt-0.5">
            Play each string open. The pill lights up when you're close, and confirms once you're within &plusmn;{IN_TUNE_CENTS} cents.
          </p>
        </div>
        {allTuned && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sp-green/20 text-sp-green text-xs font-bold shrink-0">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
            </svg>
            All strings tuned
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-4">
        {GUITAR_STRINGS.map((string, i) => {
          const isActive = active?.index === i;
          const cents = isActive ? active!.cents : null;
          const tuned = tunedFlags[i];
          return (
            <StringPill
              key={string.label}
              name={string.name}
              label={string.label}
              hz={string.hz}
              active={isActive}
              cents={cents}
              tuned={tuned}
            />
          );
        })}
      </div>

      <div className="mt-5">
        <CentsNeedle cents={active?.cents ?? null} visible={active != null} />
      </div>

      <button
        type="button"
        onClick={() => setTunedFlags(GUITAR_STRINGS.map(() => false))}
        className="sp-btn-ghost mt-4"
      >
        Reset tuning check
      </button>
    </div>
  );
}

interface StringPillProps {
  name: string;
  label: string;
  hz: number;
  active: boolean;
  cents: number | null;
  tuned: boolean;
}

function StringPill({ name, label, hz, active, cents, tuned }: StringPillProps) {
  const borderClass = active
    ? Math.abs(cents ?? 99) < IN_TUNE_CENTS
      ? 'border-sp-green ring-2 ring-sp-green/40'
      : 'border-yellow-400'
    : tuned
      ? 'border-sp-green/60'
      : 'border-white/10';

  const bgClass = active
    ? Math.abs(cents ?? 99) < IN_TUNE_CENTS
      ? 'bg-sp-green/15'
      : 'bg-yellow-400/10'
    : tuned
      ? 'bg-sp-green/5'
      : 'bg-sp-elevated';

  return (
    <div
      className={`relative flex flex-col items-center justify-center rounded-lg p-3 border transition-colors ${borderClass} ${bgClass}`}
    >
      {tuned && (
        <span className="absolute top-1.5 right-1.5 text-sp-green">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
          </svg>
        </span>
      )}
      <div className="text-2xl font-extrabold text-white leading-none">{label}</div>
      <div className="text-[10px] text-sp-text-muted mt-1 uppercase tracking-widest">
        {name}
      </div>
      <div className="text-[10px] text-sp-text-muted mt-0.5">{hz.toFixed(2)} Hz</div>
      {active && cents != null && (
        <div
          className={`text-xs font-bold mt-1 ${
            Math.abs(cents) < IN_TUNE_CENTS
              ? 'text-sp-green'
              : cents < 0
                ? 'text-yellow-400'
                : 'text-yellow-400'
          }`}
        >
          {cents > 0 ? '+' : ''}
          {cents.toFixed(0)} cents
        </div>
      )}
    </div>
  );
}

function CentsNeedle({ cents, visible }: { cents: number | null; visible: boolean }) {
  const clamped = Math.max(-50, Math.min(50, cents ?? 0));
  const percent = ((clamped + 50) / 100) * 100;
  const inTune = cents != null && Math.abs(cents) < IN_TUNE_CENTS;

  return (
    <div className="relative">
      <div className="flex justify-between text-[10px] text-sp-text-muted mb-1 font-semibold">
        <span>flat &minus;50</span>
        <span className={inTune ? 'text-sp-green' : 'text-sp-text-muted'}>in tune</span>
        <span>+50 sharp</span>
      </div>
      <div className="relative h-3 rounded-full bg-sp-elevated overflow-hidden">
        <div
          className="absolute top-0 h-full w-px bg-white/30"
          style={{ left: '50%' }}
        />
        <div
          className="absolute top-0 h-full bg-sp-green/20"
          style={{
            left: `${50 - (IN_TUNE_CENTS / 100) * 100}%`,
            width: `${(IN_TUNE_CENTS * 2 / 100) * 100}%`,
          }}
        />
        {visible && (
          <div
            className={`absolute top-0 h-full w-1 rounded-full transition-[left] duration-75 ${
              inTune ? 'bg-sp-green' : 'bg-yellow-400'
            }`}
            style={{ left: `calc(${percent}% - 2px)` }}
          />
        )}
      </div>
    </div>
  );
}
