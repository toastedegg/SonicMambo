import type { NoteEvent } from '../dsp/types.ts';
import type {
  AnalyzedJazzNote,
  ChordChange,
  JazzNoteClassification,
  JazzTakeAnalysis,
} from '../types/jazz.ts';

function findChordAtBeat(changes: readonly ChordChange[], beat: number): { chord: ChordChange; index: number } {
  for (let i = 0; i < changes.length; i += 1) {
    const c = changes[i];
    if (beat >= c.startBeat && beat < c.startBeat + c.durationBeats) {
      return { chord: c, index: i };
    }
  }
  const lastIdx = Math.max(0, changes.length - 1);
  return { chord: changes[lastIdx], index: lastIdx };
}

function isStrongBeat(beatInMeasure: number): boolean {
  const frac = ((beatInMeasure % 2) + 2) % 2;
  return frac <= 0.35 || frac >= 1.65;
}

/**
 * Classifies improvised `NoteEvent[]` over jazz chord changes (`ii–V–I`):
 * - Chord tones on strong beats (1 & 3)
 * - Guide-tone resolutions across chord boundaries (`<= 2` semitones from 3rd/7th to new 3rd/7th)
 * - Chromatic approach notes / enclosures resolving by `±1` semitone into a chord tone
 * - Outside notes (unresolved non-scale tones held `> 250 ms`)
 */
export function analyzeJazzImprovisation(
  events: readonly NoteEvent[],
  changes: readonly ChordChange[],
  tempoBpm: number,
): JazzTakeAnalysis {
  if (events.length === 0 || changes.length === 0) {
    return {
      analyzedNotes: [],
      strongBeatChordTonePct: 0,
      guideToneResolutions: 0,
      approachOrEnclosures: 0,
      outsideNoteCount: 0,
      summaryTip: 'Play through the changes to analyze your chord tones and guide-tone voice leading.',
    };
  }

  const beatMs = 60_000 / tempoBpm;
  const analyzed: AnalyzedJazzNote[] = [];

  let strongBeatNotes = 0;
  let strongBeatChordTones = 0;
  let guideToneResolutions = 0;
  let approachOrEnclosures = 0;
  let outsideNoteCount = 0;

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    const beat = Math.max(0, ev.onsetMs / beatMs);
    const pc = ((ev.midi % 12) + 12) % 12;
    const { chord, index: chordIdx } = findChordAtBeat(changes, beat);
    const beatInChord = beat - chord.startBeat;

    const isChordTone = chord.chordTones.includes(pc);
    const isGuideTone = chord.guideTones.includes(pc);
    const isScaleTone = chord.scaleTones.includes(pc);
    const strong = isStrongBeat(beatInChord);

    if (strong) {
      strongBeatNotes += 1;
      if (isChordTone) strongBeatChordTones += 1;
    }

    let classification: JazzNoteClassification = 'scale-tone';
    let resolutionNote: string | undefined;

    // 1. Check guide-tone resolution at chord change (landed near beat 1 of new chord)
    if (i > 0 && chordIdx > 0 && beatInChord <= 1.25 && isGuideTone) {
      const prevEv = events[i - 1];
      const prevBeat = Math.max(0, prevEv.onsetMs / beatMs);
      const { chord: prevChord, index: prevChordIdx } = findChordAtBeat(changes, prevBeat);
      const prevPc = ((prevEv.midi % 12) + 12) % 12;
      const semiDist = Math.abs(ev.midi - prevEv.midi);
      if (
        prevChordIdx === chordIdx - 1 &&
        prevChord.guideTones.includes(prevPc) &&
        semiDist >= 1 &&
        semiDist <= 2
      ) {
        classification = 'guide-tone-resolution';
        resolutionNote = `${prevEv.label} \u2192 ${ev.label}`;
        guideToneResolutions += 1;
      }
    }

    // 2. Check chromatic approach / enclosure into next chord tone
    if (classification === 'scale-tone' && !isChordTone && i + 1 < events.length) {
      const nextEv = events[i + 1];
      const nextBeat = Math.max(0, nextEv.onsetMs / beatMs);
      const { chord: nextChord } = findChordAtBeat(changes, nextBeat);
      const nextPc = ((nextEv.midi % 12) + 12) % 12;
      const semiStep = Math.abs(nextEv.midi - ev.midi);

      // Direct half-step approach OR 2-note enclosure (next-next note resolves)
      const isDirectApproach = semiStep === 1 && nextChord.chordTones.includes(nextPc);
      let isEnclosure = false;
      if (!isDirectApproach && i + 2 < events.length) {
        const thirdEv = events[i + 2];
        const thirdBeat = Math.max(0, thirdEv.onsetMs / beatMs);
        const { chord: thirdChord } = findChordAtBeat(changes, thirdBeat);
        const thirdPc = ((thirdEv.midi % 12) + 12) % 12;
        if (
          thirdChord.chordTones.includes(thirdPc) &&
          Math.abs(ev.midi - thirdEv.midi) <= 2 &&
          Math.abs(nextEv.midi - thirdEv.midi) <= 2 &&
          Math.sign(ev.midi - thirdEv.midi) !== Math.sign(nextEv.midi - thirdEv.midi)
        ) {
          isEnclosure = true;
        }
      }

      if (isDirectApproach || isEnclosure) {
        classification = 'approach-enclosure';
        approachOrEnclosures += 1;
      }
    }

    if (classification === 'scale-tone') {
      if (isChordTone) {
        classification = strong ? 'chord-tone-strong' : 'chord-tone';
      } else if (!isScaleTone && ev.durationMs > 250) {
        classification = 'outside-note';
        outsideNoteCount += 1;
      }
    }

    analyzed.push({
      noteId: ev.id,
      label: ev.label,
      midi: ev.midi,
      pitchClass: pc,
      beat: Math.round(beat * 100) / 100,
      chordSymbol: chord.symbol,
      classification,
      resolutionNote,
    });
  }

  const strongBeatChordTonePct =
    strongBeatNotes > 0 ? Math.round((strongBeatChordTones / strongBeatNotes) * 100) : 0;

  let summaryTip = '';
  if (guideToneResolutions >= 2 && strongBeatChordTonePct >= 70) {
    summaryTip = `Strong voice leading: ${guideToneResolutions} guide-tone resolutions and ${strongBeatChordTonePct}% chord tones on strong beats.`;
  } else if (guideToneResolutions === 0) {
    summaryTip = 'Try connecting the 7th of the ii7/V7 chord down by half-step into the 3rd of the next chord on beat 1.';
  } else if (strongBeatChordTonePct < 55) {
    summaryTip = 'Anchor beats 1 and 3 with chord tones (1, 3, 5, 7) so the harmony rings out even without a backing track.';
  } else {
    summaryTip = `${strongBeatChordTonePct}% strong-beat chord tones with ${approachOrEnclosures} chromatic approaches.`;
  }

  return {
    analyzedNotes: analyzed,
    strongBeatChordTonePct,
    guideToneResolutions,
    approachOrEnclosures,
    outsideNoteCount,
    summaryTip,
  };
}
