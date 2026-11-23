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
  { actCode: string; shortTitle: string; accent: string; secondary: string; nextActLabel: string }
> = {
  'midnight-blues': {
    actCode: 'ACT I',
    shortTitle: 'MIDNIGHT BLUES ALLEY',
    accent: '#2B59FF',
    secondary: '#FF8A00',
    nextActLabel: 'ACT II',
  },
  'marshall-rock': {
    actCode: 'ACT II',
    shortTitle: 'ARENA BACKSTAGE',
    accent: '#FF8A00',
    secondary: '#FF3B7F',
    nextActLabel: 'ACT III',
  },
  'sunburst-mastery': {
    actCode: 'ACT III',
    shortTitle: 'NASHVILLE TWANG HALL',
    accent: '#1CE088',
    secondary: '#2B59FF',
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
  { x: 225, y: 472 },
  { x: 560, y: 238 },
  { x: 925, y: 312 },
];

const ISLAND_COORDS_2: readonly IslandPoint[] = [
  { x: 310, y: 455 },
  { x: 760, y: 265 },
];

const ENCORE_COORD: IslandPoint = { x: 1215, y: 215 };

function StageLandmarkIcon({ order }: { order: number }) {
  // Bespoke clean ink vector emblems for each gig landmark
  if (order === 1 || order === 4) {
    // Combo Amp / Marshall Stack
    return (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden>
        <rect x="4" y="7" width="28" height="23" rx="4" fill="#FFFBF0" stroke="#121212" strokeWidth="2.4" />
        <rect x="7" y="10" width="22" height="5" rx="1.5" fill="#121212" />
        <circle cx="11" cy="12.5" r="1.3" fill="#D8FF2E" />
        <circle cx="15" cy="12.5" r="1.3" fill="#FFFBF0" />
        <circle cx="19" cy="12.5" r="1.3" fill="#FFFBF0" />
        <circle cx="25" cy="12.5" r="1.5" fill="#FF3B7F" />
        <rect x="7" y="17.5" width="22" height="9.5" rx="2" fill="#F4ECDC" stroke="#121212" strokeWidth="1.8" />
        <circle cx="18" cy="22.2" r="3.4" stroke="#121212" strokeWidth="1.8" />
      </svg>
    );
  }
  if (order === 2 || order === 5) {
    // Neon Jukebox / Vintage Radio
    return (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden>
        <path
          d="M8 16C8 10.5 12.5 6 18 6C23.5 6 28 10.5 28 16V29H8V16Z"
          fill="#FFFBF0"
          stroke="#121212"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <path d="M12 16C12 12.7 14.7 10 18 10C21.3 10 24 12.7 24 16" stroke="#2B59FF" strokeWidth="2.6" strokeLinecap="round" />
        <rect x="11" y="19" width="14" height="6" rx="1.5" fill="#FF8A00" stroke="#121212" strokeWidth="1.8" />
        <line x1="14" y1="22" x2="22" y2="22" stroke="#121212" strokeWidth="1.8" />
      </svg>
    );
  }
  if (order === 3 || order === 6) {
    // Classic Stage Mic / Soul Spotlight
    return (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden>
        <rect x="12" y="5" width="12" height="15" rx="6" fill="#FFFBF0" stroke="#121212" strokeWidth="2.4" />
        <line x1="13" y1="10" x2="23" y2="10" stroke="#121212" strokeWidth="1.8" />
        <line x1="13" y1="14" x2="23" y2="14" stroke="#121212" strokeWidth="1.8" />
        <path d="M9 15C9 20 13 23.5 18 23.5C23 23.5 27 20 27 15" stroke="#121212" strokeWidth="2.4" strokeLinecap="round" />
        <line x1="18" y1="23.5" x2="18" y2="30" stroke="#121212" strokeWidth="2.4" strokeLinecap="round" />
        <line x1="12" y1="30" x2="24" y2="30" stroke="#121212" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  // Guitar Pick Lightning Crest (#7, #8)
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden>
      <path
        d="M18 5C25 5 29 9.5 29 15.5C29 22.5 22.5 29.5 18 31C13.5 29.5 7 22.5 7 15.5C7 9.5 11 5 18 5Z"
        fill="#FFFBF0"
        stroke="#121212"
        strokeWidth="2.4"
      />
      <path d="M19.5 10L13.5 18.5H18L16.5 25.5L22.5 17H18L19.5 10Z" fill="#121212" />
    </svg>
  );
}

/** Minimalist 2-tone Risograph architectural skyline backdrop per Act (zero clutter) */
function ActBackdropSvg({ chapterId }: { chapterId: CourseChapterTheme['id'] }) {
  if (chapterId === 'midnight-blues') {
    return (
      <g opacity="0.95" aria-hidden>
        {/* Subtle halftone sky band */}
        <rect x="0" y="0" width="1400" height="250" fill="url(#riso-dots-cobalt)" opacity="0.32" />

        {/* Left Rooftop Water Tower Silhouette */}
        <g transform="translate(55, 68)" opacity="0.9">
          <path d="M24 52L58 26L92 52Z" fill="#F4ECDC" stroke="#121212" strokeWidth="2.2" strokeLinejoin="round" />
          <rect x="28" y="52" width="60" height="54" fill="#F4ECDC" stroke="#121212" strokeWidth="2.2" />
          <line x1="28" y1="70" x2="88" y2="70" stroke="#121212" strokeWidth="1.6" />
          <line x1="28" y1="88" x2="88" y2="88" stroke="#121212" strokeWidth="1.6" />
          <line x1="36" y1="106" x2="26" y2="165" stroke="#121212" strokeWidth="2.2" />
          <line x1="80" y1="106" x2="90" y2="165" stroke="#121212" strokeWidth="2.2" />
          <line x1="58" y1="106" x2="58" y2="165" stroke="#121212" strokeWidth="2" />
          <line x1="31" y1="138" x2="85" y2="138" stroke="#121212" strokeWidth="1.8" />
        </g>

        {/* Blues Club Marquee Facade (Background Mid-Left) */}
        <g transform="translate(275, 86)">
          <rect x="0" y="34" width="186" height="190" rx="4" fill="#F4ECDC" stroke="#121212" strokeWidth="2" opacity="0.88" />
          <rect x="18" y="56" width="38" height="44" rx="2" fill="#FFFBF0" stroke="#121212" strokeWidth="1.6" />
          <rect x="74" y="56" width="38" height="44" rx="2" fill="#FFFBF0" stroke="#121212" strokeWidth="1.6" />
          <rect x="130" y="56" width="38" height="44" rx="2" fill="#FFFBF0" stroke="#121212" strokeWidth="1.6" />
          {/* Vertical Vintage Club Sign */}
          <rect x="-24" y="10" width="36" height="128" rx="6" fill="#2B59FF" stroke="#121212" strokeWidth="2.2" />
          <text
            x="-6"
            y="38"
            textAnchor="middle"
            fill="#FFFBF0"
            fontFamily="Space Mono, monospace"
            fontWeight="700"
            fontSize="12"
          >
            <tspan x="-6" dy="0">B</tspan>
            <tspan x="-6" dy="18">L</tspan>
            <tspan x="-6" dy="18">U</tspan>
            <tspan x="-6" dy="18">E</tspan>
            <tspan x="-6" dy="18">S</tspan>
          </text>
        </g>

        {/* Warm Streetlamp Cone (Center) */}
        <g transform="translate(720, 74)">
          <polygon points="18,32 -52,275 88,275" fill="#FF8A00" opacity="0.08" />
          <line x1="18" y1="32" x2="18" y2="275" stroke="#121212" strokeWidth="2.4" opacity="0.45" />
          <path d="M18 32Q18 14 36 14" fill="none" stroke="#121212" strokeWidth="2.4" opacity="0.55" />
          <circle cx="36" cy="18" r="6" fill="#D8FF2E" stroke="#121212" strokeWidth="1.8" />
        </g>

        {/* Right Skyline & Vinyl Crate Silhouette */}
        <g transform="translate(1065, 92)" opacity="0.82">
          <rect x="0" y="45" width="120" height="230" fill="#F4ECDC" stroke="#121212" strokeWidth="2" />
          <rect x="136" y="18" width="142" height="257" fill="#F4ECDC" stroke="#121212" strokeWidth="2" />
          {[0, 1, 2].map((row) => (
            <g key={row}>
              <rect x="20" y={72 + row * 48} width="28" height="30" fill="#FFFBF0" stroke="#121212" strokeWidth="1.5" />
              <rect x="68" y={72 + row * 48} width="28" height="30" fill="#FFFBF0" stroke="#121212" strokeWidth="1.5" />
            </g>
          ))}
        </g>

        {/* Horizon Alley Pavement Rule */}
        <line x1="0" y1="590" x2="1400" y2="590" stroke="#121212" strokeWidth="2" strokeDasharray="8 8" opacity="0.22" />
        <rect x="0" y="590" width="1400" height="170" fill="#F4ECDC" opacity="0.48" />

        {/* Stylized Vinyl Crate in Lower-Left Corner */}
        <g transform="translate(64, 540)" opacity="0.85">
          <circle cx="48" cy="18" r="24" fill="#121212" />
          <circle cx="48" cy="18" r="8" fill="#FF8A00" />
          <rect x="10" y="20" width="76" height="44" rx="4" fill="#FFF4D8" stroke="#121212" strokeWidth="2.2" />
          <line x1="10" y1="35" x2="86" y2="35" stroke="#121212" strokeWidth="1.8" />
          <line x1="10" y1="50" x2="86" y2="50" stroke="#121212" strokeWidth="1.8" />
        </g>
      </g>
    );
  }

  if (chapterId === 'marshall-rock') {
    return (
      <g opacity="0.92" aria-hidden>
        <rect x="0" y="0" width="1400" height="220" fill="url(#riso-dots-amber)" opacity="0.34" />
        {/* Overhead Arena Truss Rig */}
        <g stroke="#121212" strokeWidth="2" opacity="0.4">
          <line x1="60" y1="52" x2="1340" y2="52" />
          <line x1="60" y1="78" x2="1340" y2="78" />
          {Array.from({ length: 16 }, (_, i) => (
            <path key={i} d={`M ${80 + i * 78} 52 L ${119 + i * 78} 78 L ${158 + i * 78} 52`} fill="none" />
          ))}
        </g>
        {/* Left & Right Amp Wall Silhouettes */}
        <rect x="64" y="260" width="140" height="310" rx="6" fill="#F4ECDC" stroke="#121212" strokeWidth="2.2" opacity="0.85" />
        <rect x="1190" y="250" width="146" height="320" rx="6" fill="#F4ECDC" stroke="#121212" strokeWidth="2.2" opacity="0.85" />
        <rect x="0" y="570" width="1400" height="190" fill="#F4ECDC" opacity="0.52" />
      </g>
    );
  }

  return (
    <g opacity="0.92" aria-hidden>
      <rect x="0" y="0" width="1400" height="220" fill="url(#riso-dots-cobalt)" opacity="0.25" />
      {/* Honky-Tonk Arch & Sunburst Rays */}
      <path d="M220 570 Q700 40 1180 570" fill="none" stroke="#121212" strokeWidth="2" strokeDasharray="7 7" opacity="0.28" />
      <rect x="0" y="570" width="1400" height="190" fill="#F4ECDC" opacity="0.5" />
    </g>
  );
}

/** Chunky 1/4" TS Guitar Jack Plug SVG */
function TsJackPlug({ x, y, angleDeg, lit }: { x: number; y: number; angleDeg: number; lit: boolean }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${angleDeg})`}>
      {/* Metal barrel sleeve */}
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
      {/* Tip shaft */}
      <rect x="4" y="-3" width="10" height="6" rx="1.5" fill="#FFFFFF" stroke="#121212" strokeWidth="1.8" />
      {/* Black insulator ring */}
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
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(
    demoMode ? frontier.id : frontier.id,
  );
  const [previewingCourseId, setPreviewingCourseId] = useState<string | null>(null);
  const previewTransportRef = useRef<BackingTransport | null>(null);

  const stopHoverPreview = useCallback(() => {
    previewTransportRef.current?.stop();
    previewTransportRef.current = null;
    setPreviewingCourseId(null);
  }, []);

  // Audio-first 2-bar riff preview on hover/focus (stops cleanly on leave or stage launch!)
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
        // Browser AudioContext may remain suspended prior to user gesture
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

  // Build smooth S-curve 1/4" patch cable segments connecting islands + final Encore node
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
      const lit = Boolean(progress.courses[course.id]?.completed) &&
        (isLast ? clearedInChapter === chapterCourses.length : nextCourse != null && isCourseUnlocked(nextCourse, progress, GUITAR_COURSES));

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

  // Chapter Band Stem-Story Pills (visual band unlock status)
  const stemPills = [
    { label: 'Drums', unlocked: clearedInChapter >= 1, active: false },
    { label: 'Bass', unlocked: clearedInChapter >= 2, active: false },
    { label: 'Keys', unlocked: clearedInChapter >= 3, active: clearedInChapter === 2 },
    { label: 'Lead', unlocked: clearedInChapter >= chapterCourses.length && chapterCourses.length > 0, active: false },
  ];

  // Ticket stub position anchored cleanly beneath/beside selected island without covering nodes
  const ticketStyle = useMemo(() => {
    if (selectedIndex < 0) return null;
    const pt = coords[selectedIndex];
    const leftPct = Math.min(68, Math.max(18, (pt.x / 1400) * 100 - 4));
    const topPct = pt.y > 380 ? Math.max(16, (pt.y / 760) * 100 - 38) : Math.min(59, (pt.y / 760) * 100 + 18);
    return { left: `${leftPct}%`, top: `${topPct}%` };
  }, [coords, selectedIndex]);

  return (
    <div className="h-[calc(100vh-56px)] w-full bg-[#FFFBF0] flex flex-col overflow-hidden p-3 md:p-4 gap-3">
      {/* Row 1: Bold Riso Act Poster Tabs + Unlock All Toggle (Zero Hero Banner!) */}
      <div className="flex items-center justify-between gap-2.5 flex-wrap shrink-0">
        <div className="flex items-center gap-2 flex-wrap" role="tablist" aria-label="Tour Chapters">
          {COURSE_CHAPTERS.map((ch) => {
            const meta = ACT_META[ch.id];
            const chCourses = GUITAR_COURSES.filter((c) => c.chapterId === ch.id);
            const chCleared = chCourses.filter((c) => progress.courses[c.id]?.completed).length;
            const chUnlocked = chCourses.some((c) => isCourseUnlocked(c, progress, GUITAR_COURSES));
            const isSelected = ch.id === activeChapterId;

            return (
              <button
                key={ch.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => {
                  stopHoverPreview();
                  setActiveChapterId(ch.id);
                  const first = chCourses.find((c) => c.id === frontier.id) ?? chCourses[0];
                  setSelectedCourseId(first?.id ?? null);
                }}
                className={`neo-btn-3d px-3.5 py-1.5 text-xs font-mono uppercase tracking-wide ${
                  isSelected
                    ? 'text-white'
                    : chUnlocked
                      ? 'bg-white text-[#121212]'
                      : 'bg-[#F4ECDC] text-[#57534A]'
                }`}
                style={
                  isSelected
                    ? {
                        backgroundColor: meta.accent,
                        color: ch.id === 'sunburst-mastery' ? '#121212' : '#FFFFFF',
                      }
                    : undefined
                }
              >
                <span>{meta.actCode}</span>
                <span className="opacity-55">&middot;</span>
                <span className="font-syne font-extrabold">{meta.shortTitle}</span>
                <span
                  className={`ml-1 px-1.5 py-0.5 rounded-md border border-[#121212] text-[10px] ${
                    isSelected ? 'bg-[#D8FF2E] text-[#121212]' : 'bg-[#FFFBF0] text-[#121212]'
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
              className="neo-btn-amber px-3 py-1.5 text-[11px] font-mono uppercase"
            >
              Tuner Check
            </button>
          )}
          <button
            type="button"
            onClick={onToggleUnlockAll}
            className={`neo-btn-3d px-3 py-1.5 text-[11px] font-mono uppercase ${
              progress.unlockAll ? 'bg-[#D8FF2E] text-[#121212]' : 'bg-white text-[#121212]'
            }`}
          >
            {progress.unlockAll ? '★ All Open' : 'Unlock All'}
          </button>
        </div>
      </div>

      {/* Row 2: 100% Full-Canvas Risograph Illustrated Gig-Circuit Tour Poster */}
      <div className="relative flex-1 min-h-0 rounded-3xl border-[2.5px] border-[#121212] shadow-brutal bg-[#FFFBF0] overflow-hidden">
        {/* SVG Illustrated Scene + 1/4" Guitar Patch Cable */}
        <svg
          viewBox="0 0 1400 760"
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
        >
          <defs>
            <pattern id="riso-dots-cobalt" width="12" height="12" patternUnits="userSpaceOnUse">
              <circle cx="3" cy="3" r="1.4" fill="#2B59FF" />
            </pattern>
            <pattern id="riso-dots-amber" width="12" height="12" patternUnits="userSpaceOnUse">
              <circle cx="3" cy="3" r="1.4" fill="#FF8A00" />
            </pattern>
          </defs>

          <ActBackdropSvg chapterId={activeChapterId} />

          {/* 1/4" Braided Guitar Patch Cables connecting Stage Islands */}
          {cableSegments.map((seg) => (
            <g key={seg.id}>
              {/* Cable drop shadow */}
              <path
                d={seg.d}
                fill="none"
                stroke="#121212"
                strokeWidth="16"
                strokeLinecap="round"
                opacity="0.14"
                transform="translate(4, 6)"
              />
              {/* Outer thick ink jacket */}
              <path
                d={seg.d}
                fill="none"
                stroke="#121212"
                strokeWidth="15"
                strokeLinecap="round"
              />
              {/* Inner cable core */}
              <path
                d={seg.d}
                fill="none"
                stroke={seg.lit ? '#1CE088' : '#F4ECDC'}
                strokeWidth="8.5"
                strokeLinecap="round"
              />
              {/* Flowing electric signal dashes on cleared segments */}
              {seg.lit && (
                <path
                  d={seg.d}
                  fill="none"
                  stroke="#D8FF2E"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  strokeDasharray="12 24"
                  className="riso-cable-signal"
                />
              )}

              {/* Illustrated 1/4" TS Plugs seated beside islands */}
              <TsJackPlug
                x={seg.from.x + 56}
                y={seg.from.y + (seg.to.y - seg.from.y) * 0.08}
                angleDeg={seg.angleFrom}
                lit={seg.lit}
              />
              <TsJackPlug
                x={seg.to.x - 56}
                y={seg.to.y - (seg.to.y - seg.from.y) * 0.08}
                angleDeg={seg.angleTo + 180}
                lit={seg.lit}
              />
            </g>
          ))}
        </svg>

        {/* Interactive Stage Islands Positioned on 2D S-Curve */}
        {chapterCourses.map((course, idx) => {
          const pt = coords[idx];
          const unlocked = isCourseUnlocked(course, progress, GUITAR_COURSES);
          const record = progress.courses[course.id];
          const completed = Boolean(record?.completed);
          const isFrontier = course.id === frontier.id && !completed;
          const isSelected = course.id === selectedCourseId;
          const isPreviewing = previewingCourseId === course.id;
          const stars = record?.stars ?? 0;
          const shortTitle = SHORT_STAGE_TITLES[course.id] ?? course.title;

          return (
            <div
              key={course.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2 z-10"
              style={{
                left: `${(pt.x / 1400) * 100}%`,
                top: `${(pt.y / 760) * 100}%`,
              }}
            >
              {/* Frontier / Hover Audio Signal Badge */}
              {isFrontier && (
                <span className="neo-stamp bg-[#FF3B7F] text-white -rotate-2">
                  ★ FRONTIER {isPreviewing ? '· 🔊' : ''}
                </span>
              )}
              {!isFrontier && isPreviewing && unlocked && (
                <span className="neo-stamp bg-[#2B59FF] text-white">🔊 PREVIEW</span>
              )}

              {/* 88x88 Tactile 3D Riso Stage Landmark Medallion */}
              <button
                type="button"
                onMouseEnter={() => unlocked && startHoverPreview(course)}
                onMouseLeave={stopHoverPreview}
                onFocus={() => unlocked && startHoverPreview(course)}
                onBlur={stopHoverPreview}
                onClick={() => {
                  setSelectedCourseId(course.id);
                }}
                onDoubleClick={() => unlocked && handleLaunch(course, 'play')}
                className={`neo-medallion-3d relative w-[92px] h-[92px] ${
                  !unlocked
                    ? 'bg-[#F4ECDC] text-[#57534A] cursor-not-allowed'
                    : isFrontier
                      ? 'bg-[#D8FF2E] text-[#121212] riso-frontier-glow'
                      : completed
                        ? 'bg-[#1CE088] text-[#121212]'
                        : 'bg-white text-[#121212]'
                } ${isSelected ? 'ring-4 ring-[#2B59FF] ring-offset-2 ring-offset-[#FFFBF0]' : ''}`}
                aria-label={`Stage ${course.order}: ${shortTitle}`}
              >
                {/* Stage Number Pin */}
                <span className="absolute -top-2.5 -left-2.5 px-1.5 py-0.5 rounded-lg bg-[#121212] text-[#D8FF2E] font-mono text-[10px] font-bold">
                  {String(course.order).padStart(2, '0')}
                </span>

                {/* Cleared Checkmark Pip */}
                {completed && (
                  <span className="absolute -top-2.5 -right-2.5 w-6 h-6 rounded-full bg-[#121212] text-[#1CE088] border-2 border-[#FFFBF0] font-mono text-xs font-bold flex items-center justify-center">
                    ✓
                  </span>
                )}

                {unlocked ? (
                  <StageLandmarkIcon order={course.order} />
                ) : (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <rect x="5" y="11" width="14" height="10" rx="2.5" stroke="#121212" strokeWidth="2.4" fill="#FFFBF0" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="#121212" strokeWidth="2.4" />
                  </svg>
                )}
              </button>

              {/* Compact Label Pill + 3 Guitar Plectrum Stars (Zero Essay!) */}
              <div className="px-3 py-1 rounded-xl bg-white border-2 border-[#121212] shadow-brutal-xs flex flex-col items-center">
                <span className="font-syne text-xs font-extrabold text-[#121212] whitespace-nowrap leading-tight">
                  {shortTitle}
                </span>
                <div className="flex items-center gap-1 mt-0.5">
                  {[1, 2, 3].map((s) => (
                    <span
                      key={s}
                      className={`text-xs leading-none ${
                        s <= stars ? 'text-[#FF8A00]' : 'text-[#D6CEBC]'
                      }`}
                    >
                      ★
                    </span>
                  ))}
                  {record?.bestAccuracy != null && (
                    <span className="font-mono text-[10px] font-bold text-[#121212] ml-1">
                      {Math.round(record.bestAccuracy * 100)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Final Chapter Encore Crest Node */}
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 z-10"
          style={{
            left: `${(ENCORE_COORD.x / 1400) * 100}%`,
            top: `${(ENCORE_COORD.y / 760) * 100}%`,
          }}
        >
          <div className="w-[74px] h-[74px] rounded-full bg-[#F4ECDC] border-[2.5px] border-dashed border-[#121212] flex flex-col items-center justify-center shadow-brutal-xs">
            <span className="font-syne text-xl font-extrabold text-[#121212]">⚡</span>
            <span className="font-mono text-[9px] font-bold text-[#121212]">
              {actMeta.nextActLabel}
            </span>
          </div>
          <span className="neo-stamp bg-[#FFF4D8] text-[#121212]">
            UNLOCK {actMeta.nextActLabel}
          </span>
        </div>

        {/* Perforated Concert Ticket Stub Popover (Selected Island Only) */}
        {selectedCourse && ticketStyle && (
          <div
            className="absolute z-20 w-[372px] riso-ticket p-4 space-y-3"
            style={ticketStyle}
          >
            {/* Perforated Side Notches */}
            <span
              aria-hidden
              className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#FFFBF0] border-r-[2.5px] border-[#121212]"
            />
            <span
              aria-hidden
              className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#FFFBF0] border-l-[2.5px] border-[#121212]"
            />

            {/* Ticket Meta Header */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b-2 border-dashed border-[#121212]/30">
              <span className="neo-stamp bg-[#121212] text-[#D8FF2E]">
                🎟️ {actMeta.actCode} &middot; STG {String(selectedCourse.order).padStart(2, '0')}
              </span>
              <span className="font-mono text-[10px] font-bold text-[#121212]">
                {selectedCourse.keySignature} &middot; {selectedCourse.tempoBpm} BPM &middot; {selectedCourse.totalBars}B
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
                className="w-6 h-6 rounded-lg border-2 border-[#121212] bg-[#F4ECDC] font-mono text-xs font-bold hover:bg-[#D8FF2E] shrink-0"
                aria-label="Close ticket"
              >
                ×
              </button>
            </div>

            {/* 4 Mode Launch Stamps */}
            <div className="grid grid-cols-4 gap-1.5">
              {MODE_BUTTONS.map((m) => {
                const unlocked = isCourseUnlocked(selectedCourse, progress, GUITAR_COURSES);
                const done = progress.courses[selectedCourse.id]?.completedModes.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!unlocked}
                    onClick={() => handleLaunch(selectedCourse, m.id)}
                    className={`px-1.5 py-1.5 rounded-xl border-2 border-[#121212] font-mono text-[10px] font-bold flex items-center justify-center gap-1 transition-all ${
                      !unlocked
                        ? 'bg-[#F4ECDC] text-[#6E695F] cursor-not-allowed'
                        : done
                          ? 'bg-[#1CE088] text-[#121212] shadow-brutal-xs hover:-translate-y-0.5'
                          : 'bg-[#FFFBF0] text-[#121212] hover:bg-[#D8FF2E]'
                    }`}
                  >
                    <span>{m.icon}</span>
                    <span>{m.label}</span>
                    {done && <span>✓</span>}
                  </button>
                );
              })}
            </div>

            {/* Primary CTA */}
            {isCourseUnlocked(selectedCourse, progress, GUITAR_COURSES) ? (
              <button
                type="button"
                onClick={() => handleLaunch(selectedCourse, 'play')}
                className="w-full neo-btn-lime py-2.5 text-sm font-syne tracking-wide"
              >
                ⚡ PLUG IN &amp; PLAY &rarr;
              </button>
            ) : (
              <div className="w-full py-2 rounded-xl bg-[#F4ECDC] border-2 border-[#121212] font-mono text-[11px] font-bold text-center text-[#57534A]">
                🔒 CLEAR STAGE {String(selectedCourse.order - 1).padStart(2, '0')}
              </div>
            )}
          </div>
        )}

        {/* Bottom-Left Compact Chapter Stem-Story Pill (Visual Band Unlock Meter) */}
        <div className="absolute left-4 bottom-4 z-20 inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-white border-[2.5px] border-[#121212] shadow-brutal-xs flex-wrap">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#121212] pr-1 border-r-2 border-[#121212]/20">
            BAND TAPE
          </span>
          {stemPills.map((stem) => (
            <span
              key={stem.label}
              className={`px-2 py-0.5 rounded-lg border-[1.8px] border-[#121212] font-mono text-[10px] font-bold ${
                stem.unlocked
                  ? 'bg-[#1CE088] text-[#121212]'
                  : stem.active
                    ? 'bg-[#D8FF2E] text-[#121212]'
                    : 'bg-[#F4ECDC] text-[#6E695F]'
              }`}
            >
              {stem.label} {stem.unlocked ? '✓' : stem.active ? '⚡' : '🔒'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
