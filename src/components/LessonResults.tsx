import type { Lesson, NoteAttemptResult } from '../types/lesson';

interface LessonResultsProps {
  lesson: Lesson;
  results: NoteAttemptResult[];
  onRetry: () => void;
  onNextLesson?: () => void;
  onBackHome: () => void;
  guitarSequenceStep?: number;
  guitarSequence?: readonly string[];
  isListening?: boolean;
}

export function LessonResults({
  lesson,
  results,
  onRetry,
  onNextLesson,
  onBackHome,
  guitarSequenceStep = 0,
  guitarSequence = [],
  isListening = false,
}: LessonResultsProps) {
  const hits = results.filter((r) => r.status === 'hit').length;
  const total = results.length;
  const accuracyPct = total > 0 ? Math.round((hits / total) * 100) : 0;

  const timingValues = results
    .map((r) => r.timingOffsetMs)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const meanTimingMs =
    timingValues.length > 0
      ? Math.round(timingValues.reduce((s, v) => s + v, 0) / timingValues.length)
      : null;

  const centsValues = results
    .map((r) => r.meanCents)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const meanCents =
    centsValues.length > 0
      ? Math.round(centsValues.reduce((s, v) => s + v, 0) / centsValues.length)
      : null;

  const timingSummary =
    meanTimingMs == null
      ? 'No note onsets captured'
      : Math.abs(meanTimingMs) <= 12
        ? `Locked in (${meanTimingMs >= 0 ? `+${meanTimingMs}` : meanTimingMs} ms)`
        : meanTimingMs < 0
          ? `Average timing: ${meanTimingMs} ms (slightly rushing)`
          : `Average timing: +${meanTimingMs} ms (slightly behind the beat)`;

  const intonationSummary =
    meanCents == null
      ? 'No steady pitch samples'
      : Math.abs(meanCents) <= 8
        ? `Solid intonation (${meanCents >= 0 ? `+${meanCents}` : meanCents}c)`
        : meanCents < 0
          ? `Average pitch: ${meanCents} cents (slightly flat)`
          : `Average pitch: +${meanCents} cents (slightly sharp — lighten grip)`;

  return (
    <div className="sp-card-padded space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <span className="sp-section-label">Session complete</span>
          <h2 className="sp-heading-lg mt-1">{lesson.title}</h2>
          <p className="text-sm text-sp-text-sub mt-1">
            {lesson.tempoBpm} BPM &middot; {hits}/{total} notes landed cleanly
          </p>
        </div>

        <div
          className={`px-5 py-3 rounded-xl border text-center ${
            accuracyPct >= 80
              ? 'bg-sp-green/15 border-sp-green/40 text-sp-green'
              : accuracyPct >= 50
                ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-300'
                : 'bg-brand-red/15 border-brand-red/40 text-brand-red'
          }`}
        >
          <div className="text-3xl font-extrabold tabular-nums">{accuracyPct}%</div>
          <div className="text-[11px] font-bold uppercase tracking-widest">Accuracy</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="p-4 rounded-lg bg-sp-elevated/70 border border-white/10">
          <div className="text-xs font-bold uppercase tracking-widest text-sp-text-muted">
            Timing feel
          </div>
          <div className="text-sm font-bold text-white mt-1">{timingSummary}</div>
        </div>
        <div className="p-4 rounded-lg bg-sp-elevated/70 border border-white/10">
          <div className="text-xs font-bold uppercase tracking-widest text-sp-text-muted">
            Intonation
          </div>
          <div className="text-sm font-bold text-white mt-1">{intonationSummary}</div>
        </div>
      </div>

      <div>
        <div className="text-xs font-bold uppercase tracking-widest text-sp-text-muted mb-2">
          Note-by-note breakdown
        </div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
          {results.map((r, i) => {
            const isHit = r.status === 'hit';
            return (
              <div
                key={`${r.noteId}-${i}`}
                className={`p-3 rounded-lg border ${
                  isHit
                    ? 'bg-sp-green/10 border-sp-green/35'
                    : 'bg-brand-red/10 border-brand-red/35'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-base font-extrabold text-white">{r.targetLabel}</span>
                  <span
                    className={`text-xs font-bold uppercase ${
                      isHit ? 'text-sp-green' : 'text-brand-red'
                    }`}
                  >
                    {isHit ? 'Hit' : 'Miss'}
                  </span>
                </div>
                <div className="text-[11px] text-sp-text-sub mt-1 tabular-nums flex justify-between">
                  <span>
                    {r.timingOffsetMs != null
                      ? `${r.timingOffsetMs >= 0 ? `+${r.timingOffsetMs}` : r.timingOffsetMs}ms`
                      : '—'}
                  </span>
                  <span>
                    {r.meanCents != null
                      ? `${r.meanCents >= 0 ? `+${Math.round(r.meanCents)}` : Math.round(r.meanCents)}c`
                      : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap pt-2">
        <button type="button" onClick={onRetry} className="sp-btn-primary-compact">
          Play Again
        </button>
        {onNextLesson && (
          <button type="button" onClick={onNextLesson} className="sp-btn-secondary">
            Next Lesson &rarr;
          </button>
        )}
        <button type="button" onClick={onBackHome} className="sp-btn-ghost ml-auto">
          All Lessons
        </button>
      </div>

      {isListening && guitarSequence.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-sp-text-muted">
          <span>Hands-free replay:</span>
          {guitarSequence.map((label, idx) => (
            <span
              key={label}
              className={`px-2 py-0.5 rounded font-bold border ${
                idx < guitarSequenceStep
                  ? 'bg-sp-green/20 border-sp-green text-sp-green'
                  : 'bg-sp-elevated border-white/10 text-sp-text-sub'
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
