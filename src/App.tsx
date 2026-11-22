import { useCallback, useEffect, useState } from 'react';
import { BottomBar } from './components/BottomBar';
import { CourseRoadmapView } from './components/CourseRoadmapView';
import { CourseStageView, type AttemptOutcome } from './components/CourseStageView';
import { HistoryView } from './components/HistoryView';
import { Setup } from './components/Setup';
import { Sidebar, type NavViewKind } from './components/Sidebar';
import { TopBar } from './components/TopBar';
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

  if (viewParam === 'stage') {
    return {
      demoMode,
      initialView: {
        kind: 'stage',
        course: resolveCourse(0), // Course 1: Smokestack E Minor Blues (multi-string colorful highway)
        initialMode: 'play',
        initialDetailOpen: false,
      },
    };
  }

  if (viewParam === 'detail') {
    return {
      demoMode,
      initialView: {
        kind: 'stage',
        course: resolveCourse(2), // Course 3: Sunburst Soul Lead: Verse (frontier stage cleared -> unlocks Ch II!)
        initialMode: 'play',
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
      setView({ kind: 'stage', course, initialMode, initialDetailOpen: false });
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

  const stageTitle = isStageView
    ? `STAGE #${String(view.course.order).padStart(2, '0')} · ${view.course.title}`
    : null;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#FFFBF0] text-[#121212] font-display">
      <TopBar
        stageTitle={stageTitle}
        onBack={view.kind !== 'roadmap' ? handleOpenRoadmap : null}
        onOpenSetup={view.kind !== 'setup' ? () => handleNavigate('setup') : undefined}
        demoMode={isDemoMode}
      />

      <div className="flex-1 flex min-h-0">
        {!isStageView && (
          <Sidebar
            activeNav={activeNav}
            activeCourseId={null}
            progress={progress}
            onNavigate={handleNavigate}
            onSelectCourse={(course) => handleSelectCourse(course, 'play')}
          />
        )}

        <main className="flex-1 overflow-y-auto bg-[#FFFBF0]">
          {isStageView ? (
            <CourseStageView
              key={`${view.course.id}-${view.initialDetailOpen ? 'detail' : 'stage'}`}
              course={view.course}
              initialMode={view.initialMode}
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
            <Setup onReachedScrollEnd={() => setSetupCtaPulseActive(true)} />
          ) : view.kind === 'history' ? (
            <HistoryView />
          ) : (
            <CourseRoadmapView
              progress={progress}
              onSelectCourse={handleSelectCourse}
              onToggleUnlockAll={handleToggleUnlockAll}
              onOpenSetup={() => handleNavigate('setup')}
              showSetupBanner={!onboarded}
            />
          )}
        </main>
      </div>

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
