interface TopBarProps {
  lessonTitle: string | null;
  isListening: boolean;
  onBack: (() => void) | null;
}

export function TopBar({ lessonTitle, isListening, onBack }: TopBarProps) {
  return (
    <header className="h-16 flex items-center justify-between px-6 bg-sp-black/90 backdrop-blur-md border-b border-white/5 shrink-0 z-20">
      <div className="flex items-center gap-3">
        <span className="text-xl font-extrabold tracking-tight text-sp-green">
          SonicMambo
        </span>
      </div>

      <div className="flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-semibold text-sp-text-sub hover:text-white transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.03 3.97a.75.75 0 0 1 0 1.06L7.56 8.5l3.47 3.47a.75.75 0 1 1-1.06 1.06l-4-4a.75.75 0 0 1 0-1.06l4-4a.75.75 0 0 1 1.06 0z" />
            </svg>
            Back
          </button>
        )}
        {lessonTitle && (
          <span className="text-sm font-bold text-white truncate max-w-[260px]">
            {lessonTitle}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            isListening ? 'bg-sp-green animate-pulse' : 'bg-sp-text-muted'
          }`}
        />
        <span className="text-xs font-semibold text-sp-text-sub">
          {isListening ? 'Mic On' : 'Mic Off'}
        </span>
      </div>
    </header>
  );
}
