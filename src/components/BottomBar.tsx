export interface AudioFeedback {
  detectedLabel: string | null;
  frequency: number | null;
  loudness: number;
  isListening: boolean;
  targetLabel: string | null;
  isMatch: boolean | null;
  hits: number;
  misses: number;
}

interface BottomBarProps {
  audio: AudioFeedback | null;
  /** Setup flow: compact primary action, left-aligned in the footer. */
  onSetupReady?: () => void;
  /** After user scrolls setup to the end, loop a subtle scale pulse until they leave setup or click. */
  setupCtaPulseActive?: boolean;
}

export function BottomBar({ audio, onSetupReady, setupCtaPulseActive = false }: BottomBarProps) {
  if (onSetupReady) {
    return (
      <footer className="sp-bottombar flex items-center justify-end px-6">
        <button
          type="button"
          onClick={onSetupReady}
          className={`sp-btn-primary-compact ${setupCtaPulseActive ? 'sp-setup-cta-attention' : ''}`}
        >
          I&rsquo;m ready &rarr; Pick a lesson
        </button>
      </footer>
    );
  }

  if (!audio) {
    return (
      <footer className="sp-bottombar flex items-center justify-center">
        <p className="text-sp-text-muted text-sm font-semibold">
          Select a lesson to begin
        </p>
      </footer>
    );
  }

  const { detectedLabel, frequency, loudness, targetLabel, isMatch, hits, misses } = audio;

  const pillClass =
    isMatch === true
      ? 'sp-pill-match'
      : isMatch === false
        ? 'sp-pill-miss'
        : 'sp-pill-neutral';

  return (
    <footer className="sp-bottombar grid grid-cols-3 items-center px-6">
      <div className="flex flex-col items-start min-w-0">
        {detectedLabel ? (
          <>
            <span className="text-lg font-extrabold text-white truncate">{detectedLabel}</span>
            {frequency != null && (
              <span className="text-xs text-sp-text-muted">{frequency.toFixed(1)} Hz</span>
            )}
          </>
        ) : (
          <span className="text-sm text-sp-text-muted">Play a note...</span>
        )}
      </div>

      <div className="flex flex-col items-center">
        {targetLabel ? (
          <div className={pillClass}>Target: {targetLabel}</div>
        ) : (
          <span className="text-sm text-sp-text-muted">Waiting...</span>
        )}
      </div>

      <div className="flex items-center justify-end gap-5 text-xs font-semibold">
        <span className="text-sp-text-sub">
          Hits <span className="text-brand-green">{hits}</span>
        </span>
        <span className="text-sp-text-sub">
          Miss <span className="text-brand-red">{misses}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <div className="sp-loudness-track">
            <div
              className="sp-loudness-fill"
              style={{ width: `${Math.min(loudness * 100, 100)}%` }}
            />
          </div>
          <span className="text-sp-text-muted">{(loudness * 100).toFixed(0)}%</span>
        </div>
      </div>
    </footer>
  );
}
