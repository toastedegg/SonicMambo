import type { Lesson } from '../types/lesson';

interface SidebarProps {
  lessons: Lesson[];
  activeLessonId: string | null;
  onSelectLesson: (lesson: Lesson) => void;
}

export function Sidebar({ lessons, activeLessonId, onSelectLesson }: SidebarProps) {
  return (
    <aside className="w-72 shrink-0 flex flex-col bg-sp-base rounded-lg m-2 mr-0 overflow-hidden">
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-sp-text-muted">
          Your Lessons
        </h2>
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
                  className={`w-full text-left px-3 py-2.5 rounded-md transition-colors flex items-center gap-3 group ${
                    isActive
                      ? 'bg-sp-highlight'
                      : 'hover:bg-sp-elevated'
                  }`}
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
