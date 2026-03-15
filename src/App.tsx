import { useState } from 'react';
import { Lesson } from './components/Lesson';
import { LESSONS } from './data/lessons';
import type { Lesson as LessonType } from './types/lesson';

function App() {
  const [activeLesson, setActiveLesson] = useState<LessonType | null>(null);

  if (activeLesson) {
    return (
      <Lesson
        key={activeLesson.id}
        lesson={activeLesson}
        onBack={() => setActiveLesson(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-brand-gray font-display flex flex-col items-center p-6">
      <header className="text-center mt-6 mb-8">
        <h1 className="text-3xl font-extrabold text-gray-800">SonicMambo</h1>
        <p className="text-gray-600 mt-1">Ear training for guitarists</p>
      </header>

      <main className="w-full max-w-4xl">
        <section className="w-full rounded-2xl bg-white p-6 shadow-sm border border-brand-gray-dark/30">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Choose lesson</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {LESSONS.map((lesson) => (
              <button
                key={lesson.id}
                type="button"
                onClick={() => setActiveLesson(lesson)}
                className="text-left p-4 rounded-xl border border-brand-gray-dark/40 hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
              >
                <p className="font-bold text-gray-800">{lesson.title}</p>
                <p className="text-sm text-gray-600 mt-1">{lesson.tempoBpm} BPM - {lesson.notes.length} notes</p>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
