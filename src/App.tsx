import { useCallback, useEffect, useState } from 'react';
import { BottomBar } from './components/BottomBar';
import { CourseRoadmapView } from './components/CourseRoadmapView';
import {
  CourseStageView,
  type AttemptOutcome,
  type StageLensId,
} from './components/CourseStageView';
import { HistoryView } from './components/HistoryView';
import { Setup } from './components/Setup';
import { TopBar, type NavViewKind } from './components/TopBar';
import { AudioEngineProvider } from './context/AudioEngineContext';
import {
  GUITAR_COURSES,
  type CoursePracticeMode,
  type GuitarCourse,
} from './data/guitarCourses';
import {
  getNextCourse,
  isCourseUnlocked,
  readCourseProgress,
  recordCourseAttempt,
  writeCourseProgress,
  type CourseProgressStore,
} from './utils/courseProgress';

type AppView =
  | { kind: 'roadmap' }
  | {
      kind: 'stage';
      course: GuitarCourse;
      initialMode: CoursePracticeMode;
      initialLens: StageLensId;
      initialDetailOpen?: boolean;
    }
  | { kind: 'setup' }
  | { kind: 'history' };

const ONBOARDED_KEY = 'sonicmambo:onboarded';

interface UrlDemoConfig {
  demoMode: boolean;
  initialView: AppView;
}

function buildDemoProgress(): CourseProgressStore {
  const nowIso = new Date().toISOString();
  const c1 = GUITAR_COURSES[0];
  const c2 = GUITAR_COURSES[1];
  return {
    unlockAll: false,
    courses: {
      [c1.id]: {
        courseId: c1.id,
        completed: true,
        bestAccuracy: 0.96,
        stars: 3,
        completedModes: ['play', 'loop', 'shadow'],
        attempts: 4,
        lastPlayedIso: nowIso,
      },
      [c2.id]: {
        courseId: c2.id,
        completed: true,
        bestAccuracy: 0.93,
        stars: 3,
        completedModes: ['play', 'loop', 'shadow'],
        attempts: 3,
        lastPlayedIso: nowIso,
      },
    },
  };
}

function parseInitialUrlConfig(): UrlDemoConfig {
  if (typeof window === 'undefined') {
    return { demoMode: false, initialView: { kind: 'roadmap' } };
  }
  const params = new URLSearchParams(window.location.search);
  const demoMode = params.get('demo') === '1';
  const viewParam = params.get('view');
  const courseParam = params.get('course');

  const resolveCourse = (fallbackIndex: number): GuitarCourse => {
    if (courseParam) {
      const byOrder = GUITAR_COURSES.find((c) => String(c.order) === courseParam);
      if (byOrder) return byOrder;
      const byId = GUITAR_COURSES.find((c) => c.id === courseParam);
      if (byId) return byId;
    }
    return GUITAR_COURSES[fallbackIndex] ?? GUITAR_COURSES[0];
  };

  // ?demo=1&view=stage -> 02-stage-play.png (Default ARCADE 6-String Riff Highway on multi-string Course #01!)
  if (viewParam === 'stage') {
    return {
      demoMode,
      initialView: {
        kind: 'stage',
        course: resolveCourse(0), // Course #01: Smokestack E Minor Blues (rich 4-string highway!)
        initialMode: 'play',
        initialLens: 'arcade',
        initialDetailOpen: false,
      },
    };
  }

  // ?demo=1&view=staff -> 04-stage-staff.png (Single-Focus Coupled 5-Line Staff + 6-Line TAB)
  if (viewParam === 'staff') {
    return {
      demoMode,
      initialView: {
        kind: 'stage',
        course: resolveCourse(2), // Course #03: Sunburst Soul Lead: Verse
        initialMode: 'play',
        initialLens: 'staff',
        initialDetailOpen: false,
      },
    };
  }

  // ?demo=1&view=neck -> 05-stage-neck.png (Single-Focus De-cluttered 3D Perspective Neck)
  if (viewParam === 'neck') {
    return {
      demoMode,
      initialView: {
        kind: 'stage',
        course: resolveCourse(2), // Course #03: Sunburst Soul Lead: Verse
        initialMode: 'play',
        initialLens: 'neck',
        initialDetailOpen: false,
      },
    };
  }

  // ?demo=1&view=detail -> 03-interaction-detail.png (Coupled Staff+TAB Pitch Ribbon + <=215px 3-Pedal Stompbox Rack)
  if (viewParam === 'detail') {
    return {
      demoMode,
      initialView: {
        kind: 'stage',
        course: resolveCourse(2), // Course #03: Sunburst Soul Lead: Verse
        initialMode: 'play',
        initialLens: 'staff',
        initialDetailOpen: true,
      },
    };
  }

  if (viewParam === 'setup') {
    return { demoMode, initialView: { kind: 'setup' } };
  }

  if (viewParam === 'history') {
    return { demoMode, initialView: { kind: 'history' } };
  }

  return { demoMode, initialView: { kind: 'roadmap' } };
}

