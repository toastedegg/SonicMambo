import { useCallback, useState } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { BottomBar } from './components/BottomBar';
import type { AudioFeedback } from './components/BottomBar';
import { Lesson } from './components/Lesson';
import { LESSONS } from './data/lessons';
import type { Lesson as LessonType } from './types/lesson';

function App() {
  const [activeLesson, setActiveLesson] = useState<LessonType | null>(null);
  const [audioFeedback, setAudioFeedback] = useState<AudioFeedback | null>(null);

  const handleBack = useCallback(() => {
    setActiveLesson(null);
    setAudioFeedback(null);
  }, []);

  const handleSelectLesson = useCallback((lesson: LessonType) => {
    setActiveLesson(lesson);
    setAudioFeedback(null);
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-sp-black font-display">
      <TopBar
        lessonTitle={activeLesson?.title ?? null}
        isListening={audioFeedback?.isListening ?? false}
        onBack={activeLesson ? handleBack : null}
      />

      <div className="flex-1 flex min-h-0">
        <Sidebar
          lessons={LESSONS}
          activeLessonId={activeLesson?.id ?? null}
          onSelectLesson={handleSelectLesson}
        />

        <main className="flex-1 overflow-y-auto p-2">
          <div className="h-full rounded-lg bg-gradient-to-b from-sp-elevated/60 to-sp-black">
            {activeLesson ? (
              <Lesson
                key={activeLesson.id}
                lesson={activeLesson}
                onAudioUpdate={setAudioFeedback}
              />
            ) : (
              <HomeView onSelectLesson={handleSelectLesson} />
            )}
          </div>
        </main>
      </div>

      <BottomBar audio={audioFeedback} />
    </div>
  );
}

function HomeView({ onSelectLesson }: { onSelectLesson: (l: LessonType) => void }) {
  return (
    <div className="p-8">
      <section className="mb-10">
        <h1 className="text-3xl font-extrabold text-white mb-1">Good evening</h1>
        <p className="text-sp-text-sub text-sm">Pick a lesson and start playing.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white mb-4">Lessons</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LESSONS.map((lesson) => (
            <button
              key={lesson.id}
              type="button"
              onClick={() => onSelectLesson(lesson)}
              className="group relative bg-sp-base hover:bg-sp-elevated p-5 rounded-lg text-left transition-all duration-200"
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

              <div className="absolute right-4 bottom-4 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-200">
                <div className="w-10 h-10 rounded-full bg-sp-green flex items-center justify-center shadow-lg shadow-black/40">
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
