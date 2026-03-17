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
}

export function BottomBar({ audio }: BottomBarProps) {
  if (!audio) {
    return (
      <footer className="h-20 shrink-0 bg-sp-black border-t border-sp-elevated flex items-center justify-center z-20">
        <p className="text-sp-text-muted text-sm font-semibold">
          Select a lesson to begin
        </p>
      </footer>
    );
  }

  const { detectedLabel, frequency, loudness, targetLabel, isMatch, hits, misses } = audio;

  return (
    <footer className="h-20 shrink-0 bg-sp-black border-t border-sp-elevated grid grid-cols-3 items-center px-6 z-20">
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
          <div
            className={`px-5 py-1.5 rounded-full text-sm font-bold transition-colors ${
              isMatch === true
                ? 'bg-brand-green/20 text-brand-green'
                : isMatch === false
                  ? 'bg-brand-red/20 text-brand-red'
                  : 'bg-sp-elevated text-sp-text-sub'
            }`}
          >
            Target: {targetLabel}
          </div>
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
          <div className="w-16 h-1.5 rounded-full bg-sp-elevated overflow-hidden">
            <div
              className="h-full rounded-full bg-sp-green transition-all duration-100"
              style={{ width: `${Math.min(loudness * 100, 100)}%` }}
            />
          </div>
          <span className="text-sp-text-muted">{(loudness * 100).toFixed(0)}%</span>
        </div>
      </div>
    </footer>
  );
}
