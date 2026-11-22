import { useState } from 'react';
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
import { MamboCoachCard, type MamboMood } from './MamboMascot';
import { RISO_CHAPTER_PALETTE } from './Sidebar';

interface CourseRoadmapViewProps {
  progress: CourseProgressStore;
  onSelectCourse: (course: GuitarCourse, initialMode?: CoursePracticeMode) => void;
  onToggleUnlockAll: () => void;
  onOpenSetup: () => void;
  showSetupBanner: boolean;
}

const MODE_BADGES: ReadonlyArray<{ id: CoursePracticeMode; label: string }> = [
  { id: 'play', label: 'PLAY' },
  { id: 'loop', label: 'LOOP' },
  { id: 'shadow', label: 'SHADOW' },
  { id: 'hidden', label: 'HIDDEN' },
];

// Winding S-curve offsets along the illustrated guitar fretboard path
const S_CURVE_OFFSETS = [0, 44, 16, 56] as const;

const MASCOT_TIPS: ReadonlyArray<{ mood: MamboMood; quote: string; subline: string }> = [
  {
    mood: 'groove',
    quote: 'No streak guilt — 38 min grooved this week! Ready to slide into Sunburst Soul?',
    subline: 'WEEKLY FLOW · 142 / 180 MIN TARGET',
  },
  {
    mood: 'hype',
    quote: 'Pro move: run Loop Mode at 85% BPM and let +5% Auto carry your fingers!',
    subline: 'SPEED-BUILDER TIP · ZERO PRESSURE',
  },
  {
    mood: 'chill',
    quote: 'Miss a note mid-solo? Keep riding the pocket — recovery beats perfection!',
    subline: 'GROOVE RECOVERY PHILOSOPHY',
  },
  {
    mood: 'celebrate',
    quote: 'You already crushed 6 Plectrum Stars in Chapter I. One more unlocks Arena Rock!',
    subline: 'CHAPTER I PROGRESS · 2 / 3 CLEARED',
  },
];

