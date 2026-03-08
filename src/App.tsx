import { useMemo, useState } from 'react';
import { useAudioEngine } from './hooks/useAudioEngine';
import { GUITAR_TARGET_NOTES } from './utils/noteFromFrequency';

function App() {
  const { isListening, currentNote, frequency, loudness, error, start, stop } = useAudioEngine();
  const [targetNote, setTargetNote] = useState<string>(() =>
    GUITAR_TARGET_NOTES[Math.floor(Math.random() * GUITAR_TARGET_NOTES.length)]
  );

  const matches = useMemo(() => {
    if (!currentNote?.label || !targetNote) return false;
    return currentNote.label === targetNote;
  }, [currentNote?.label, targetNote]);

  const pickNewTarget = () => {
    setTargetNote(
      GUITAR_TARGET_NOTES[Math.floor(Math.random() * GUITAR_TARGET_NOTES.length)]
    );
  };

  return (
    <div className="min-h-screen bg-brand-gray font-display flex flex-col items-center justify-center p-6">
      <header className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-gray-800">SonicMambo</h1>
        <p className="text-gray-600 mt-1">Ear training for guitarists</p>
      </header>

      <main className="w-full max-w-md flex flex-col items-center gap-8">
        {!isListening ? (
          <button
            type="button"
            onClick={start}
            className="w-full max-w-sm py-4 px-6 rounded-2xl bg-brand-blue hover:bg-brand-blue-dark active:scale-[0.98] text-white font-bold text-lg shadow-md transition-all"
          >
            Start Lesson
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={stop}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Stop listening
            </button>

            <section className="w-full rounded-2xl bg-white p-6 shadow-sm border border-brand-gray-dark/30">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide text-center mb-2">
                Target note
              </p>
              <p className="text-4xl font-extrabold text-gray-800 text-center">
                Play a {targetNote}
              </p>
            </section>

            <section className="w-full rounded-2xl bg-white p-6 shadow-sm border border-brand-gray-dark/30">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide text-center mb-2">
                Detected note
              </p>
              <div
                className={`min-h-[4rem] flex flex-col items-center justify-center rounded-xl transition-colors ${
                  currentNote?.label
                    ? matches
                      ? 'bg-brand-green/15'
                      : 'bg-brand-red/10'
                    : 'bg-gray-100'
                }`}
              >
                {currentNote?.label ? (
                  <>
                    <p
                      className={`text-3xl font-extrabold ${
                        matches ? 'text-brand-green' : 'text-gray-800'
                      }`}
                    >
                      {currentNote.label}
                    </p>
                    {frequency != null && (
                      <p className="text-sm text-gray-500 mt-1">
                        {frequency.toFixed(1)} Hz
                      </p>
                    )}
                    <span
                      className={`mt-2 text-sm font-semibold ${
                        matches ? 'text-brand-green' : 'text-brand-red'
                      }`}
                    >
                      {matches ? '✓ Match!' : 'Keep trying'}
                    </span>
                  </>
                ) : (
                  <p className="text-gray-400 text-lg">Play a note…</p>
                )}
              </div>
              {loudness > 0 && (
                <p className="text-xs text-gray-400 text-center mt-2">
                  Loudness: {(loudness * 100).toFixed(1)}%
                </p>
              )}
            </section>

            <button
              type="button"
              onClick={pickNewTarget}
              className="py-2 px-4 rounded-xl bg-brand-gray-dark hover:bg-gray-300 text-gray-700 font-semibold text-sm transition-colors"
            >
              New target note
            </button>
          </>
        )}

        {error && (
          <p className="text-brand-red font-semibold text-center">{error}</p>
        )}
      </main>
    </div>
  );
}

export default App;
