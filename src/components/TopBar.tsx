interface TopBarProps {
  lessonTitle: string | null;
  isListening: boolean;
  onBack: (() => void) | null;
}

export function TopBar({ lessonTitle, isListening, onBack }: TopBarProps) {
  return (
    <header className="sp-topbar">
      <div className="flex items-center gap-3">
        <span className="text-xl font-extrabold tracking-tight text-sp-green">
          Sonic Mambo
        </span>
      </div>

      <div className="flex items-center gap-3">
        {onBack && (
          <button type="button" onClick={onBack} className="sp-btn-ghost">
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
        <span className={`sp-mic-dot ${isListening ? 'sp-mic-dot-on' : 'sp-mic-dot-off'}`} />
        <span className="text-xs font-semibold text-sp-text-sub">
          {isListening ? 'Mic On' : 'Mic Off'}
        </span>
      </div>
    </header>
  );
}
