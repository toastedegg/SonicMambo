import { useEffect, useState } from 'react';
import {
  computeWeeklyPracticeSummary,
  listPracticeSessions,
  type PracticeSessionRecord,
} from '../storage/db';

export function HistoryView() {
  const [sessions, setSessions] = useState<PracticeSessionRecord[]>([]);
  const [selected, setSelected] = useState<PracticeSessionRecord | null>(null);

  useEffect(() => {
    void listPracticeSessions().then((all) => {
      setSessions(all);
      if (all.length > 0) setSelected(all[0]);
    });
  }, []);

  const summary = computeWeeklyPracticeSummary(sessions);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <span className="sp-section-label">Post-Session Review</span>
          <h1 className="sp-heading-lg mt-1">Practice History</h1>
          <p className="text-sm text-sp-text-sub mt-1">
            Consistency over perfection: your weekly practice minutes &amp; note-level retrospectives.
          </p>
        </div>

        <div className="flex gap-3">
          <div className="px-4 py-2.5 rounded-lg bg-sp-elevated border border-white/10">
            <div className="text-[11px] font-bold uppercase tracking-widest text-sp-text-muted">
              Last 7 days
            </div>
            <div className="text-xl font-extrabold text-sp-green tabular-nums">
              {summary.weeklyMinutes} min
            </div>
          </div>
          <div className="px-4 py-2.5 rounded-lg bg-sp-elevated border border-white/10">
            <div className="text-[11px] font-bold uppercase tracking-widest text-sp-text-muted">
              Active days
            </div>
            <div className="text-xl font-extrabold text-white tabular-nums">
              {summary.activeDaysLast7Days} / 7
            </div>
          </div>
        </div>
      </header>

      {sessions.length === 0 ? (
        <div className="sp-card-padded text-sm text-sp-text-sub">
          No practice sessions saved yet. Complete any stage on the Course Roadmap to inspect your accuracy, timing, and intonation history here.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {sessions.map((s) => {
              const isSel = selected?.id === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelected(s)}
                  className={`w-full text-left p-3.5 rounded-lg border transition-colors ${
                    isSel
                      ? 'bg-sp-green/15 border-sp-green'
                      : 'bg-sp-base hover:bg-sp-elevated border-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-sp-green">
                      {s.mode}
                    </span>
                    <span className="text-xs font-bold text-white tabular-nums">
                      {Math.round(s.accuracy * 100)}%
                    </span>
                  </div>
                  <div className="text-sm font-bold text-white truncate mt-0.5">
                    {s.title}
                  </div>
                  <div className="text-[11px] text-sp-text-muted mt-1">
                    {new Date(s.startedAtIso).toLocaleString()} &middot; {s.tempoBpm} BPM
                  </div>
                </button>
              );
            })}
          </div>

          <div className="md:col-span-2">
            {selected && (
              <div className="sp-card-padded space-y-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <span className="sp-section-label">{selected.mode}</span>
                    <h2 className="sp-heading-md mt-0.5">{selected.title}</h2>
                    <p className="text-xs text-sp-text-muted mt-1">
                      {new Date(selected.startedAtIso).toLocaleString()} &middot; {selected.durationSec}s &middot; {selected.tempoBpm} BPM
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-extrabold text-sp-green tabular-nums">
                      {Math.round(selected.accuracy * 100)}%
                    </div>
                    <div className="text-xs text-sp-text-sub">
                      {selected.hits} hits / {selected.misses} misses
                    </div>
                  </div>
                </div>

                {selected.notesSummary && (
                  <p className="text-sm text-white bg-sp-elevated/70 p-3.5 rounded-lg border border-white/10">
                    {selected.notesSummary}
                  </p>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="p-3 rounded-lg bg-sp-elevated/50 border border-white/10 text-xs">
                    <span className="text-sp-text-muted uppercase font-bold">Mean timing offset</span>
                    <div className="text-lg font-extrabold text-white mt-0.5 tabular-nums">
                      {selected.meanTimingOffsetMs != null
                        ? `${selected.meanTimingOffsetMs >= 0 ? `+${selected.meanTimingOffsetMs}` : selected.meanTimingOffsetMs} ms`
                        : '—'}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-sp-elevated/50 border border-white/10 text-xs">
                    <span className="text-sp-text-muted uppercase font-bold">Mean intonation</span>
                    <div className="text-lg font-extrabold text-white mt-0.5 tabular-nums">
                      {selected.meanCentsError != null
                        ? `${selected.meanCentsError >= 0 ? `+${selected.meanCentsError}` : selected.meanCentsError} cents`
                        : '—'}
                    </div>
                  </div>
                </div>

                {selected.noteResults.length > 0 && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-widest text-sp-text-muted mb-2">
                      Note timeline
                    </div>
                    <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                      {selected.noteResults.map((nr, idx) => (
                        <div
                          key={`${nr.noteId}-${idx}`}
                          className={`p-2.5 rounded-lg border text-xs ${
                            nr.status === 'hit'
                              ? 'bg-sp-green/10 border-sp-green/35'
                              : 'bg-brand-red/10 border-brand-red/35'
                          }`}
                        >
                          <div className="flex justify-between font-bold text-white">
                            <span>{nr.targetLabel}</span>
                            <span className={nr.status === 'hit' ? 'text-sp-green' : 'text-brand-red'}>
                              {nr.status}
                            </span>
                          </div>
                          <div className="text-sp-text-muted mt-1 tabular-nums flex justify-between">
                            <span>{nr.timingOffsetMs != null ? `${nr.timingOffsetMs}ms` : '—'}</span>
                            <span>{nr.meanCents != null ? `${Math.round(nr.meanCents)}c` : '—'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