function readOnboarded(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOnboarded(): void {
  try {
    window.localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    // ignore
  }
}

export default function App() {
  return (
    <AudioEngineProvider>
      <AppShell />
    </AudioEngineProvider>
  );
}

function AppShell() {
  const [urlConfig] = useState<UrlDemoConfig>(() => parseInitialUrlConfig());
  const isDemoMode = urlConfig.demoMode;

  const [onboarded, setOnboarded] = useState<boolean>(() =>
    isDemoMode ? true : readOnboarded(),
  );
  const [view, setView] = useState<AppView>(() => urlConfig.initialView);
  const [progress, setProgress] = useState<CourseProgressStore>(() =>
    isDemoMode ? buildDemoProgress() : readCourseProgress(),
  );
  const [setupCtaPulseActive, setSetupCtaPulseActive] = useState(false);

  const handleOpenRoadmap = useCallback(() => {
    setView({ kind: 'roadmap' });
  }, []);

  const handleNavigate = useCallback((nav: NavViewKind) => {
    setView({ kind: nav });
  }, []);

  const handleSelectCourse = useCallback(
    (course: GuitarCourse, initialMode: CoursePracticeMode = 'play') => {
      setView({
        kind: 'stage',
        course,
        initialMode,
        initialLens: 'arcade',
        initialDetailOpen: false,
      });
    },
    [],
  );

  const handleRecordAttempt = useCallback(
    (params: {
      courseId: string;
      mode: CoursePracticeMode;
      accuracy: number;
    }): AttemptOutcome => {
      const res = recordCourseAttempt(progress, params, GUITAR_COURSES);
      setProgress(res.nextStore);
      return {
        passed: res.passed,
        starsEarned: res.starsEarned,
        newlyUnlockedCourse: res.newlyUnlockedCourse,
      };
    },
    [progress],
  );

  const handleToggleUnlockAll = useCallback(() => {
    setProgress((prev) => {
      const next: CourseProgressStore = {
        ...prev,
        unlockAll: !prev.unlockAll,
      };
      if (!isDemoMode) {
        writeCourseProgress(next);
      }
      return next;
    });
  }, [isDemoMode]);

  const handleSetupFinish = useCallback(() => {
    writeOnboarded();
    setOnboarded(true);
    setView({ kind: 'roadmap' });
  }, []);

  useEffect(() => {
    if (view.kind !== 'setup') {
      setSetupCtaPulseActive(false);
    }
  }, [view.kind]);

  const isStageView = view.kind === 'stage';
  const activeNav: NavViewKind | null = isStageView ? null : view.kind;

  const nextCourseForStage = isStageView
    ? getNextCourse(view.course.id, GUITAR_COURSES)
    : null;

  const isNextUnlockedForStage =
    nextCourseForStage != null
      ? isCourseUnlocked(nextCourseForStage, progress, GUITAR_COURSES)
      : false;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#FFFBF0] text-[#121212] font-display">
      {/* On Stage Views, CourseStageView owns the ONE unified 56px Stage Header (§2.1: Zero Duplicate Headers!) */}
      {!isStageView && (
        <TopBar
          activeNav={activeNav}
          stageTitle={null}
          onNavigate={handleNavigate}
          onBack={view.kind !== 'roadmap' ? handleOpenRoadmap : null}
          demoMode={isDemoMode}
        />
      )}

      <main className="flex-1 min-h-0 overflow-hidden bg-[#FFFBF0]">
        {isStageView ? (
          <CourseStageView
            key={`${view.course.id}-${view.initialLens}-${view.initialDetailOpen ? 'detail' : 'stage'}`}
            course={view.course}
            initialMode={view.initialMode}
            initialLens={view.initialLens}
            initialDetailOpen={Boolean(view.initialDetailOpen)}
            demoMode={isDemoMode}
            mastery={progress.courses[view.course.id]}
            nextCourse={nextCourseForStage}
            isNextUnlocked={isNextUnlockedForStage}
            onRecordAttempt={handleRecordAttempt}
            onSelectCourse={handleSelectCourse}
            onBackToRoadmap={handleOpenRoadmap}
          />
        ) : view.kind === 'setup' ? (
          <div className="h-full overflow-y-auto">
            <Setup onReachedScrollEnd={() => setSetupCtaPulseActive(true)} />
          </div>
        ) : view.kind === 'history' ? (
          <div className="h-full overflow-y-auto">
            <HistoryView />
          </div>
        ) : (
          <CourseRoadmapView
            progress={progress}
            onSelectCourse={handleSelectCourse}
            onToggleUnlockAll={handleToggleUnlockAll}
            onOpenSetup={() => handleNavigate('setup')}
            showSetupBanner={!onboarded}
            demoMode={isDemoMode}
          />
        )}
      </main>

      {view.kind === 'setup' && (
        <BottomBar
          audio={null}
          onSetupReady={handleSetupFinish}
          setupCtaPulseActive={setupCtaPulseActive}
        />
      )}
    </div>
  );
}
