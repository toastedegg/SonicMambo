import {
  COURSE_CHAPTERS,
  GUITAR_COURSES,
  type CourseChapterTheme,
  type GuitarCourse,
} from '../data/guitarCourses';
import {
  getFrontierCourse,
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

export const RISO_CHAPTER_PALETTE: Record<
  CourseChapterTheme['id'],
  { bg: string; text: string; light: string; short: string }
> = {
  'midnight-blues': {
    bg: '#2B59FF',
    text: '#FFFFFF',
    light: '#DCE5FF',
    short: 'CH I · MIDNIGHT BLUES',
  },
  'marshall-rock': {
    bg: '#FF3B7F',
    text: '#FFFFFF',
    light: '#FFD9E7',
    short: 'CH II · ARENA ROCK',
  },
  'sunburst-mastery': {
    bg: '#FF8A00',
    text: '#121212',
    light: '#FFE7C2',
    short: 'CH III · TWANG & LEAD',
  },
};

export function Sidebar({
  activeNav,
  activeCourseId,
  progress,
  onNavigate,
  onSelectCourse,
}: SidebarProps) {
  const frontier = getFrontierCourse(progress, GUITAR_COURSES);

  return (
    <aside className="sp-sidebar">
      {/* Zine Index Header */}
      <div className="px-3.5 py-2.5 bg-[#121212] text-[#FFFBF0] flex items-center justify-between shrink-0">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#D8FF2E]">
          ZINE INDEX // VOL. 03
        </span>
        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#2B59FF] text-white">
          8 STAGES
        </span>
      </div>

      {/* Primary Nav */}
      <nav className="p-2.5 border-b-[2.5px] border-[#121212] bg-[#FFFBF0]">
        <ul className="flex flex-col gap-1.5">
          <TopLevelItem
            label="Groove Roadmap"
            sublabel="Winding fretboard path"
            icon={
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M4 19l5-5 4 4 7-9"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="4" cy="19" r="2.2" fill="currentColor" />
                <circle cx="20" cy="9" r="2.2" fill="currentColor" />
              </svg>
            }
            active={activeNav === 'roadmap'}
            onClick={() => onNavigate('roadmap')}
          />

          <TopLevelItem
            label="Audio & Tuner"
            sublabel="Interface, Ch 1/2 & tune"
            icon={
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 3v11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M8 7v6a4 4 0 0 0 8 0V7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M5 12a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M12 19v2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            }
            active={activeNav === 'setup'}
            onClick={() => onNavigate('setup')}
          />

          <TopLevelItem
            label="Practice Log"
            sublabel="Takes & pocket scores"
            icon={
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2.4" />
                <path d="M12 7.5v4.5l3 2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            }
            active={activeNav === 'history'}
            onClick={() => onNavigate('history')}
          />
        </ul>
      </nav>

      {/* Scrollable Course Zine Index */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4 riso-dots-subtle">
        {COURSE_CHAPTERS.map((chapter) => {
          const courses = GUITAR_COURSES.filter((c) => c.chapterId === chapter.id);
          const riso = RISO_CHAPTER_PALETTE[chapter.id];

          return (
            <div key={chapter.id} className="space-y-1.5">
              <div className="px-1.5 flex items-center justify-between">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-md border-2 border-[#121212] font-mono text-[10px] font-bold uppercase tracking-wider shadow-brutal-xs"
                  style={{ backgroundColor: riso.bg, color: riso.text }}
                >
                  {riso.short}
                </span>
              </div>

              <ul className="flex flex-col gap-1">
                {courses.map((course) => {
                  const unlocked = isCourseUnlocked(course, progress, GUITAR_COURSES);
                  const record = progress.courses[course.id];
                  const completed = Boolean(record?.completed);
                  const isFrontier = course.id === frontier.id && !completed;
                  const isActive = activeCourseId === course.id;

                  return (
                    <li key={course.id}>
                      <button
                        type="button"
                        disabled={!unlocked}
                        onClick={() => unlocked && onSelectCourse(course)}
                        className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center gap-2.5 border-2 transition-all ${
                          isActive
                            ? 'bg-[#D8FF2E] border-[#121212] shadow-brutal-xs'
                            : isFrontier
                              ? 'bg-white border-[#121212] shadow-brutal-xs hover:bg-[#D8FF2E]/50'
                              : unlocked
                                ? 'bg-white/85 border-[#121212]/20 hover:bg-white hover:border-[#121212] hover:shadow-brutal-xs'
                                : 'bg-[#F5E9CE]/65 border-transparent opacity-65 cursor-not-allowed'
                        }`}
                      >
                        <span
                          className="w-6 h-6 rounded-lg border-2 border-[#121212] flex items-center justify-center shrink-0 font-mono text-[11px] font-bold"
                          style={{
                            backgroundColor: !unlocked
                              ? '#E6DAC0'
                              : completed
                                ? '#1CE088'
                                : isFrontier
                                  ? '#D8FF2E'
                                  : riso.light,
                            color: '#121212',
                          }}
                        >
                          {!unlocked ? (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2.5" />
                              <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2.5" />
                            </svg>
                          ) : completed ? (
                            '✓'
                          ) : (
                            course.order
                          )}
                        </span>

                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-extrabold text-[#121212] truncate">
                              {course.title}
                            </span>
                            {isFrontier && (
                              <span className="shrink-0 px-1.5 py-0.2 rounded bg-[#FF3B7F] text-white font-mono text-[9px] font-bold uppercase">
                                NEXT
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-1 mt-0.5">
                            <span className="font-mono text-[10px] font-bold text-[#57534A]">
                              {course.totalBars}B · {course.tempoBpm} BPM
                            </span>
                            {completed && record && (
                              <span className="font-mono text-[10px] font-bold text-[#FF8A00]">
                                {'★'.repeat(record.stars)}
                              </span>
                            )}
                          </div>
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
        <span
          className={`w-8 h-8 rounded-lg border-2 border-[#121212] flex items-center justify-center shrink-0 ${
            active ? 'bg-[#121212] text-[#D8FF2E]' : 'bg-[#FFF4D8] text-[#121212]'
          }`}
        >
          {icon}
        </span>
        <div className="flex flex-col min-w-0">
          <span className="text-[13px] font-extrabold text-[#121212] truncate leading-tight">
            {label}
          </span>
          {sublabel && (
            <span className="text-[11px] font-semibold text-[#57534A] truncate">
              {sublabel}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}
