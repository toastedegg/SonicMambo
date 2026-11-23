import type { Lesson, LessonNoteDefinition } from '../types/lesson.ts';
import { midiToNoteLabel } from '../utils/noteFromFrequency.ts';

const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/**
 * Browser & Node friendly MusicXML importer (zero copyrighted score distribution —
 * users import their own `.musicxml` / `.xml` exports locally).
 * Uses `DOMParser` in browser or lightweight regex/XML tag parsing fallback in Node.
 */
export function parseMusicXml(xmlText: string, fallbackTitle: string = 'Imported Score'): Lesson {
  if (typeof DOMParser !== 'undefined') {
    return parseWithDom(xmlText, fallbackTitle);
  }
  return parseWithRegex(xmlText, fallbackTitle);
}

function parseWithDom(xmlText: string, fallbackTitle: string): Lesson {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const titleEl =
    doc.querySelector('work > work-title') ??
    doc.querySelector('movement-title');
  const title = titleEl?.textContent?.trim() || fallbackTitle;

  const soundEl = doc.querySelector('direction sound[tempo]');
  const tempoAttr = soundEl?.getAttribute('tempo');
  const tempoBpm = tempoAttr ? Math.max(30, Math.min(240, Math.round(Number(tempoAttr)))) : 84;

  const notes: LessonNoteDefinition[] = [];
  let divisions = 1;
  let cursorBeat = 0;
  let noteIdx = 1;

  const measures = Array.from(doc.querySelectorAll('part > measure'));
  for (const measure of measures) {
    const divText = measure.querySelector('attributes > divisions')?.textContent;
    if (divText && Number(divText) > 0) {
      divisions = Number(divText);
    }
    const measureTempo = measure.querySelector('direction sound[tempo]')?.getAttribute('tempo');
    void measureTempo;

    const noteEls = Array.from(measure.querySelectorAll('note'));
    for (const nEl of noteEls) {
      const isChord = nEl.querySelector('chord') != null;
      const isRest = nEl.querySelector('rest') != null;
      const durText = nEl.querySelector('duration')?.textContent;
      const durationBeats = durText ? Number(durText) / divisions : 1;

      if (isRest) {
        if (!isChord) cursorBeat += durationBeats;
        continue;
      }

      if (isChord) {
        // Melody lane: skip stacked chord voices on same onset
        continue;
      }

      const tieStop = nEl.querySelector('tie[type="stop"]') != null;
      const tieStart = nEl.querySelector('tie[type="start"]') != null;
      if (tieStop && !tieStart && notes.length > 0) {
        notes[notes.length - 1].durationBeats += durationBeats;
        cursorBeat += durationBeats;
        continue;
      }

      const step = nEl.querySelector('pitch > step')?.textContent?.trim() ?? 'C';
      const alter = Number(nEl.querySelector('pitch > alter')?.textContent ?? '0');
      const octave = Number(nEl.querySelector('pitch > octave')?.textContent ?? '4');

      const midi = (octave + 1) * 12 + (STEP_TO_SEMITONE[step] ?? 0) + alter;
      const label = midiToNoteLabel(midi);
      if (label) {
        notes.push({
          id: `xml-${noteIdx++}`,
          label,
          startBeat: Math.round(cursorBeat * 1000) / 1000,
          durationBeats: Math.round(durationBeats * 1000) / 1000,
        });
      }
      cursorBeat += durationBeats;
    }
  }

  return {
    id: `xml-${Date.now()}`,
    title,
    tempoBpm,
    notes,
  };
}

function parseWithRegex(xmlText: string, fallbackTitle: string): Lesson {
  const titleMatch =
    xmlText.match(/<work-title>([^<]+)<\/work-title>/) ??
    xmlText.match(/<movement-title>([^<]+)<\/movement-title>/);
  const title = titleMatch?.[1]?.trim() || fallbackTitle;

  const tempoMatch = xmlText.match(/tempo="(\d+(?:\.\d+)?)"/);
  const tempoBpm = tempoMatch ? Math.max(30, Math.min(240, Math.round(Number(tempoMatch[1])))) : 84;

  const divMatch = xmlText.match(/<divisions>(\d+)<\/divisions>/);
  const divisions = divMatch ? Math.max(1, Number(divMatch[1])) : 1;

  const notes: LessonNoteDefinition[] = [];
  let cursorBeat = 0;
  let noteIdx = 1;

  const noteBlocks = xmlText.match(/<note[\s\S]*?<\/note>/g) ?? [];
  for (const block of noteBlocks) {
    const isChord = /<chord\s*\/>/.test(block);
    const isRest = /<rest\s*\/>/.test(block);
    const durMatch = block.match(/<duration>(\d+)<\/duration>/);
    const durationBeats = durMatch ? Number(durMatch[1]) / divisions : 1;

    if (isRest) {
      if (!isChord) cursorBeat += durationBeats;
      continue;
    }
    if (isChord) continue;

    const step = block.match(/<step>([A-G])<\/step>/)?.[1];
    const alter = Number(block.match(/<alter>(-?\d+)<\/alter>/)?.[1] ?? '0');
    const octave = Number(block.match(/<octave>(\d+)<\/octave>/)?.[1] ?? '4');
    if (step) {
      const midi = (octave + 1) * 12 + (STEP_TO_SEMITONE[step] ?? 0) + alter;
      const label = midiToNoteLabel(midi);
      if (label) {
        notes.push({
          id: `xml-${noteIdx++}`,
          label,
          startBeat: Math.round(cursorBeat * 1000) / 1000,
          durationBeats: Math.round(durationBeats * 1000) / 1000,
        });
      }
    }
    cursorBeat += durationBeats;
  }

  return {
    id: `xml-${Date.now()}`,
    title,
    tempoBpm,
    notes,
  };
}
