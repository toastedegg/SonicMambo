import type { PassageStatRecord, PracticeSessionRecord } from '../storage/db.ts';
import type { Lesson } from '../types/lesson.ts';

const SM2_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;

/**
 * Extracts the 2–3 highest-error 4–8 note passages from recent practice sessions.
 */
export function extractTroubledPassages(
  sessions: readonly PracticeSessionRecord[],
  lessons: readonly Lesson[],
  existingStats: readonly PassageStatRecord[],
  nowIso: string = new Date().toISOString(),
): PassageStatRecord[] {
  const existingMap = new Map(existingStats.map((s) => [s.passageId, s]));
  const candidateScores = new Map<string, { score: number; lesson: Lesson; startIdx: number; endIdx: number }>();

  for (const sess of sessions) {
    if (sess.noteResults.length < 4) continue;
    const lesson = lessons.find((l) => l.title === sess.title);
    if (!lesson || lesson.notes.length < 4) continue;

    // Sliding 4-note window to find highest miss density
    const winSize = Math.min(6, lesson.notes.length);
    for (let start = 0; start <= lesson.notes.length - winSize; start += 1) {
      const slice = sess.noteResults.slice(start, start + winSize);
      const misses = slice.filter((r) => r.status === 'miss').length;
      const centsPenalty = slice.reduce(
        (acc, r) => acc + (r.meanCents != null && Math.abs(r.meanCents) > 25 ? 0.3 : 0),
        0,
      );
      const errScore = misses + centsPenalty;
      if (errScore <= 0) continue;

      const key = `${lesson.id}:${start}:${start + winSize - 1}`;
      const prev = candidateScores.get(key);
      if (!prev || errScore > prev.score) {
        candidateScores.set(key, {
          score: errScore,
          lesson,
          startIdx: start,
          endIdx: start + winSize - 1,
        });
      }
    }
  }

  // Fallback: if player has zero logged mistakes yet, surface opening cells from lessons
  if (candidateScores.size === 0) {
    for (const lesson of lessons.slice(0, 2)) {
      const winSize = Math.min(4, lesson.notes.length);
      const key = `${lesson.id}:0:${winSize - 1}`;
      candidateScores.set(key, {
        score: 0.5,
        lesson,
        startIdx: 0,
        endIdx: winSize - 1,
      });
    }
  }

  const ranked = Array.from(candidateScores.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 3);

  return ranked.map(([passageId, item]) => {
    const existing = existingMap.get(passageId);
    if (existing) {
      return { ...existing, errorScore: item.score };
    }
    const rawSlice = item.lesson.notes.slice(item.startIdx, item.endIdx + 1);
    const firstBeat = rawSlice[0]?.startBeat ?? 0;
    const normalizedNotes = rawSlice.map((n) => ({
      ...n,
      startBeat: n.startBeat - firstBeat,
    }));

    return {
      passageId,
      title: `${item.lesson.title} (Notes ${item.startIdx + 1}\u2013${item.endIdx + 1})`,
      lessonId: item.lesson.id,
      notes: normalizedNotes,
      targetBpm: item.lesson.tempoBpm,
      currentBpm: Math.max(40, Math.round(item.lesson.tempoBpm * 0.8)),
      cleanStreak: 0,
      slipStreak: 0,
      errorScore: item.score,
      intervalDays: 1,
      nextDueIso: nowIso,
      graduated: false,
      updatedAtIso: nowIso,
    };
  });
}

/**
 * Updates Loop Doctor tempo & SM-2 spaced repetition state after a loop pass:
 * - Clean pass (`allHit === true`): +5% BPM, increments `cleanStreak`; 3× clean at `>= targetBpm` graduates & advances interval (`1 -> 3 -> 7 -> 14 -> 30` days).
 * - Slip (`allHit === false`): increments `slipStreak`; 2 consecutive slips drop BPM by -5%.
 */
export function advanceLoopDoctorPassage(
  passage: PassageStatRecord,
  allHit: boolean,
  nowMs: number = Date.now(),
): {
  updated: PassageStatRecord;
  message: string;
} {
  const nowIso = new Date(nowMs).toISOString();

  if (allHit) {
    const nextCleanStreak = passage.cleanStreak + 1;
    const nextBpm = Math.min(
      Math.round(passage.targetBpm * 1.2),
      Math.round(passage.currentBpm * 1.05),
    );
    const hitTarget = passage.currentBpm >= passage.targetBpm;
    const graduatedNow = hitTarget && nextCleanStreak >= 3;

    let nextInterval = passage.intervalDays;
    if (graduatedNow) {
      const idx = SM2_INTERVAL_DAYS.findIndex((d) => d > passage.intervalDays);
      nextInterval =
        idx >= 0
          ? SM2_INTERVAL_DAYS[idx]
          : SM2_INTERVAL_DAYS[SM2_INTERVAL_DAYS.length - 1];
    }
    const nextDueIso = new Date(
      nowMs + nextInterval * 24 * 60 * 60 * 1000,
    ).toISOString();

    const updated: PassageStatRecord = {
      ...passage,
      currentBpm: nextBpm,
      cleanStreak: nextCleanStreak,
      slipStreak: 0,
      intervalDays: nextInterval,
      nextDueIso: graduatedNow ? nextDueIso : passage.nextDueIso,
      graduated: graduatedNow || passage.graduated,
      updatedAtIso: nowIso,
    };

    const message = graduatedNow
      ? `Passage graduated! Returning in ${nextInterval} day(s) for spaced review.`
      : `Clean pass! Tempo stepped up +5% to ${nextBpm} BPM.`;
    return { updated, message };
  }

  const nextSlipStreak = passage.slipStreak + 1;
  const shouldDrop = nextSlipStreak >= 2;
  const nextBpm = shouldDrop
    ? Math.max(40, Math.round(passage.currentBpm * 0.95))
    : passage.currentBpm;

  const updated: PassageStatRecord = {
    ...passage,
    currentBpm: nextBpm,
    cleanStreak: 0,
    slipStreak: shouldDrop ? 0 : nextSlipStreak,
    updatedAtIso: nowIso,
  };

  return {
    updated,
    message: shouldDrop
      ? `2 slips in a row \u2014 easing -5% to ${nextBpm} BPM to lock clean muscle memory.`
      : `Slip recorded \u2014 holding ${passage.currentBpm} BPM for another pass.`,
  };
}
