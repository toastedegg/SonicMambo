import type { Lesson } from '../types/lesson';

interface SidebarProps {
  lessons: Lesson[];
  activeLessonId: string | null;
  activeTopLevel: 'home' | 'setup' | null;
  onSelectLesson: (lesson: Lesson) => void;
  onGoHome: () => void;
  onGoSetup: () => void;
}

export function Sidebar({
  lessons,
  activeLessonId,
  activeTopLevel,
  onSelectLesson,
  onGoHome,
  onGoSetup,
}: SidebarProps) {
  return (
    <aside className="sp-sidebar">
      <nav className="px-2 pt-3 pb-1">
        <ul className="flex flex-col gap-0.5">
          <TopLevelItem
            label="Home"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M3 10.5L12 3l9 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            active={activeTopLevel === 'home'}
            onClick={onGoHome}
          />
          <TopLevelItem
            label="Setup"
            sublabel="Connect &amp; tune your guitar"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" strokeWidth="2" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.24.58.77.98 1.4 1.09.16.03.32.04.49.04H21a2 2 0 1 1 0 4h-.09c-.17 0-.33.01-.49.04-.63.11-1.16.51-1.4 1.09z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            }
            active={activeTopLevel === 'setup'}
            onClick={onGoSetup}
          />
        </ul>
      </nav>

      <div className="px-5 pt-5 pb-3">
        <h2 className="sp-section-label">Your Lessons</h2>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <ul className="flex flex-col gap-0.5">
          {lessons.map((lesson) => {
            const isActive = lesson.id === activeLessonId;
            return (
              <li key={lesson.id}>
                <button
                  type="button"
                  onClick={() => onSelectLesson(lesson)}
                  className={`sp-sidebar-item group ${isActive ? 'sp-sidebar-item-active' : 'sp-sidebar-item-idle'}`}
                >
                  {isActive && (
                    <span className="w-1 h-8 rounded-full bg-sp-green shrink-0" />
                  )}
                  <div className={`flex flex-col min-w-0 ${!isActive ? 'pl-4' : ''}`}>
                    <span
                      className={`text-sm font-bold truncate ${
                        isActive ? 'text-sp-green' : 'text-sp-text group-hover:text-white'
                      }`}
                    >
                      {lesson.title}
                    </span>
                    <span className="text-xs text-sp-text-muted mt-0.5">
                      {lesson.tempoBpm} BPM &middot; {lesson.notes.length} notes
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

interface TopLevelItemProps {
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}

function TopLevelItem({ label, sublabel, icon, active, onClick }: TopLevelItemProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`sp-sidebar-item group ${active ? 'sp-sidebar-item-active' : 'sp-sidebar-item-idle'}`}
      >
        {active && <span className="w-1 h-8 rounded-full bg-sp-green shrink-0" />}
        <div className={`flex items-center gap-3 min-w-0 ${!active ? 'pl-4' : ''}`}>
          <span className={active ? 'text-sp-green' : 'text-sp-text-sub group-hover:text-white'}>
            {icon}
          </span>
          <div className="flex flex-col min-w-0">
            <span
              className={`text-sm font-bold truncate ${
                active ? 'text-sp-green' : 'text-sp-text group-hover:text-white'
              }`}
            >
              {label}
            </span>
            {sublabel && (
              <span className="text-xs text-sp-text-muted mt-0.5 truncate">{sublabel}</span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
