export type LessonNoteStatus = 'pending' | 'hit' | 'miss';

export interface LessonNoteDefinition {
  id: string;
  label: string;
  startBeat: number;
  durationBeats: number;
}

export interface LessonTimelineNote extends LessonNoteDefinition {
  startMs: number;
  durationMs: number;
  status: LessonNoteStatus;
}

export interface Lesson {
  id: string;
  title: string;
  tempoBpm: number;
  notes: LessonNoteDefinition[];
}
