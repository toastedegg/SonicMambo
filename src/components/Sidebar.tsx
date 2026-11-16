import {
  COURSE_CHAPTERS,
  GUITAR_COURSES,
  type GuitarCourse,
} from '../data/guitarCourses';
import {
  isCourseUnlocked,
  type CourseProgressStore,
} from '../utils/courseProgress';

export type NavViewKind = 'roadmap' | 'setup' | 'history';

interface SidebarProps {
  activeNav: NavViewKind | null;
  activeCourseId: string | null;
  progress: CourseProgressStore;
  onNavigate: (nav: NavViewKind) => void;
  onSelectCourse: (course: GuitarCourse) => void;
}

export function Sidebar({
  activeNav,
  activeCourseId,
  progress,
  onNavigate,
  onSelectCourse,
}: SidebarProps) {
  return (
    <aside className="sp-sidebar">
      <nav className="px-2 pt-3 pb-2 border-b border-white/5">
        <ul className="flex flex-col gap-0.5">
          <TopLevelItem
            label="Course Roadmap"
            sublabel="Progressive guitar path"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M4 19l5-5 4 4 7-9"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="4" cy="19" r="2" fill="currentColor" />
                <circle cx="20" cy="9" r="2" fill="currentColor" />
              </svg>
            }
            active={activeNav === 'roadmap'}
            onClick={() => onNavigate('roadmap')}
          />

          <TopLevelItem
            label="Audio & Tuner"
            sublabel="Mic input, Ch 1/2 & tune"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 3v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M8 7v6a4 4 0 0 0 8 0V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M5 12a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 19v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
            active={activeNav === 'setup'}
            onClick={() => onNavigate('setup')}
          />

          <TopLevelItem
            label="Practice History"
            sublabel="Takes & accuracy log"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
            active={activeNav === 'history'}
            onClick={() => onNavigate('history')}
          />
        </ul>
      </nav>

      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {COURSE_CHAPTERS.map((chapter) => {
          const courses = GUITAR_COURSES.filter((c) => c.chapterId === chapter.id);
          return (
            <div key={chapter.id}>
              <div className="px-3 pb-1.5 flex items-center justify-between">
                <h2
                  className="text-[10px] font-extrabold uppercase tracking-widest truncate"
                  style={{ color: chapter.accentHex }}
                >
                  Ch {chapter.chapterNumber} &middot; {chapter.title.split('·')[1]?.trim()}
                </h2>
              </div>
              <ul className="flex flex-col gap-0.5">
                {courses.map((course) => {
                  const unlocked = isCourseUnlocked(course, progress, GUITAR_COURSES);
                  const completed = Boolean(progress.courses[course.id]?.completed);
                  const isActive = activeCourseId === course.id;

                  return (
                    <li key={course.id}>
                      <button
                        type="button"
                        disabled={!unlocked}
                        onClick={() => unlocked && onSelectCourse(course)}
                        className={`sp-sidebar-item group ${
                          isActive
                            ? 'sp-sidebar-item-active'
                            : unlocked
                              ? 'sp-sidebar-item-idle'
                              : 'opacity-45 cursor-not-allowed px-3 py-2 rounded-md flex items-center gap-3 w-full text-left'
                        }`}
                      >
                        {isActive ? (
                          <span
                            className="w-1 h-7 rounded-full shrink-0"
                            style={{ backgroundColor: chapter.accentHex }}
                          />
                        ) : (
                          <span className="w-5 text-center shrink-0 text-[11px] font-extrabold text-sp-text-muted">
                            {!unlocked ? (
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                className="inline"
                                aria-hidden
                              >
                                <rect
                                  x="5"
                                  y="11"
                                  width="14"
                                  height="10"
                                  rx="2"
                                  stroke="currentColor"
                                  strokeWidth="2.2"
                                />
                                <path
                                  d="M8 11V7a4 4 0 0 1 8 0v4"
                                  stroke="currentColor"
                                  strokeWidth="2.2"
                                />
                              </svg>
                            ) : completed ? (
                              <span style={{ color: chapter.accentHex }}>&#10003;</span>
                            ) : (
                              course.order
                            )}
                          </span>
                        )}

                        <div className="flex flex-col min-w-0 flex-1">
                          <span
                            className={`text-xs font-bold truncate ${
                              isActive
                                ? 'text-white'
                                : unlocked
                                  ? 'text-sp-text group-hover:text-white'
                                  : 'text-sp-text-muted'
                            }`}
                          >
                            {course.title}
                          </span>
                          <span className="text-[10px] text-sp-text-muted">
                            {course.totalBars} bars &middot; {course.tempoBpm} BPM
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
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
        className={`sp-sidebar-item group ${
          active ? 'sp-sidebar-item-active' : 'sp-sidebar-item-idle'
        }`}
      >
        {active && <span className="w-1 h-7 rounded-full bg-sp-green shrink-0" />}
        <span
          className={`shrink-0 ${!active ? 'ml-1' : ''} ${
            active ? 'text-sp-green' : 'text-sp-text-sub group-hover:text-white'
          }`}
        >
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
            <span className="text-[11px] text-sp-text-muted truncate">{sublabel}</span>
          )}
        </div>
      </button>
    </li>
  );
}
