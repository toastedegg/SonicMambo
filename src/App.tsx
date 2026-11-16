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
  | { kind: 'stage'; course: GuitarCourse; initialMode: CoursePracticeMode }
  | { kind: 'setup' }
  | { kind: 'history' };

const ONBOARDED_KEY = 'sonicmambo:onboarded';

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
  const [onboarded, setOnboarded] = useState<boolean>(() => readOnboarded());
  const [view, setView] = useState<AppView>({ kind: 'roadmap' });
  const [progress, setProgress] = useState<CourseProgressStore>(() =>
    readCourseProgress(),
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
      setView({ kind: 'stage', course, initialMode });
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
      writeCourseProgress(next);
      return next;
    });
  }, []);

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
    <div className="h-screen flex flex-col overflow-hidden bg-[#080a0e] font-display">
      <TopBar
        stageTitle={null}
        onBack={view.kind !== 'roadmap' ? handleOpenRoadmap : null}
        onOpenSetup={view.kind !== 'setup' ? () => handleNavigate('setup') : undefined}
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

        <main className="flex-1 overflow-y-auto bg-[#080a0e]">
          {isStageView ? (
            <CourseStageView
              key={view.course.id}
              course={view.course}
              initialMode={view.initialMode}
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
