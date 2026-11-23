import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackingTransport } from '../audio/backingTrackEngine';
import {
  COURSE_CHAPTERS,
  GUITAR_COURSES,
  type CourseChapterTheme,
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
  demoMode?: boolean;
}

interface IslandPoint {
  x: number; // SVG 1400x760 coordinate
  y: number;
}

const ACT_META: Record<
  CourseChapterTheme['id'],
  { actCode: string; shortTitle: string; accent: string; nextActLabel: string }
> = {
  'midnight-blues': {
    actCode: 'ACT I',
    shortTitle: 'MIDNIGHT BLUES ALLEY',
    accent: '#2B59FF',
    nextActLabel: 'ACT II',
  },
  'marshall-rock': {
    actCode: 'ACT II',
    shortTitle: 'ARENA BACKSTAGE',
    accent: '#FF8A00',
    nextActLabel: 'ACT III',
  },
  'sunburst-mastery': {
    actCode: 'ACT III',
    shortTitle: 'NASHVILLE TWANG HALL',
    accent: '#1CE088',
    nextActLabel: 'ENCORE',
  },
};

const MODE_BUTTONS: ReadonlyArray<{ id: CoursePracticeMode; icon: string; label: string }> = [
  { id: 'play', icon: '▶', label: 'PLAY' },
  { id: 'loop', icon: '↻', label: 'LOOP' },
  { id: 'shadow', icon: '👂', label: 'SHDW' },
  { id: 'hidden', icon: '🌑', label: 'HID' },
];

const SHORT_STAGE_TITLES: Record<string, string> = {
  'blues-1-smokestack': 'Smokestack Riff',
  'blues-2-texas-shuffle': 'Texas Shuffle',
  'blues-3-sunburst-verse': 'Sunburst Soul',
  'rock-4-backstage-riff': 'Backstage E5',
  'rock-5-midnight-highway': 'Midnight Highway',
  'rock-6-sunburst-chorus': 'Sunburst Chorus',
  'twang-7-nashville-hook': 'Nashville Hook',
  'twang-8-barnburner-finale': 'Barnburner Finale',
};

const ISLAND_COORDS_3: readonly IslandPoint[] = [
  { x: 220, y: 465 },
  { x: 555, y: 242 },
  { x: 915, y: 315 },
];

const ISLAND_COORDS_2: readonly IslandPoint[] = [
  { x: 315, y: 445 },
  { x: 765, y: 265 },
];

const ENCORE_COORD: IslandPoint = { x: 1215, y: 224 };

