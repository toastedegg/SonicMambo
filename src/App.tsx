import { useEffect, useMemo, useRef, useState } from 'react';
import { LessonStaffPixi } from './components/LessonStaffPixi';
import { LESSONS } from './data/lessons';
import { useAudioEngine } from './hooks/useAudioEngine';
import type { Lesson, LessonTimelineNote } from './types/lesson';

const TOLERANCE_MS = 100;
const HIT_RATIO = 0.6;

function App() {
  const { isListening, currentNote, frequency, loudness, error, start, stop } = useAudioEngine();
  const [selectedLesson, setSelectedLesson] = useState<Lesson>(LESSONS[0]);
  const [isLessonRunning, setIsLessonRunning] = useState(false);
  const [lessonNotes, setLessonNotes] = useState<LessonTimelineNote[]>([]);
  const [lessonElapsedMs, setLessonElapsedMs] = useState(0);
  const [lessonStartedAt, setLessonStartedAt] = useState<number | null>(null);
  const detectedLabelRef = useRef<string | null>(null);
  const noteAccumulatorRef = useRef<Map<string, { matchFrames: number; totalFrames: number }>>(new Map());
  const [lastDetectedNote, setLastDetectedNote] = useState<{ label: string; frequency: number } | null>(null);

  const beatMs = 60_000 / selectedLesson.tempoBpm;
  const lessonDurationMs = useMemo(
    () =>
      selectedLesson.notes.reduce((max, note) => {
        const noteEnd = (note.startBeat + note.durationBeats) * beatMs;
        return Math.max(max, noteEnd);
      }, 0),
    [beatMs, selectedLesson.notes]
  );

  useEffect(() => {
    detectedLabelRef.current = currentNote?.label ?? null;
    if (currentNote?.label && frequency != null) {
      setLastDetectedNote({ label: currentNote.label, frequency });
    }
  }, [currentNote?.label, frequency]);

  const startLesson = async () => {
    await start();
    noteAccumulatorRef.current = new Map();
    const seedNotes: LessonTimelineNote[] = selectedLesson.notes.map((note) => ({
      ...note,
      startMs: note.startBeat * beatMs,
      durationMs: note.durationBeats * beatMs,
      status: 'pending',
    }));
    setLessonNotes(seedNotes);
    setLessonElapsedMs(0);
    setLessonStartedAt(performance.now());
    setIsLessonRunning(true);
  };

  const stopLesson = () => {
    setIsLessonRunning(false);
    setLessonStartedAt(null);
    setLessonElapsedMs(0);
    setLastDetectedNote(null);
    stop();
  };

  useEffect(() => {
    if (!isLessonRunning || lessonStartedAt == null) return undefined;

    let rafId = 0;
    const accumulators = noteAccumulatorRef.current;

    const loop = () => {
      const elapsed = performance.now() - lessonStartedAt;
      setLessonElapsedMs(elapsed);

      const detectedLabel = detectedLabelRef.current;

      setLessonNotes((prev) =>
        prev.map((note) => {
          if (note.status !== 'pending') return note;

          const noteOpen = note.startMs - TOLERANCE_MS;
          const noteClose = note.startMs + note.durationMs + TOLERANCE_MS;

          if (elapsed >= noteOpen && elapsed <= noteClose) {
            let acc = accumulators.get(note.id);
            if (!acc) {
              acc = { matchFrames: 0, totalFrames: 0 };
              accumulators.set(note.id, acc);
            }
            acc.totalFrames++;
            if (detectedLabel === note.label) {
              acc.matchFrames++;
            }
            return note;
          }

          if (elapsed > noteClose) {
            const acc = accumulators.get(note.id);
            const ratio = acc && acc.totalFrames > 0 ? acc.matchFrames / acc.totalFrames : 0;
            return { ...note, status: ratio >= HIT_RATIO ? 'hit' : 'miss' };
          }

          return note;
        })
      );

      if (elapsed > lessonDurationMs + 600) {
        setIsLessonRunning(false);
        return;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isLessonRunning, lessonDurationMs, lessonStartedAt]);

  const activeTargetNote = useMemo(() => {
    if (!isLessonRunning) return null;
    return lessonNotes.find((note) => lessonElapsedMs >= note.startMs && lessonElapsedMs <= note.startMs + note.durationMs) ?? null;
  }, [isLessonRunning, lessonElapsedMs, lessonNotes]);

  const scoringTargetNote = useMemo(() => {
    if (!isLessonRunning) return null;
    return lessonNotes.find((note) =>
      note.status === 'pending'
      && lessonElapsedMs >= note.startMs - TOLERANCE_MS
      && lessonElapsedMs <= note.startMs + note.durationMs + TOLERANCE_MS
    ) ?? null;
  }, [isLessonRunning, lessonElapsedMs, lessonNotes]);

  const stats = useMemo(() => {
    const hits = lessonNotes.filter((note) => note.status === 'hit').length;
    const misses = lessonNotes.filter((note) => note.status === 'miss').length;
    return { hits, misses };
  }, [lessonNotes]);

  return (
    <div className="min-h-screen bg-brand-gray font-display flex flex-col items-center p-6">
      <header className="text-center mt-6 mb-6">
        <h1 className="text-3xl font-extrabold text-gray-800">SonicMambo</h1>
        <p className="text-gray-600 mt-1">Ear training for guitarists</p>
      </header>

      <main className="w-full max-w-4xl flex flex-col items-center gap-6">
        <section className="w-full rounded-2xl bg-white p-5 shadow-sm border border-brand-gray-dark/30">
          {!isLessonRunning ? (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Choose lesson</p>
                <div className="flex flex-wrap gap-2">
                  {LESSONS.map((lesson) => (
                    <button
                      key={lesson.id}
                      type="button"
                      onClick={() => setSelectedLesson(lesson)}
                      className={`py-2 px-4 rounded-xl font-semibold text-sm transition-colors ${
                        selectedLesson.id === lesson.id
                          ? 'bg-brand-blue text-white'
                          : 'bg-brand-gray-dark hover:bg-gray-300 text-gray-700'
                      }`}
                    >
                      {lesson.title}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={startLesson}
                className="w-full py-4 px-6 rounded-2xl bg-brand-blue hover:bg-brand-blue-dark active:scale-[0.98] text-white font-bold text-lg shadow-md transition-all"
              >
                Start Lesson
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500 font-semibold">Lesson in progress</p>
              <button
                type="button"
                onClick={stopLesson}
                className="py-2 px-4 rounded-xl bg-brand-red hover:bg-brand-red-dark text-white font-semibold text-sm transition-colors"
              >
                Stop
              </button>
            </div>
          )}
        </section>

        <section className="w-full rounded-2xl bg-white p-5 shadow-sm border border-brand-gray-dark/30">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide text-center mb-2">
            Target note
          </p>
          <p className="text-4xl font-extrabold text-gray-800 text-center">
            {activeTargetNote ? `Play ${activeTargetNote.label}` : 'Press Start Lesson'}
          </p>
        </section>

        <LessonStaffPixi
          notes={lessonNotes}
          currentTimeMs={lessonElapsedMs}
          durationMs={lessonDurationMs}
          detectedNoteLabel={currentNote?.label ?? null}
        />

        <section className="w-full rounded-2xl bg-white p-6 shadow-sm border border-brand-gray-dark/30">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide text-center mb-2">
            Detected note
          </p>
          <div
            className={`min-h-[4.5rem] flex flex-col items-center justify-center rounded-xl transition-colors ${
              currentNote?.label
                ? scoringTargetNote && currentNote.label === scoringTargetNote.label
                  ? 'bg-brand-green/15'
                  : 'bg-brand-red/10'
                : 'bg-gray-100'
            }`}
          >
            {currentNote?.label ? (
              <>
                <p className="text-3xl font-extrabold text-gray-800">{currentNote.label}</p>
                {frequency != null && (
                  <p className="text-sm text-gray-500 mt-1">{frequency.toFixed(1)} Hz</p>
                )}
              </>
            ) : lastDetectedNote ? (
              <>
                <p className="text-3xl font-extrabold text-gray-800">{lastDetectedNote.label}</p>
                <p className="text-sm text-gray-500 mt-1">{lastDetectedNote.frequency.toFixed(1)} Hz</p>
              </>
            ) : (
              <p className="text-gray-400 text-lg">Play a note...</p>
            )}
          </div>
          <div className="mt-3 flex items-center justify-center gap-5 text-sm font-semibold text-gray-600">
            <span>Hits: <span className="text-brand-green">{stats.hits}</span></span>
            <span>Misses: <span className="text-brand-red">{stats.misses}</span></span>
            <span>Loudness: {(loudness * 100).toFixed(1)}%</span>
            <span>Mic: {isListening ? 'On' : 'Off'}</span>
          </div>
        </section>

        {error && (
          <p className="text-brand-red font-semibold text-center">{error}</p>
        )}
      </main>
    </div>
  );
}

export default App;
