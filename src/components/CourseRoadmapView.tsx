import {
  COURSE_CHAPTERS,
  GUITAR_COURSES,
  type CoursePracticeMode,
  type GuitarCourse,
} from '../data/guitarCourses';
import {
  getFrontierCourse,
  isCourseUnlocked,
  type CourseProgressStore,
} from '../utils/courseProgress';

interface CourseRoadmapViewProps {
  progress: CourseProgressStore;
  onSelectCourse: (course: GuitarCourse, initialMode?: CoursePracticeMode) => void;
  onToggleUnlockAll: () => void;
  onOpenSetup: () => void;
  showSetupBanner: boolean;
}

const MODE_BADGES: ReadonlyArray<{ id: CoursePracticeMode; label: string }> = [
  { id: 'play', label: 'Play' },
  { id: 'loop', label: 'Loop' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'hidden', label: 'Hidden' },
];

// Winding S-curve horizontal offsets (authored from our offline design-seed exploration)
const NODE_OFFSETS = ['md:ml-0', 'md:ml-14', 'md:ml-6', 'md:ml-16'] as const;

export function CourseRoadmapView({
  progress,
  onSelectCourse,
  onToggleUnlockAll,
  onOpenSetup,
  showSetupBanner,
}: CourseRoadmapViewProps) {
  const frontier = getFrontierCourse(progress, GUITAR_COURSES);

  const unlockedCount = GUITAR_COURSES.filter((c) =>
    isCourseUnlocked(c, progress, GUITAR_COURSES),
  ).length;

  const completedCount = GUITAR_COURSES.filter(
    (c) => progress.courses[c.id]?.completed,
  ).length;

  const totalStars = GUITAR_COURSES.reduce(
    (sum, c) => sum + (progress.courses[c.id]?.stars ?? 0),
    0,
  );

  const totalModeMasteries = GUITAR_COURSES.reduce(
    (sum, c) => sum + (progress.courses[c.id]?.completedModes.length ?? 0),
    0,
  );

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-8 pb-16">
      {showSetupBanner && (
        <div className="rounded-xl p-4 bg-sp-green/12 border border-sp-green/35 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-sp-green">
              First-Time Guitar Check
            </div>
            <p className="text-sm text-sp-text-sub mt-0.5">
              Connect your audio interface or microphone and check your guitar tuning before starting Chapter I.
            </p>
          </div>
          <button type="button" onClick={onOpenSetup} className="sp-btn-secondary shrink-0">
            Audio &amp; Tuner Setup
          </button>
        </div>
      )}

      {/* Hero Journey Summary Card */}
      <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#192231] via-[#141820] to-[#111318] p-6 shadow-xl">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-2 max-w-xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/8 border border-white/10 text-[11px] font-extrabold uppercase tracking-widest text-sp-green">
              <span>Guitar Mastery Roadmap</span>
              <span className="text-white/30">&bull;</span>
              <span className="text-sp-text-sub">
                {completedCount} / {GUITAR_COURSES.length} Completed
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Up Next: {frontier.title}
            </h1>
            <p className="text-sm text-sp-text-sub leading-relaxed">
              {frontier.subtitle} Finish each course at 60%+ accuracy to unlock the next stage, then master it across{' '}
              <strong className="text-white">Loop</strong>,{' '}
              <strong className="text-white">Shadowing</strong>, and{' '}
              <strong className="text-white">Hidden Notes</strong> modes.
            </p>

            <div className="pt-2 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => onSelectCourse(frontier, 'play')}
                className="sp-btn-primary-compact"
              >
                Continue Course #{frontier.order} &rarr;
              </button>
              <button
                type="button"
                onClick={onToggleUnlockAll}
                className={`px-3.5 py-2 rounded-full text-xs font-bold border transition-colors ${
                  progress.unlockAll
                    ? 'bg-amber-400/20 border-amber-400/50 text-amber-300'
                    : 'bg-white/5 border-white/10 text-sp-text-muted hover:text-white'
                }`}
                title="Toggle between progressive course unlocking and free-roam access"
              >
                {progress.unlockAll ? 'Free Roam: All Unlocked' : 'Unlock All (Preview)'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 shrink-0">
            <StatTile
              label="Unlocked"
              value={`${unlockedCount}/${GUITAR_COURSES.length}`}
              accent="text-white"
            />
            <StatTile
              label="Stars"
              value={`${totalStars}/${GUITAR_COURSES.length * 3}`}
              accent="text-amber-400"
            />
            <StatTile
              label="Modes"
              value={`${totalModeMasteries}/${GUITAR_COURSES.length * 4}`}
              accent="text-sp-green"
            />
          </div>
        </div>
      </section>

      {/* Winding Chapter-by-Chapter Progression Path */}
      <div className="space-y-10">
        {COURSE_CHAPTERS.map((chapter) => {
          const chapterCourses = GUITAR_COURSES.filter(
            (c) => c.chapterId === chapter.id,
          ).sort((a, b) => a.order - b.order);

          const chapterCompleted = chapterCourses.filter(
            (c) => progress.courses[c.id]?.completed,
          ).length;

          return (
            <section key={chapter.id} className="space-y-5">
              {/* Chapter Banner */}
              <div
                className="rounded-xl border p-4 flex items-center justify-between gap-4 flex-wrap"
                style={{
                  borderColor: `${chapter.accentHex}40`,
                  background: `linear-gradient(135deg, ${chapter.glowRgba} 0%, rgba(20,22,28,0.88) 70%)`,
                }}
              >
                <div>
                  <div
                    className="text-xs font-extrabold uppercase tracking-widest"
                    style={{ color: chapter.accentHex }}
                  >
                    {chapter.title}
                  </div>
                  <p className="text-sm text-sp-text-sub mt-0.5">{chapter.subtitle}</p>
                </div>
                <div
                  className="px-3 py-1 rounded-full text-xs font-extrabold border"
                  style={{
                    color: chapter.accentHex,
                    borderColor: `${chapter.accentHex}55`,
                    backgroundColor: chapter.badgeBg,
                  }}
                >
                  {chapterCompleted} / {chapterCourses.length} Cleared
                </div>
              </div>

              {/* Winding Path Nodes */}
              <div className="relative pl-3 md:pl-6 space-y-4">
                {chapterCourses.map((course, idx) => {
                  const unlocked = isCourseUnlocked(course, progress, GUITAR_COURSES);
                  const record = progress.courses[course.id];
                  const completed = Boolean(record?.completed);
                  const isFrontier = course.id === frontier.id && !completed;
                  const stars = record?.stars ?? 0;
                  const completedModes = record?.completedModes ?? [];
                  const offsetClass = NODE_OFFSETS[(course.order - 1) % NODE_OFFSETS.length];
                  const hasConnectorBelow = idx < chapterCourses.length - 1;

                  return (
                    <div key={course.id} className={`relative ${offsetClass} transition-all`}>
                      {/* Vertical connector spine between nodes */}
                      {hasConnectorBelow && (
                        <div
                          aria-hidden
                          className="absolute left-8 top-16 -bottom-5 w-0.5 pointer-events-none"
                          style={{
                            background: completed
                              ? `linear-gradient(to bottom, ${chapter.accentHex}, rgba(255,255,255,0.18))`
                              : 'rgba(255,255,255,0.10)',
                          }}
                        />
                      )}

                      <div
                        className={`rounded-2xl border p-4 md:p-5 transition-all ${
                          !unlocked
                            ? 'bg-sp-base/45 border-white/8 opacity-65'
                            : isFrontier
                              ? 'bg-[#191f2a] border-white/30 shadow-lg'
                              : completed
                                ? 'bg-[#161b22] border-white/15 hover:border-white/30'
                                : 'bg-sp-base border-white/12 hover:border-white/25'
                        }`}
                        style={
                          isFrontier
                            ? {
                                boxShadow: `0 0 0 1px ${chapter.accentHex}55, 0 12px 32px -12px ${chapter.glowRgba}`,
                              }
                            : undefined
                        }
                      >
                        <div className="flex items-start gap-4">
                          {/* Course Medallion */}
                          <button
                            type="button"
                            disabled={!unlocked}
                            onClick={() => unlocked && onSelectCourse(course, 'play')}
                            className={`relative w-16 h-16 rounded-2xl shrink-0 flex flex-col items-center justify-center font-extrabold transition-transform ${
                              unlocked ? 'hover:scale-105 cursor-pointer' : 'cursor-not-allowed'
                            }`}
                            style={{
                              backgroundColor: !unlocked
                                ? '#1e222a'
                                : completed
                                  ? chapter.accentHex
                                  : chapter.badgeBg,
                              color: !unlocked
                                ? '#6b7280'
                                : completed
                                  ? '#090b0e'
                                  : chapter.accentHex,
                              border: `2px solid ${
                                !unlocked ? 'rgba(255,255,255,0.08)' : chapter.accentHex
                              }`,
                            }}
                          >
                            {!unlocked ? (
                              <LockIcon />
                            ) : completed ? (
                              <>
                                <CheckIcon />
                                <span className="text-[10px] font-black uppercase tracking-tight mt-0.5">
                                  #{course.order}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="text-[10px] uppercase tracking-widest opacity-80">
                                  Stage
                                </span>
                                <span className="text-xl leading-none">{course.order}</span>
                              </>
                            )}
                          </button>

                          {/* Course Details + Mode Launchers */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className="text-[11px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full"
                                  style={{
                                    backgroundColor: chapter.badgeBg,
                                    color: chapter.accentHex,
                                  }}
                                >
                                  {course.styleLabel}
                                </span>
                                <span className="text-xs text-sp-text-muted font-semibold">
                                  {course.totalBars} Bars &middot; {course.tempoBpm} BPM &middot;{' '}
                                  {course.keySignature}
                                </span>
                                {isFrontier && (
                                  <span className="px-2 py-0.5 rounded-full bg-sp-green text-black text-[10px] font-black uppercase tracking-wider">
                                    Current Stage
                                  </span>
                                )}
                              </div>

                              {/* 3-Star Mastery Display */}
                              <div className="flex items-center gap-1" title={`${stars}/3 stars`}>
                                {[1, 2, 3].map((s) => (
                                  <StarIcon key={s} filled={s <= stars} />
                                ))}
                                {record && (
                                  <span className="text-xs font-bold text-sp-text-sub ml-1 tabular-nums">
                                    {Math.round(record.bestAccuracy * 100)}%
                                  </span>
                                )}
                              </div>
                            </div>

                            <h3 className="text-lg font-extrabold text-white mt-1">
                              {course.title}
                            </h3>
                            <p className="text-xs text-sp-text-sub mt-0.5 leading-relaxed">
                              {course.subtitle}
                            </p>

                            {unlocked ? (
                              <div className="mt-3.5 flex items-center justify-between gap-3 flex-wrap">
                                {/* 4 Mode Pills on Every Unlocked Course */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {MODE_BADGES.map((m) => {
                                    const done = completedModes.includes(m.id);
                                    return (
                                      <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => onSelectCourse(course, m.id)}
                                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors inline-flex items-center gap-1.5 ${
                                          done
                                            ? 'bg-sp-green/18 border-sp-green/50 text-sp-green hover:bg-sp-green/25'
                                            : 'bg-white/5 border-white/12 text-sp-text-sub hover:text-white hover:border-white/30'
                                        }`}
                                      >
                                        <span>{m.label}</span>
                                        {done && <span aria-hidden>&#10003;</span>}
                                      </button>
                                    );
                                  })}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => onSelectCourse(course, 'play')}
                                  className="px-4 py-1.5 rounded-full text-xs font-extrabold text-black transition-transform hover:scale-105"
                                  style={{ backgroundColor: chapter.accentHex }}
                                >
                                  {completed ? 'Replay Stage' : 'Start Stage'} &rarr;
                                </button>
                              </div>
                            ) : (
                              <p className="mt-2.5 text-xs font-semibold text-sp-text-muted flex items-center gap-1.5">
                                <span>Locked &mdash; finish Stage #{course.order - 1} at 60%+ to unlock</span>
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="px-3.5 py-2.5 rounded-xl bg-black/35 border border-white/10 text-center min-w-[82px]">
      <div className="text-[10px] font-bold uppercase tracking-widest text-sp-text-muted">
        {label}
      </div>
      <div className={`text-lg font-extrabold tabular-nums mt-0.5 ${accent}`}>{value}</div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 20 20"
      fill={filled ? '#FBBF24' : 'none'}
      stroke={filled ? '#FBBF24' : '#4B5563'}
      strokeWidth="1.6"
      aria-hidden
    >
      <path d="M10 2.2l2.35 4.76 5.25.76-3.8 3.7.9 5.23L10 14.18l-4.7 2.47.9-5.23-3.8-3.7 5.25-.76L10 2.2z" />
    </svg>
  );
}
