import type { Lesson } from '../types/lesson';

interface SidebarProps {
  lessons: Lesson[];
  activeLessonId: string | null;
  onSelectLesson: (lesson: Lesson) => void;
}

export function Sidebar({ lessons, activeLessonId, onSelectLesson }: SidebarProps) {
  return (
    <aside className="sp-sidebar">
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
