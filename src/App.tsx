import { useCallback, useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { BottomBar } from './components/BottomBar';
import type { AudioFeedback } from './components/BottomBar';
import { Lesson } from './components/Lesson';
import { Setup } from './components/Setup';
import { LESSONS } from './data/lessons';
import type { Lesson as LessonType } from './types/lesson';

type View =
  | { kind: 'home' }
  | { kind: 'setup' }
  | { kind: 'lesson'; lesson: LessonType };

const ONBOARDED_KEY = 'sonicmambo:onboarded';

/** True only after the user completes setup (localStorage flag). No cookie — missing key = first visit. */
function readOnboarded(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

function getInitialAppState(): { onboarded: boolean; view: View } {
  const onboarded = readOnboarded();
  return {
    onboarded,
    view: onboarded ? { kind: 'home' } : { kind: 'setup' },
  };
}

function writeOnboarded() {
  try {
    window.localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    // Storage might be disabled; onboarding still works, just re-opens next visit.
  }
}

function App() {
  const init = getInitialAppState();
  const [onboarded, setOnboarded] = useState<boolean>(init.onboarded);
  const [view, setView] = useState<View>(init.view);
  const [audioFeedback, setAudioFeedback] = useState<AudioFeedback | null>(null);
  const [setupCtaPulseActive, setSetupCtaPulseActive] = useState(false);
  const [setupMicListening, setSetupMicListening] = useState(false);

  /** Always opens Home (e.g. back from lesson, or setup exit when already onboarded). */
  const handleGoHome = useCallback(() => {
    setView({ kind: 'home' });
    setAudioFeedback(null);
  }, []);

  /** Sidebar Home: first-time users stay on Setup until they finish onboarding. */
  const handleSidebarHome = useCallback(() => {
    setAudioFeedback(null);
    if (!onboarded) {
      setView({ kind: 'setup' });
      return;
    }
    setView({ kind: 'home' });
  }, [onboarded]);

  const handleTopBarBack = useCallback(() => {
    setAudioFeedback(null);
    if (view.kind === 'lesson') {
      setView({ kind: 'home' });
    } else {
      handleGoHome();
    }
  }, [view.kind, handleGoHome]);

  const handleGoSetup = useCallback(() => {
    setView({ kind: 'setup' });
    setAudioFeedback(null);
  }, []);

  const handleSelectLesson = useCallback((lesson: LessonType) => {
    setView({ kind: 'lesson', lesson });
    setAudioFeedback(null);
  }, []);

  const handleSetupFinish = useCallback(() => {
    writeOnboarded();
    setOnboarded(true);
    setView({ kind: 'home' });
  }, []);

  const handleSetupReachedBottom = useCallback(() => {
    setSetupCtaPulseActive(true);
  }, []);

  // Stop surfacing stale lesson feedback when the user leaves a lesson view.
  useEffect(() => {
    if (view.kind !== 'lesson') setAudioFeedback(null);
  }, [view.kind]);

  useEffect(() => {
    if (view.kind !== 'setup') {
      setSetupCtaPulseActive(false);
      setSetupMicListening(false);
    }
  }, [view.kind]);

  const topBarMicActive =
    view.kind === 'lesson'
      ? (audioFeedback?.isListening ?? false)
      : view.kind === 'setup'
        ? setupMicListening
        : false;

  const activeLessonId = view.kind === 'lesson' ? view.lesson.id : null;
  const lessonTitle = view.kind === 'lesson' ? view.lesson.title : null;
  const canGoBack = view.kind === 'lesson' || (view.kind === 'setup' && onboarded);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-sp-black font-display">
      <TopBar
        lessonTitle={lessonTitle}
        isListening={topBarMicActive}
        onBack={canGoBack ? handleTopBarBack : null}
      />

      <div className="flex-1 flex min-h-0">
        <Sidebar
          lessons={LESSONS}
          activeLessonId={activeLessonId}
          activeTopLevel={view.kind === 'setup' ? 'setup' : view.kind === 'home' ? 'home' : null}
          onSelectLesson={handleSelectLesson}
          onGoHome={handleSidebarHome}
          onGoSetup={handleGoSetup}
        />

        <main className="sp-main-content">
          <div className="sp-main-gradient">
            {view.kind === 'lesson' ? (
              <Lesson
                key={view.lesson.id}
                lesson={view.lesson}
                onAudioUpdate={setAudioFeedback}
              />
            ) : view.kind === 'setup' ? (
              <Setup
                onReachedScrollEnd={handleSetupReachedBottom}
                onMicListeningChange={setSetupMicListening}
              />
            ) : (
              <HomeView
                onSelectLesson={handleSelectLesson}
                onGoSetup={handleGoSetup}
                showOnboardingPrompt={!onboarded}
              />
            )}
          </div>
        </main>
      </div>

      <BottomBar
        audio={audioFeedback}
        onSetupReady={view.kind === 'setup' ? handleSetupFinish : undefined}
        setupCtaPulseActive={view.kind === 'setup' && setupCtaPulseActive}
      />
    </div>
  );
}

interface HomeViewProps {
  onSelectLesson: (l: LessonType) => void;
  onGoSetup: () => void;
  showOnboardingPrompt: boolean;
}

function HomeView({ onSelectLesson, onGoSetup, showOnboardingPrompt }: HomeViewProps) {
  return (
    <div className="p-8">
      <section className="mb-8">
        <h1 className="sp-heading-lg mb-1">Good evening</h1>
        <p className="text-sp-text-sub text-sm">Pick a lesson and start playing.</p>
      </section>

      {showOnboardingPrompt && (
        <section className="mb-8">
          <button
            type="button"
            onClick={onGoSetup}
            className="sp-card-interactive group block w-full text-left p-5 border border-sp-green/30"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-md bg-sp-green/20 flex items-center justify-center shrink-0">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-sp-green">
                  <path d="M12 2v4m0 12v4m10-10h-4M6 12H2m14.95-7.05l-2.83 2.83m-8.48 8.48l-2.83 2.83m14.14 0l-2.83-2.83M7.05 7.05L4.22 4.22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-white">New here? Run the setup first.</p>
                <p className="text-sm text-sp-text-sub mt-0.5">
                  Connect your guitar, grant mic access, check your signal, and tune up before your first lesson.
                </p>
              </div>
              <div className="shrink-0">
                <span className="text-sp-green font-bold text-sm">Open setup &rarr;</span>
              </div>
            </div>
          </button>
        </section>
      )}

      <section>
        <h2 className="sp-heading-md mb-4">Lessons</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LESSONS.map((lesson) => (
            <button
              key={lesson.id}
              type="button"
              onClick={() => onSelectLesson(lesson)}
              className="sp-card-interactive group relative p-5"
            >
              <div className="w-12 h-12 rounded-md bg-sp-green/20 flex items-center justify-center mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-sp-green">
                  <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2"/>
                  <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2"/>
                </svg>
              </div>
              <p className="font-bold text-white text-sm">{lesson.title}</p>
              <p className="text-xs text-sp-text-muted mt-1">
                {lesson.tempoBpm} BPM &middot; {lesson.notes.length} notes
              </p>

              <div className="sp-play-overlay">
                <div className="sp-play-circle">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="black">
                    <path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288V1.713z" />
                  </svg>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export default App;