function StageLandmarkIcon({ order }: { order: number }) {
  if (order === 1 || order === 4) {
    return (
      <svg width="34" height="34" viewBox="0 0 36 36" fill="none" aria-hidden>
        <rect x="4" y="7" width="28" height="23" rx="4" fill="#FFFBF0" stroke="#121212" strokeWidth="2.3" />
        <rect x="7" y="10" width="22" height="5" rx="1.5" fill="#121212" />
        <circle cx="11" cy="12.5" r="1.3" fill="#D8FF2E" />
        <circle cx="15" cy="12.5" r="1.3" fill="#FFFBF0" />
        <circle cx="25" cy="12.5" r="1.5" fill="#FF3B7F" />
        <rect x="7" y="17.5" width="22" height="9.5" rx="2" fill="#F4ECDC" stroke="#121212" strokeWidth="1.7" />
        <circle cx="18" cy="22.2" r="3.4" stroke="#121212" strokeWidth="1.7" />
      </svg>
    );
  }
  if (order === 2 || order === 5) {
    return (
      <svg width="34" height="34" viewBox="0 0 36 36" fill="none" aria-hidden>
        <path
          d="M8 16C8 10.5 12.5 6 18 6C23.5 6 28 10.5 28 16V29H8V16Z"
          fill="#FFFBF0"
          stroke="#121212"
          strokeWidth="2.3"
          strokeLinejoin="round"
        />
        <path d="M12 16C12 12.7 14.7 10 18 10C21.3 10 24 12.7 24 16" stroke="#2B59FF" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="11" y="19" width="14" height="6" rx="1.5" fill="#FF8A00" stroke="#121212" strokeWidth="1.7" />
        <line x1="14" y1="22" x2="22" y2="22" stroke="#121212" strokeWidth="1.7" />
      </svg>
    );
  }
  if (order === 3 || order === 6) {
    return (
      <svg width="34" height="34" viewBox="0 0 36 36" fill="none" aria-hidden>
        <rect x="12" y="5" width="12" height="15" rx="6" fill="#FFFBF0" stroke="#121212" strokeWidth="2.3" />
        <line x1="13" y1="10" x2="23" y2="10" stroke="#121212" strokeWidth="1.7" />
        <line x1="13" y1="14" x2="23" y2="14" stroke="#121212" strokeWidth="1.7" />
        <path d="M9 15C9 20 13 23.5 18 23.5C23 23.5 27 20 27 15" stroke="#121212" strokeWidth="2.3" strokeLinecap="round" />
        <line x1="18" y1="23.5" x2="18" y2="30" stroke="#121212" strokeWidth="2.3" strokeLinecap="round" />
        <line x1="12" y1="30" x2="24" y2="30" stroke="#121212" strokeWidth="2.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="34" height="34" viewBox="0 0 36 36" fill="none" aria-hidden>
      <path
        d="M18 5C25 5 29 9.5 29 15.5C29 22.5 22.5 29.5 18 31C13.5 29.5 7 22.5 7 15.5C7 9.5 11 5 18 5Z"
        fill="#FFFBF0"
        stroke="#121212"
        strokeWidth="2.3"
      />
      <path d="M19.5 10L13.5 18.5H18L16.5 25.5L22.5 17H18L19.5 10Z" fill="#121212" />
    </svg>
  );
}

/**
 * 100% Stroke-Free Atmospheric Risograph Horizon Silhouettes (§2.5).
 * Strictly stroke="none" throughout — soft 2-tone paper washes (#F3EBD9 & #E9EEF8),
 * zero outlined clipart buildings, zero window grids, keeping the ACT II unlock zone completely open!
 */
function ActBackdropSvg({ chapterId }: { chapterId: CourseChapterTheme['id'] }) {
  if (chapterId === 'midnight-blues') {
    return (
      <g stroke="none" aria-hidden>
        {/* Soft Cobalt Halftone Sky Wash */}
        <rect x="0" y="0" width="1400" height="235" fill="url(#riso-dots-cobalt)" opacity="0.26" />

        {/* Distant Soft Blue-Grey Acoustic Horizon Silhouette (Left to Center — Right ACT II zone stays wide open!) */}
        <path
          d="M 0 390 L 0 210 L 95 210 L 95 168 L 165 168 L 165 245 L 250 245 L 250 148 L 395 148 L 395 228 L 515 228 L 515 176 L 615 176 L 615 268 L 765 268 L 765 215 L 870 215 L 870 330 Q 1030 355 1180 390 L 1400 390 L 1400 760 L 0 760 Z"
          fill="#E9EEF8"
          opacity="0.72"
        />

        {/* Mid-ground Warm Cream Risograph Acoustic Hills & Stage Floor Wash */}
        <path
          d="M 0 515 Q 240 435 510 475 T 1040 495 Q 1240 465 1400 505 L 1400 760 L 0 760 Z"
          fill="#F3EBD9"
          opacity="0.92"
        />

        {/* Soft Atmospheric Soundwave Concentric Halos (Zero Strokes!) */}
        <circle cx="220" cy="465" r="118" fill="#E9EEF8" opacity="0.45" />
        <circle cx="555" cy="242" r="110" fill="#F3EBD9" opacity="0.6" />
        <circle cx="915" cy="315" r="126" fill="#E9EEF8" opacity="0.52" />

        {/* Subtle Ambient Warm Spotlight Cone Behind Frontier Stage */}
        <polygon points="915,40 770,490 1060,490" fill="#F3EBD9" opacity="0.48" />

        {/* Soft Paper Foreground Band */}
        <rect x="0" y="618" width="1400" height="142" fill="#F3EBD9" opacity="0.7" />
      </g>
    );
  }

  if (chapterId === 'marshall-rock') {
    return (
      <g stroke="none" aria-hidden>
        <rect x="0" y="0" width="1400" height="220" fill="url(#riso-dots-amber)" opacity="0.28" />
        <polygon points="315,0 130,520 500,520" fill="#F3EBD9" opacity="0.65" />
        <polygon points="765,0 590,520 940,520" fill="#E9EEF8" opacity="0.6" />
        <path
          d="M 0 520 Q 380 445 760 495 T 1400 475 L 1400 760 L 0 760 Z"
          fill="#F3EBD9"
          opacity="0.9"
        />
      </g>
    );
  }

  return (
    <g stroke="none" aria-hidden>
      <rect x="0" y="0" width="1400" height="220" fill="url(#riso-dots-cobalt)" opacity="0.22" />
      <circle cx="700" cy="540" r="340" fill="#F3EBD9" opacity="0.72" />
      <circle cx="700" cy="540" r="215" fill="#E9EEF8" opacity="0.55" />
      <rect x="0" y="560" width="1400" height="200" fill="#F3EBD9" opacity="0.88" />
    </g>
  );
}

/** Chunky 1/4" TS Guitar Jack Plug SVG */
function TsJackPlug({ x, y, angleDeg, lit }: { x: number; y: number; angleDeg: number; lit: boolean }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${angleDeg})`}>
      <rect
        x="-14"
        y="-6"
        width="18"
        height="12"
        rx="2.5"
        fill={lit ? '#D8FF2E' : '#F4ECDC'}
        stroke="#121212"
        strokeWidth="2"
      />
      <rect x="4" y="-3" width="10" height="6" rx="1.5" fill="#FFFFFF" stroke="#121212" strokeWidth="1.8" />
      <line x1="10" y1="-3" x2="10" y2="3" stroke="#121212" strokeWidth="2.2" />
    </g>
  );
}

export function CourseRoadmapView({
  progress,
  onSelectCourse,
  onToggleUnlockAll,
  onOpenSetup,
  showSetupBanner,
  demoMode = false,
}: CourseRoadmapViewProps) {
  const frontier = useMemo(
    () => getFrontierCourse(progress, GUITAR_COURSES),
    [progress],
  );

  const [activeChapterId, setActiveChapterId] = useState<CourseChapterTheme['id']>(
    frontier.chapterId,
  );
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(frontier.id);
  const [previewingCourseId, setPreviewingCourseId] = useState<string | null>(null);
  const previewTransportRef = useRef<BackingTransport | null>(null);

  const stopHoverPreview = useCallback(() => {
    previewTransportRef.current?.stop();
    previewTransportRef.current = null;
    setPreviewingCourseId(null);
  }, []);

  const startHoverPreview = useCallback(
    (course: GuitarCourse) => {
      stopHoverPreview();
      if (demoMode) {
        setPreviewingCourseId(course.id);
        return;
      }
      const previewNotes = course.notes.filter((n) => n.bar <= 2);
      if (previewNotes.length === 0) return;
      try {
        const transport = new BackingTransport({
          bpm: course.tempoBpm,
          beatsPerBar: course.beatsPerBar,
          totalBeats: Math.min(2, course.totalBars) * course.beatsPerBar,
          countInBeats: 0,
          loop: false,
          grooveStyle: 'off',
          guideGuitar: 'full',
          notes: previewNotes,
          onComplete: () => {
            setPreviewingCourseId(null);
          },
        });
        previewTransportRef.current = transport;
        setPreviewingCourseId(course.id);
        transport.start();
      } catch {
        // AudioContext suspended before user gesture
      }
    },
    [demoMode, stopHoverPreview],
  );

  useEffect(() => {
    return () => {
      previewTransportRef.current?.stop();
    };
  }, []);

  const chapterCourses = useMemo(
    () =>
      GUITAR_COURSES.filter((c) => c.chapterId === activeChapterId).sort(
        (a, b) => a.order - b.order,
      ),
    [activeChapterId],
  );

  const actMeta = ACT_META[activeChapterId];
  const coords = chapterCourses.length === 2 ? ISLAND_COORDS_2 : ISLAND_COORDS_3;

  const selectedCourse = useMemo(
    () => chapterCourses.find((c) => c.id === selectedCourseId) ?? null,
    [chapterCourses, selectedCourseId],
  );

  const selectedIndex = selectedCourse
    ? chapterCourses.findIndex((c) => c.id === selectedCourse.id)
    : -1;

  const clearedInChapter = chapterCourses.filter(
    (c) => progress.courses[c.id]?.completed,
  ).length;

  const handleLaunch = (course: GuitarCourse, mode: CoursePracticeMode = 'play') => {
    stopHoverPreview();
    onSelectCourse(course, mode);
  };

  // Build smooth S-curve 1/4" patch cable segments connecting circular medallions + Encore badge
  const cableSegments = useMemo(() => {
    const segs: Array<{
      id: string;
      d: string;
      lit: boolean;
      from: IslandPoint;
      to: IslandPoint;
      angleFrom: number;
      angleTo: number;
    }> = [];

    for (let i = 0; i < chapterCourses.length; i += 1) {
      const from = coords[i];
      const isLast = i === chapterCourses.length - 1;
      const to = isLast ? ENCORE_COORD : coords[i + 1];
      const course = chapterCourses[i];
      const nextCourse = isLast ? null : chapterCourses[i + 1];
      const lit =
        Boolean(progress.courses[course.id]?.completed) &&
        (isLast
          ? clearedInChapter === chapterCourses.length
          : nextCourse != null && isCourseUnlocked(nextCourse, progress, GUITAR_COURSES));

      const midX = (from.x + to.x) * 0.5;
      const d = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
      const angleFrom = Math.atan2(to.y - from.y, to.x - from.x) * (180 / Math.PI) * 0.35;
      const angleTo = Math.atan2(from.y - to.y, from.x - to.x) * (180 / Math.PI) * 0.35;

      segs.push({
        id: `${course.id}-seg-${i}`,
        d,
        lit,
        from,
        to,
        angleFrom,
        angleTo,
      });
    }
    return segs;
  }, [chapterCourses, clearedInChapter, coords, progress]);

  const stemPills = [
    { label: 'Drums', unlocked: clearedInChapter >= 1, active: false },
    { label: 'Bass', unlocked: clearedInChapter >= 2, active: false },
    { label: 'Keys', unlocked: clearedInChapter >= 3, active: clearedInChapter === 2 },
    { label: 'Lead', unlocked: clearedInChapter >= chapterCourses.length, active: false },
  ];

  // Position Ticket Stub Popover cleanly anchored beside the selected island
  const ticketStyle = useMemo(() => {
    if (selectedIndex < 0) return null;
    const pt = coords[selectedIndex];
    const leftPct = (pt.x / 1400) * 100;
    const topPct = (pt.y / 760) * 100;
    if (pt.x > 760) {
      return {
        left: `${Math.min(62, Math.max(4, leftPct - 5))}%`,
        top: `${Math.min(62, topPct + 18)}%`,
      };
    }
    return {
      left: `${Math.min(60, leftPct + 7)}%`,
      top: `${Math.max(12, Math.min(54, topPct - 8))}%`,
    };
  }, [coords, selectedIndex]);

  return (
    <div className="h-full flex flex-col px-4 pt-3 pb-4 max-w-[1440px] mx-auto w-full gap-3">
      {/* Slim Act Chapter Strip (Zero Essay Hero Banner) */}
      <div className="flex items-center justify-between gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {COURSE_CHAPTERS.map((ch) => {
            const meta = ACT_META[ch.id];
            const chCourses = GUITAR_COURSES.filter((c) => c.chapterId === ch.id);
            const chCleared = chCourses.filter((c) => progress.courses[c.id]?.completed).length;
            const chUnlocked = chCourses.some((c) => isCourseUnlocked(c, progress, GUITAR_COURSES));
            const active = ch.id === activeChapterId;

            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => {
                  stopHoverPreview();
                  setActiveChapterId(ch.id);
                  const firstInAct = chCourses[0];
                  setSelectedCourseId(firstInAct?.id ?? null);
                }}
                className={`neo-pill-btn px-3.5 py-1.5 text-xs flex items-center gap-2 ${
                  active
                    ? 'text-white'
                    : chUnlocked
                      ? 'bg-[#FFFBF0] text-[#121212] hover:bg-[#F4ECDC]'
                      : 'bg-[#F4ECDC] text-[#57534A] hover:bg-[#FFFBF0]'
                }`}
                style={active ? { backgroundColor: meta.accent } : undefined}
              >
                <span className="font-mono font-bold tracking-wider">{meta.actCode}</span>
                <span className="opacity-65">·</span>
                <span className="font-syne font-extrabold tracking-tight">{meta.shortTitle}</span>
                <span
                  className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold border border-[#121212] ${
                    active ? 'bg-[#D8FF2E] text-[#121212]' : 'bg-[#FFFBF0] text-[#121212]'
                  }`}
                >
                  {chUnlocked ? `${chCleared}/${chCourses.length}` : '🔒'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {showSetupBanner && (
            <button
              type="button"
              onClick={onOpenSetup}
              className="neo-pill-btn px-3 py-1.5 bg-[#D8FF2E] text-[#121212] font-mono text-[11px] font-bold"
            >
              ⚡ RIG SETUP
            </button>
          )}
          <button
            type="button"
            onClick={onToggleUnlockAll}
            className={`neo-pill-btn px-3 py-1.5 font-mono text-[11px] font-bold ${
              progress.unlockAll
                ? 'bg-[#D8FF2E] text-[#121212]'
                : 'bg-[#FFFBF0] text-[#121212] hover:bg-[#F4ECDC]'
            }`}
          >
            {progress.unlockAll ? 'ALL UNLOCKED ✓' : 'UNLOCK ALL'}
          </button>
        </div>
      </div>

      {/* Full-Canvas Risograph Tour Circuit Poster (100% Stroke-Free Backdrop + Circular Medallions!) */}
      <div className="relative flex-1 min-h-0 w-full neo-card-lg bg-[#FFFBF0] riso-paper-grain overflow-hidden">
        <svg
          viewBox="0 0 1400 760"
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          aria-hidden
        >
          <defs>
            <pattern id="riso-dots-cobalt" width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="4" cy="4" r="1.7" fill="#2B59FF" />
            </pattern>
            <pattern id="riso-dots-amber" width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="4" cy="4" r="1.7" fill="#FF8A00" />
            </pattern>
          </defs>

          {/* 100% Stroke-Free Atmospheric Horizon Wash */}
          <ActBackdropSvg chapterId={activeChapterId} />

          {/* S-Curve 1/4" Braided Guitar Patch Cables Connecting Circular Islands */}
          {cableSegments.map((seg) => (
            <g key={seg.id}>
              {/* Outer #121212 Cable Jacket */}
              <path
                d={seg.d}
                fill="none"
                stroke="#121212"
                strokeWidth="15"
                strokeLinecap="round"
              />
              {/* Inner Cable Core */}
              <path
                d={seg.d}
                fill="none"
                stroke={seg.lit ? '#1CE088' : '#F4ECDC'}
                strokeWidth="8.5"
                strokeLinecap="round"
              />
              {/* Flowing Signal Pulse on Active/Lit Cables */}
              {seg.lit && (
                <path
                  d={seg.d}
                  fill="none"
                  stroke="#D8FF2E"
                  strokeWidth="4.2"
                  strokeLinecap="round"
                  className="riso-cable-flow"
                />
              )}
              {/* Metal 1/4" TS Jack Plugs cleanly anchored at circular rim (r = 52) */}
              <TsJackPlug
                x={seg.from.x + 52}
                y={seg.from.y + 4}
                angleDeg={seg.angleFrom}
                lit={seg.lit}
              />
              <TsJackPlug
                x={seg.to.x - 52}
                y={seg.to.y - 4}
                angleDeg={seg.angleTo}
                lit={seg.lit}
              />
            </g>
          ))}

          {/* Right-hand Encore / Next Act Unlock Medallion (Wide Open Stroke-Free Sky!) */}
          <g transform={`translate(${ENCORE_COORD.x}, ${ENCORE_COORD.y})`}>
            <circle
              r="42"
              fill={clearedInChapter === chapterCourses.length ? '#D8FF2E' : '#FFFBF0'}
              stroke="#121212"
              strokeWidth="2.5"
              strokeDasharray={clearedInChapter === chapterCourses.length ? undefined : '6 5'}
            />
            <text
              y="-5"
              textAnchor="middle"
              fontFamily="Space Mono, monospace"
              fontWeight="700"
              fontSize="16"
              fill="#121212"
            >
              ⚡
            </text>
            <text
              y="14"
              textAnchor="middle"
              fontFamily="Space Mono, monospace"
              fontWeight="700"
              fontSize="10.5"
              fill="#121212"
            >
              {actMeta.nextActLabel}
            </text>
            <text
              y="62"
              textAnchor="middle"
              fontFamily="Space Mono, monospace"
              fontWeight="700"
              fontSize="11"
              fill="#57534A"
            >
              UNLOCK {actMeta.nextActLabel}
            </text>
          </g>
        </svg>

        {/* Interactive Circular 3D Stage Medallions (84x84px Round Buttons + Frameless Label Underneath!) */}
        {chapterCourses.map((course, idx) => {
          const pt = coords[idx];
          const mastery = progress.courses[course.id];
          const unlocked = isCourseUnlocked(course, progress, GUITAR_COURSES);
          const completed = Boolean(mastery?.completed);
          const isFrontier = course.id === frontier.id;
          const isSelected = course.id === selectedCourseId;
          const isPreviewing = previewingCourseId === course.id;
          const shortTitle = SHORT_STAGE_TITLES[course.id] ?? course.title;

          const medallionBg = completed
            ? '#1CE088'
            : isFrontier
              ? '#D8FF2E'
              : unlocked
                ? '#FFFBF0'
                : '#F4ECDC';

          return (
            <div
              key={course.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-10"
              style={{
                left: `${(pt.x / 1400) * 100}%`,
                top: `${(pt.y / 760) * 100}%`,
              }}
            >
              {/* Single Clean Frontier Tag (Only on Current Frontier Island) */}
              {isFrontier && (
                <div className="mb-2 px-2.5 py-0.5 rounded-full bg-[#FF3B7F] text-white border-2 border-[#121212] font-mono text-[10px] font-bold tracking-wider shadow-brutal-xs whitespace-nowrap">
                  ★ NEXT GIG
                </div>
              )}

              {/* Circular 3D Tactile 84x84px Stage Medallion */}
              <button
                type="button"
                onClick={() => setSelectedCourseId(course.id)}
                onDoubleClick={() => {
                  if (unlocked) handleLaunch(course, 'play');
                }}
                onMouseEnter={() => {
                  if (unlocked) startHoverPreview(course);
                }}
                onMouseLeave={stopHoverPreview}
                className={`relative w-[84px] h-[84px] rounded-full border-[2.5px] border-[#121212] border-b-[6px] flex items-center justify-center transition-transform cursor-pointer ${
                  isSelected
                    ? 'scale-105 ring-4 ring-[#2B59FF]/35'
                    : 'hover:scale-105 active:translate-y-[2px]'
                }`}
                style={{ backgroundColor: medallionBg }}
                aria-label={`Stage ${course.order}: ${course.title}`}
              >
                {/* Stage Order Badge (Top-left rim) */}
                <span className="absolute -top-1.5 -left-1.5 w-6 h-6 rounded-full bg-[#121212] text-[#D8FF2E] font-mono text-[10px] font-bold flex items-center justify-center border-[1.5px] border-[#FFFBF0]">
                  {String(course.order).padStart(2, '0')}
                </span>

                {/* Completed Check or Lock Rim Badge (Top-right rim) */}
                {completed ? (
                  <span className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-[#121212] text-[#1CE088] font-mono text-[11px] font-bold flex items-center justify-center border-[1.5px] border-[#FFFBF0]">
                    ✓
                  </span>
                ) : !unlocked ? (
                  <span className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-[#121212] text-[#FFFBF0] text-[10px] flex items-center justify-center border-[1.5px] border-[#FFFBF0]">
                    🔒
                  </span>
                ) : null}

                <StageLandmarkIcon order={course.order} />

                {/* Hover Riff Preview Waveform Indicator */}
                {isPreviewing && !demoMode && (
                  <span className="absolute -bottom-2 px-1.5 py-0.5 rounded-full bg-[#2B59FF] text-white border border-[#121212] font-mono text-[9px] font-bold">
                    ♪ 2B
                  </span>
                )}
              </button>

              {/* Clean Frameless Stage Title & 3 Plectrum Stars Underneath (Zero Box Clutter!) */}
              <button
                type="button"
                onClick={() => setSelectedCourseId(course.id)}
                className="mt-2.5 flex flex-col items-center text-center group"
              >
                <span className="font-syne text-[13px] font-extrabold text-[#121212] leading-tight whitespace-nowrap drop-shadow-[0_1px_0_rgba(255,251,240,0.95)] group-hover:text-[#2B59FF] transition-colors">
                  {shortTitle}
                </span>
                <div className="mt-0.5 flex items-center justify-center gap-1.5 font-mono text-[11px] font-bold">
                  <span className="tracking-tight">
                    {[1, 2, 3].map((star) => (
                      <span
                        key={star}
                        className={
                          (mastery?.stars ?? 0) >= star
                            ? 'text-[#FF8A00]'
                            : 'text-[#121212]/20'
                        }
                      >
                        ★
                      </span>
                    ))}
                  </span>
                  {mastery && mastery.bestAccuracy > 0 && (
                    <span className="text-[#57534A]">{Math.round(mastery.bestAccuracy * 100)}%</span>
                  )}
                </div>
              </button>
            </div>
          );
        })}

        {/* Perforated Concert Ticket Stub Popover (Selected Island Only) */}
        {selectedCourse && ticketStyle && (
          <div
            className="absolute z-20 w-[372px] riso-ticket p-4 space-y-3"
            style={ticketStyle}
          >
            {/* Top Ticket Stub Metadata */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b-[2px] border-dashed border-[#121212]/35">
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#121212] text-[#D8FF2E] font-mono text-[10px] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FF3B7F]" />
                <span>
                  {actMeta.actCode} · STG {String(selectedCourse.order).padStart(2, '0')}
                </span>
              </div>
              <span className="font-mono text-[11px] font-bold text-[#57534A]">
                {selectedCourse.keySignature} · {selectedCourse.tempoBpm} BPM · {selectedCourse.totalBars}B
              </span>
            </div>

            {/* Stage Title */}
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-syne text-[15px] font-extrabold text-[#121212] leading-tight whitespace-nowrap">
                {selectedCourse.title}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedCourseId(null)}
                className="w-6 h-6 rounded-md border-[1.8px] border-[#121212] bg-[#F4ECDC] font-mono text-xs font-bold flex items-center justify-center hover:bg-[#121212] hover:text-white shrink-0"
                aria-label="Close ticket"
              >
                ×
              </button>
            </div>

            {/* 4 Mode Launch Stamps */}
            <div className="grid grid-cols-4 gap-1.5">
              {MODE_BUTTONS.map((mb) => {
                const unlocked = isCourseUnlocked(selectedCourse, progress, GUITAR_COURSES);
                return (
                  <button
                    key={mb.id}
                    type="button"
                    disabled={!unlocked}
                    onClick={() => handleLaunch(selectedCourse, mb.id)}
                    className={`py-1.5 rounded-lg border-[2px] border-[#121212] font-mono text-[10px] font-bold flex items-center justify-center gap-1 transition-all ${
                      unlocked
                        ? 'bg-[#FFFBF0] text-[#121212] hover:bg-[#D8FF2E] cursor-pointer'
                        : 'bg-[#F4ECDC] text-[#57534A]/50 cursor-not-allowed'
                    }`}
                  >
                    <span>{mb.icon}</span>
                    <span>{mb.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Primary Tactile Launch CTA */}
            {isCourseUnlocked(selectedCourse, progress, GUITAR_COURSES) ? (
              <button
                type="button"
                onClick={() => handleLaunch(selectedCourse, 'play')}
                className="w-full py-2.5 rounded-xl border-[2.5px] border-[#121212] border-b-[5px] bg-[#D8FF2E] text-[#121212] font-syne text-sm font-extrabold tracking-wide hover:bg-[#C7F21D] active:translate-y-[2px] active:border-b-[2.5px] transition-all"
              >
                ⚡ PLUG IN & PLAY →
              </button>
            ) : (
              <div className="w-full py-2 rounded-xl border-2 border-[#121212]/40 bg-[#F4ECDC] text-center font-mono text-[11px] font-bold text-[#57534A]">
                🔒 CLEAR PREVIOUS STAGE TO UNLOCK
              </div>
            )}
          </div>
        )}

        {/* Bottom-Left Visual Band Stem Unlock Progress Strip */}
        <div className="absolute left-4 bottom-4 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-[#FFFBF0]/95 border-[2.2px] border-[#121212] shadow-brutal-xs">
          <span className="font-mono text-[10px] font-bold text-[#57534A] mr-1">
            BAND TAPE
          </span>
          {stemPills.map((s) => (
            <span
              key={s.label}
              className={`px-2 py-0.5 rounded-lg border-[1.5px] border-[#121212] font-mono text-[10px] font-bold ${
                s.unlocked
                  ? 'bg-[#1CE088] text-[#121212]'
                  : s.active
                    ? 'bg-[#D8FF2E] text-[#121212]'
                    : 'bg-[#F4ECDC] text-[#57534A]'
              }`}
            >
              {s.label} {s.unlocked ? '✓' : s.active ? '⚡' : '🔒'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