export function CourseRoadmapView({
  progress,
  onSelectCourse,
  onToggleUnlockAll,
  onOpenSetup,
  showSetupBanner,
}: CourseRoadmapViewProps) {
  const [tipIndex, setTipIndex] = useState(0);
  const currentTip = MASCOT_TIPS[tipIndex % MASCOT_TIPS.length];

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

  const ch1Completed = GUITAR_COURSES.filter(
    (c) => c.chapterId === 'midnight-blues' && progress.courses[c.id]?.completed,
  ).length;

  return (
    <div className="min-h-full bg-[#FFFBF0] riso-dots-subtle px-5 md:px-7 py-6 pb-16">
      <div className="max-w-[1260px] mx-auto space-y-6">
        {showSetupBanner && (
          <div className="neo-card bg-[#D8FF2E] p-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-[#121212] text-[#D8FF2E] flex items-center justify-center font-mono text-lg font-bold shrink-0">
                ⚡
              </span>
              <div>
                <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-[#121212]">
                  FIRST-TIME GUITAR CHECK
                </div>
                <p className="text-sm font-bold text-[#121212]">
                  Plug in your interface or mic and tune up before dropping into Chapter I.
                </p>
              </div>
            </div>
            <button type="button" onClick={onOpenSetup} className="neo-btn-paper px-4 py-2 text-xs">
              AUDIO &amp; TUNER SETUP →
            </button>
          </div>
        )}

        {/* Main 2-Column Neo-Groove Zine Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_336px] gap-6 items-start">
          {/* LEFT COLUMN: Hero Banner + Winding Guitar-Neck Duolingo Roadmap */}
          <div className="space-y-7 min-w-0">
            {/* Hero Zine Banner */}
            <section className="neo-card-lg bg-white overflow-hidden relative">
              {/* Top Electric Risograph Tape Strip */}
              <div className="h-3 bg-[#121212] flex">
                <div className="w-1/3 bg-[#D8FF2E] border-r-2 border-[#121212]" />
                <div className="w-1/3 bg-[#2B59FF] border-r-2 border-[#121212]" />
                <div className="w-1/3 bg-[#FF3B7F]" />
              </div>

              <div className="p-5 md:p-6 flex items-start justify-between gap-5 flex-wrap">
                <div className="space-y-2.5 max-w-xl">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="neo-stamp bg-[#D8FF2E] text-[#121212]">
                      GUITAR ARCADE MAP
                    </span>
                    <span className="neo-stamp bg-[#FFF4D8] text-[#121212]">
                      {completedCount} / {GUITAR_COURSES.length} CONQUERED
                    </span>
                  </div>

                  <h1 className="font-syne text-2xl md:text-[30px] font-extrabold text-[#121212] leading-[1.08] tracking-tight">
                    Next Stop: {frontier.title}
                  </h1>

                  <p className="text-[13.5px] font-semibold text-[#423E37] leading-relaxed">
                    {frontier.subtitle} Hit <strong className="text-[#121212]">60%+ pocket accuracy</strong> to unlock the next fret station, then conquer{' '}
                    <strong className="text-[#121212]">Loop</strong>,{' '}
                    <strong className="text-[#121212]">Shadow</strong>, and{' '}
                    <strong className="text-[#121212]">Hidden</strong> modes.
                  </p>

                  <div className="pt-1.5 flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => onSelectCourse(frontier, 'play')}
                      className="neo-btn-lime px-5 py-2.5 text-sm"
                    >
                      <span>PLAY STAGE #{frontier.order} NOW</span>
                      <span aria-hidden>→</span>
                    </button>

                    <button
                      type="button"
                      onClick={onToggleUnlockAll}
                      className={`neo-btn-3d px-3.5 py-2 text-xs ${
                        progress.unlockAll
                          ? 'bg-[#FF8A00] text-[#121212]'
                          : 'bg-[#FFF4D8] text-[#121212]'
                      }`}
                    >
                      {progress.unlockAll ? '★ FREE ROAM: ALL OPEN' : 'UNLOCK ALL (PREVIEW)'}
                    </button>
                  </div>
                </div>

                {/* Tactile Stamp Stats */}
                <div className="grid grid-cols-3 gap-2.5 shrink-0">
                  <StatStamp
                    label="OPEN"
                    value={`${unlockedCount}/${GUITAR_COURSES.length}`}
                    bg="#DCE5FF"
                  />
                  <StatStamp
                    label="STARS"
                    value={`${totalStars}/${GUITAR_COURSES.length * 3}`}
                    bg="#D8FF2E"
                  />
                  <StatStamp
                    label="MODES"
                    value={`${totalModeMasteries}/${GUITAR_COURSES.length * 4}`}
                    bg="#FFD9E7"
                  />
                </div>
              </div>
            </section>

            {/* Winding Chapter-by-Chapter Guitar-Neck Journey Map */}
            <div className="space-y-9">
              {COURSE_CHAPTERS.map((chapter) => {
                const chapterCourses = GUITAR_COURSES.filter(
                  (c) => c.chapterId === chapter.id,
                ).sort((a, b) => a.order - b.order);

                const chapterCompleted = chapterCourses.filter(
                  (c) => progress.courses[c.id]?.completed,
                ).length;

                const riso = RISO_CHAPTER_PALETTE[chapter.id];

                return (
                  <section key={chapter.id} className="space-y-5">
                    {/* Sticker-Style Chapter Banner */}
                    <div
                      className="border-[2.5px] border-[#121212] rounded-2xl shadow-brutal px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap relative overflow-hidden"
                      style={{ backgroundColor: riso.bg, color: riso.text }}
                    >
                      {/* Subtle halftone strip inside banner */}
                      <div className="absolute inset-y-0 right-0 w-36 riso-dots opacity-35 pointer-events-none" />

                      <div className="relative z-10 flex items-center gap-3.5">
                        <span className="px-2.5 py-1 rounded-xl bg-[#121212] text-[#D8FF2E] font-mono text-xs font-bold uppercase tracking-wider -rotate-2 shrink-0">
                          CH {chapter.chapterNumber}
                        </span>
                        <div>
                          <h2 className="font-syne text-lg md:text-xl font-extrabold tracking-tight leading-tight">
                            {chapter.title.replace(/^Chapter [IVX]+ · /, '')}
                          </h2>
                          <p
                            className="text-xs font-bold mt-0.5"
                            style={{ opacity: riso.text === '#FFFFFF' ? 0.9 : 0.8 }}
                          >
                            {chapter.subtitle}
                          </p>
                        </div>
                      </div>

                      <div className="relative z-10 px-3 py-1 rounded-full bg-white text-[#121212] border-2 border-[#121212] font-mono text-xs font-bold shadow-brutal-xs">
                        {chapterCompleted} / {chapterCourses.length} CLEARED
                      </div>
                    </div>

                    {/* Winding Illustrated Guitar-Fretboard Path */}
                    <div className="relative space-y-5 pl-1 md:pl-2">
                      {chapterCourses.map((course, idx) => {
                        const unlocked = isCourseUnlocked(course, progress, GUITAR_COURSES);
                        const record = progress.courses[course.id];
                        const completed = Boolean(record?.completed);
                        const isFrontier = course.id === frontier.id && !completed;
                        const stars = record?.stars ?? 0;
                        const completedModes = record?.completedModes ?? [];

                        const offsetPx =
                          S_CURVE_OFFSETS[(course.order - 1) % S_CURVE_OFFSETS.length];
                        const nextOffsetPx =
                          idx < chapterCourses.length - 1
                            ? S_CURVE_OFFSETS[course.order % S_CURVE_OFFSETS.length]
                            : offsetPx;

                        const hasConnectorBelow = idx < chapterCourses.length - 1;

                        return (
                          <div
                            key={course.id}
                            className="relative transition-all"
                            style={{ paddingLeft: `${offsetPx}px` }}
                          >
                            {/* Winding Guitar-Neck Fretboard SVG Connector between Medallions */}
                            {hasConnectorBelow && (
                              <FretboardRoadConnector
                                deltaX={nextOffsetPx - offsetPx}
                                lit={completed}
                                accentColor={riso.bg}
                              />
                            )}

                            <div className="relative z-10 flex items-center gap-4 md:gap-5">
                              {/* Chunky Circular 3D Push-Medallion (Duolingo-style) */}
                              <div className="relative shrink-0">
                                {/* Bouncing "PLAY NOW!" Comic Tag above Frontier Node */}
                                {isFrontier && (
                                  <div className="neo-bob absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap z-20">
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FF3B7F] text-white border-2 border-[#121212] font-mono text-[10px] font-bold uppercase tracking-wider shadow-brutal-xs">
                                      ★ PLAY NOW!
                                    </span>
                                  </div>
                                )}

                                <button
                                  type="button"
                                  disabled={!unlocked}
                                  onClick={() => unlocked && onSelectCourse(course, 'play')}
                                  className={`w-[78px] h-[78px] rounded-full border-[3px] border-[#121212] border-b-[7px] flex flex-col items-center justify-center transition-all duration-100 ${
                                    !unlocked
                                      ? 'bg-[#EDE2CA] text-[#7D7567] cursor-not-allowed'
                                      : isFrontier
                                        ? 'bg-[#D8FF2E] text-[#121212] neo-frontier-glow hover:-translate-y-0.5 active:translate-y-[3px] active:border-b-[3px] cursor-pointer'
                                        : completed
                                          ? 'bg-[#1CE088] text-[#121212] shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-[3px] active:border-b-[3px] cursor-pointer'
                                          : 'bg-white text-[#121212] shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-[3px] active:border-b-[3px] cursor-pointer'
                                  }`}
                                  aria-label={`Stage ${course.order}: ${course.title}`}
                                >
                                  {!unlocked ? (
                                    <LockIcon />
                                  ) : completed ? (
                                    <>
                                      <CheckIcon />
                                      <span className="font-mono text-[10px] font-bold leading-none mt-0.5">
                                        #{course.order}
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="font-mono text-[9px] font-bold uppercase tracking-widest">
                                        FRET
                                      </span>
                                      <span className="font-syne text-2xl font-extrabold leading-none">
                                        {course.order}
                                      </span>
                                    </>
                                  )}
                                </button>
                              </div>

                              {/* Station Card */}
                              <div
                                className={`flex-1 min-w-0 rounded-2xl border-[2.5px] border-[#121212] p-4 transition-all ${
                                  !unlocked
                                    ? 'bg-[#FAF3E3] opacity-80 shadow-brutal-xs'
                                    : isFrontier
                                      ? 'bg-white shadow-brutal-lg ring-4 ring-[#D8FF2E]'
                                      : 'bg-white shadow-brutal hover:-translate-y-0.5'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span
                                      className="px-2 py-0.5 rounded-md border-2 border-[#121212] font-mono text-[10px] font-bold uppercase"
                                      style={{
                                        backgroundColor: unlocked ? riso.light : '#EDE2CA',
                                        color: '#121212',
                                      }}
                                    >
                                      {course.styleLabel}
                                    </span>
                                    <span className="font-mono text-[11px] font-bold text-[#57534A]">
                                      {course.totalBars} BARS · {course.tempoBpm} BPM ·{' '}
                                      {course.keySignature}
                                    </span>
                                    {isFrontier && (
                                      <span className="px-2 py-0.5 rounded-full bg-[#D8FF2E] border-2 border-[#121212] font-mono text-[10px] font-bold text-[#121212] uppercase">
                                        FRONTIER
                                      </span>
                                    )}
                                  </div>

                                  {/* Chunky 3-Star Guitar Plectrum Stamps */}
                                  <div
                                    className="flex items-center gap-1.5 shrink-0"
                                    title={`${stars}/3 plectrum stars`}
                                  >
                                    {[1, 2, 3].map((s) => (
                                      <PlectrumStarStamp key={s} filled={s <= stars} />
                                    ))}
                                    {record && (
                                      <span className="ml-1 px-2 py-0.5 rounded-md bg-[#121212] text-[#D8FF2E] font-mono text-[11px] font-bold tabular-nums">
                                        {Math.round(record.bestAccuracy * 100)}%
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <h3 className="font-syne text-lg font-extrabold text-[#121212] mt-1.5 leading-snug">
                                  {course.title}
                                </h3>
                                <p className="text-xs font-semibold text-[#57534A] mt-0.5 leading-relaxed">
                                  {course.subtitle}
                                </p>

                                {unlocked ? (
                                  <div className="mt-3 pt-2.5 border-t-2 border-dashed border-[#121212]/15 flex items-center justify-between gap-3 flex-wrap">
                                    {/* 4 Mode Launcher Pills */}
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {MODE_BADGES.map((m) => {
                                        const done = completedModes.includes(m.id);
                                        return (
                                          <button
                                            key={m.id}
                                            type="button"
                                            onClick={() => onSelectCourse(course, m.id)}
                                            className={`px-2.5 py-1 rounded-lg border-2 border-[#121212] font-mono text-[10px] font-bold transition-all inline-flex items-center gap-1 ${
                                              done
                                                ? 'bg-[#D8FF2E] text-[#121212] shadow-brutal-xs hover:brightness-95'
                                                : 'bg-[#FFFBF0] text-[#423E37] hover:bg-[#FFF4D8] hover:text-[#121212]'
                                            }`}
                                          >
                                            <span>{m.label}</span>
                                            {done && <span aria-hidden>✓</span>}
                                          </button>
                                        );
                                      })}
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => onSelectCourse(course, 'play')}
                                      className={`px-4 py-1.5 text-xs ${
                                        isFrontier
                                          ? 'neo-btn-lime'
                                          : completed
                                            ? 'neo-btn-paper'
                                            : 'neo-btn-cobalt'
                                      }`}
                                    >
                                      {isFrontier
                                        ? 'JAM STAGE →'
                                        : completed
                                          ? 'REPLAY →'
                                          : 'START →'}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="mt-2.5 pt-2 border-t-2 border-dashed border-[#121212]/15 flex items-center justify-between gap-2">
                                    <span className="font-mono text-[11px] font-bold text-[#6E695F]">
                                      🔒 Clear Stage #{course.order - 1} at 60%+ to unlock
                                    </span>
                                    <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-[#EDE2CA] text-[#57534A]">
                                      LOCKED
                                    </span>
                                  </div>
                                )}
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

          {/* RIGHT COLUMN: Playful Weekly Groove Quests & Mambo Mascot */}
          <aside className="space-y-5 xl:sticky xl:top-6">
            {/* Mambo Mascot Coach Card */}
            <MamboCoachCard
              mood={currentTip.mood}
              badgeText="MAMBO BUDDY"
              quote={currentTip.quote}
              subline={currentTip.subline}
              action={
                <button
                  type="button"
                  onClick={() => setTipIndex((i) => i + 1)}
                  className="neo-btn-paper px-3 py-1 text-[11px] rounded-xl font-mono"
                >
                  NEXT COACHING TIP ↻
                </button>
              }
            />

            {/* Weekly Groove Quests (Zero Punitive Streaks!) */}
            <section className="neo-card bg-white p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#2B59FF]">
                    WEEKLY GROOVE QUESTS
                  </span>
                  <h2 className="font-syne text-lg font-extrabold text-[#121212] leading-tight">
                    Play For Joy, Not Streaks
                  </h2>
                </div>
                <span className="px-2 py-1 rounded-lg bg-[#D8FF2E] border-2 border-[#121212] font-mono text-[10px] font-bold text-[#121212] -rotate-3 shrink-0 shadow-brutal-xs">
                  NO GUILT
                </span>
              </div>

              <div className="space-y-3.5">
                <QuestBar
                  title="Weekly Groove Minutes"
                  progressLabel="142 / 180 MIN"
                  pct={79}
                  fillHex="#D8FF2E"
                  badge="+38m TODAY"
                />
                <QuestBar
                  title="Practice Modes Sampled"
                  progressLabel="3 / 4 MODES"
                  pct={75}
                  fillHex="#2B59FF"
                  badge="PLAY · LOOP · SHADOW"
                />
                <QuestBar
                  title="Chapter I Blues Mastery"
                  progressLabel={`${ch1Completed} / 3 STAGES`}
                  pct={Math.round((ch1Completed / 3) * 100)}
                  fillHex="#FF3B7F"
                  badge="UNLOCKS ARENA ROCK"
                />
              </div>

              <div className="pt-2 border-t-2 border-dashed border-[#121212]/15 flex items-center justify-between text-xs">
                <span className="font-bold text-[#423E37]">Weekly Reset</span>
                <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-[#FFF4D8] border border-[#121212] text-[#121212]">
                  MON · KEEP ALL STARS
                </span>
              </div>
            </section>

            {/* Zine Cutout Manifesto + Tuner Quick Launch */}
            <section className="neo-card bg-[#121212] text-[#FFFBF0] p-4 space-y-3 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded bg-[#FF8A00] text-[#121212] font-mono text-[10px] font-bold uppercase">
                  STUDIO ZINE NOTE
                </span>
                <span className="font-mono text-[10px] font-bold text-[#D8FF2E]">
                  BPM + TUNER READY
                </span>
              </div>
              <p className="font-syne text-base font-extrabold leading-snug text-white">
                Miss a day? Zero streak freeze fees. Pick up your guitar whenever the groove calls.
              </p>
              <button
                type="button"
                onClick={onOpenSetup}
                className="neo-btn-lime w-full py-2 text-xs"
              >
                CHECK GUITAR TUNER &amp; AMP →
              </button>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function StatStamp({
  label,
  value,
  bg,
}: {
  label: string;
  value: string;
  bg: string;
}) {
  return (
    <div
      className="px-3 py-2 rounded-xl border-2 border-[#121212] shadow-brutal-xs text-center min-w-[82px]"
      style={{ backgroundColor: bg }}
    >
      <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#121212]/75">
        {label}
      </div>
      <div className="font-syne text-lg font-extrabold text-[#121212] tabular-nums leading-tight mt-0.5">
        {value}
      </div>
    </div>
  );
}

function QuestBar({
  title,
  progressLabel,
  pct,
  fillHex,
  badge,
}: {
  title: string;
  progressLabel: string;
  pct: number;
  fillHex: string;
  badge: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-extrabold text-[#121212]">{title}</span>
        <span className="font-mono text-[11px] font-bold text-[#121212] tabular-nums">
          {progressLabel}
        </span>
      </div>
      <div className="h-4 w-full rounded-full bg-[#FFF4D8] border-2 border-[#121212] overflow-hidden p-0.5">
        <div
          className="h-full rounded-full border-r-2 border-[#121212] transition-all duration-300"
          style={{
            width: `${Math.max(8, Math.min(100, pct))}%`,
            backgroundColor: fillHex,
          }}
        />
      </div>
      <div className="font-mono text-[10px] font-bold text-[#57534A]">{badge}</div>
    </div>
  );
}

/**
 * Stylized curved guitar-fretboard road connecting consecutive course medallions.
 */
function FretboardRoadConnector({
  deltaX,
  lit,
  accentColor,
}: {
  deltaX: number;
  lit: boolean;
  accentColor: string;
}) {
  const startX = 39;
  const endX = 39 + deltaX;
  const midY = 58;
  const svgWidth = Math.max(startX, endX) + 40;

  return (
    <svg
      aria-hidden
      width={svgWidth}
      height={120}
      viewBox={`0 0 ${svgWidth} 120`}
      fill="none"
      className="absolute top-[74px] left-0 pointer-events-none z-0 overflow-visible"
    >
      {/* Fretboard neck outer ink outline */}
      <path
        d={`M ${startX} 0 C ${startX} ${midY}, ${endX} ${midY}, ${endX} 112`}
        stroke="#121212"
        strokeWidth="22"
        strokeLinecap="round"
      />
      {/* Fretboard inner wood/accent body */}
      <path
        d={`M ${startX} 0 C ${startX} ${midY}, ${endX} ${midY}, ${endX} 112`}
        stroke={lit ? accentColor : '#3B342D'}
        strokeWidth="16"
        strokeLinecap="round"
      />
      {/* Dashed fret wire bars along path */}
      <path
        d={`M ${startX} 8 C ${startX} ${midY}, ${endX} ${midY}, ${endX} 104`}
        stroke={lit ? '#D8FF2E' : '#FFFBF0'}
        strokeWidth="14"
        strokeDasharray="3 17"
        opacity={lit ? '0.9' : '0.45'}
      />
      {/* Pearloid fret inlay dot at midpoint */}
      <circle
        cx={(startX + endX) / 2}
        cy={midY}
        r="4"
        fill="#FFFBF0"
        stroke="#121212"
        strokeWidth="2"
      />
    </svg>
  );
}

/**
 * Custom guitar-pick shaped 3-star stamp.
 */
function PlectrumStarStamp({ filled }: { filled: boolean }) {
  return (
    <svg
      width="22"
      height="24"
      viewBox="0 0 26 28"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      {/* Guitar pick silhouette */}
      <path
        d="M13 2C6.5 2 2.5 5.5 2.5 11.2C2.5 17.8 9.2 25.5 13 26.2C16.8 25.5 23.5 17.8 23.5 11.2C23.5 5.5 19.5 2 13 2Z"
        fill={filled ? '#FF8A00' : '#F5E9CE'}
        stroke="#121212"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      {/* Inner star */}
      <path
        d="M13 6.8L14.55 10.1L18.1 10.55L15.45 12.95L16.15 16.45L13 14.7L9.85 16.45L10.55 12.95L7.9 10.55L11.45 10.1L13 6.8Z"
        fill={filled ? '#D8FF2E' : '#D4C8AE'}
        stroke="#121212"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="2.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
