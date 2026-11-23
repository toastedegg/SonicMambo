import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { LessonTimelineNote, LessonNoteStatus } from '../types/lesson';
import { AUDIO, STAFF } from '../config/staff';
import { isLiveMatching } from '../dsp/holdScorer';
import { centsBetween, frequencyToMidi, noteLabelToFrequency, noteLabelToMidi } from '../utils/noteFromFrequency';

export interface DetectionRef {
  hz: number | null;
  label: string | null;
  confidence: number;
  timestamp: number;
  tuningOffsetCents?: number;
}

interface LessonStaffPixiProps {
  notes: LessonTimelineNote[];
  currentTimeRef: React.MutableRefObject<number>;
  detectionRef: React.MutableRefObject<DetectionRef>;
  noteStatusRef: React.MutableRefObject<Record<string, LessonNoteStatus>>;
  height?: number;
}

const COLORS = {
  staff: 0x3a4252,
  staffBright: 0x5a6676,
  pending: 0xcbd3dd,
  active: 0xffd666,
  matchLive: 0x73e69a,
  livePitchOff: 0x60a5fa,
  playhead: 0x1db954,
  hit: 0x1db954,
  miss: 0xff4b4b,
  text: 0x9aa3b2,
} as const;

const STEP_BY_SEMITONE = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];

function midiToDiatonic(midi: number): number {
  if (!Number.isFinite(midi)) return 0;
  const octave = Math.floor(midi / 12) - 1;
  const semiContinuous = ((midi % 12) + 12) % 12;
  const semiFloor = Math.floor(semiContinuous);
  const frac = semiContinuous - semiFloor;
  const base = STEP_BY_SEMITONE[semiFloor];
  const next = semiFloor === 11 ? STEP_BY_SEMITONE[0] + 7 : STEP_BY_SEMITONE[semiFloor + 1];
  const stepInOct = base + frac * (next - base);
  return (octave + 1) * 7 + stepInOct;
}

function labelToDiatonic(label: string): number {
  const midi = noteLabelToMidi(label);
  return midi == null ? 23 : midiToDiatonic(midi);
}

// The staff's bottom line is E3 and the top line is F4 (5 lines, 4 gaps of a 3rd).
const BOTTOM_LINE = labelToDiatonic('E3');
const TOP_LINE = BOTTOM_LINE + 8;

type NoteShape = 'quarter' | 'half' | 'whole';

function shapeForDuration(durationBeats: number): NoteShape {
  if (durationBeats >= 4) return 'whole';
  if (durationBeats >= 2) return 'half';
  return 'quarter';
}

interface NoteVisual {
  note: LessonTimelineNote;
  container: Container;
  glyph: Container;
  head: Graphics;
  stem: Graphics;
  ledger: Graphics;
  anchorX: number;
  lastStatus: LessonNoteStatus;
  lastActive: boolean;
  lastMatching: boolean;
  pulseStartedAt: number | null;
  pulseKind: 'hit' | 'miss' | null;
}

export function LessonStaffPixi({
  notes,
  currentTimeRef,
  detectionRef,
  noteStatusRef,
  height = 220,
}: LessonStaffPixiProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);

  const staffLayerRef = useRef<Graphics | null>(null);
  const playheadRef = useRef<Graphics | null>(null);
  const livePitchRef = useRef<Graphics | null>(null);
  const centsTextRef = useRef<Text | null>(null);
  const clefLayerRef = useRef<Container | null>(null);
  const notesLayerRef = useRef<Container | null>(null);

  const noteVisualsRef = useRef<Map<string, NoteVisual>>(new Map());
  const viewportRef = useRef<{ width: number; height: number }>({ width: 760, height });
  const lastNoteIdsRef = useRef<string>('');
  const lastCentsUpdateAtRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    const visualsMap = noteVisualsRef.current;

    const setup = async () => {
      const host = hostRef.current;
      if (!host) return;

      const width = host.clientWidth || 760;

      const app = new Application();
      await app.init({
        width,
        height,
        antialias: true,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });
      if (cancelled) {
        app.destroy(true);
        return;
      }

      host.innerHTML = '';
      host.appendChild(app.canvas);
      appRef.current = app;
      viewportRef.current = { width, height };

      const staff = new Graphics();
      const playhead = new Graphics();
      const livePitch = new Graphics();
      const centsText = new Text({
        text: '',
        style: {
          fill: COLORS.text,
          fontFamily: 'Nunito, system-ui, sans-serif',
          fontSize: 12,
          fontWeight: '800',
        },
      });
      const clef = new Container();
      const notesLayer = new Container();

      playhead.visible = false;
      livePitch.visible = false;
      centsText.visible = false;

      // Draw static live-pitch capsule geometry once; mutate .x, .y, .tint in tick().
      livePitch
        .roundRect(-14, -4, 28, 8, 4)
        .fill({ color: 0xffffff, alpha: 0.9 })
        .stroke({ width: 1.5, color: 0x0b0f16, alpha: 0.85 });

      app.stage.addChild(staff);
      app.stage.addChild(playhead);
      app.stage.addChild(notesLayer);
      app.stage.addChild(livePitch);
      app.stage.addChild(centsText);
      app.stage.addChild(clef);

      staffLayerRef.current = staff;
      playheadRef.current = playhead;
      livePitchRef.current = livePitch;
      centsTextRef.current = centsText;
      clefLayerRef.current = clef;
      notesLayerRef.current = notesLayer;

      drawStaticLayers();
      rebuildNoteVisuals();
      lastNoteIdsRef.current = notes.map((n) => n.id).join('|');
      app.ticker.add(tick);
    };

    void setup();

    return () => {
      cancelled = true;
      const app = appRef.current;
      if (app) {
        app.ticker.remove(tick);
        app.destroy(true);
      }
      appRef.current = null;
      staffLayerRef.current = null;
      playheadRef.current = null;
      livePitchRef.current = null;
      centsTextRef.current = null;
      clefLayerRef.current = null;
      notesLayerRef.current = null;
      visualsMap.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const app = appRef.current;
    if (!host || !app) return undefined;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const newWidth = Math.max(320, Math.floor(entry.contentRect.width));
      if (newWidth === viewportRef.current.width) return;
      viewportRef.current = { width: newWidth, height };
      app.renderer.resize(newWidth, height);
      drawStaticLayers();
      layoutNoteVisuals();
    });
    ro.observe(host);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  useEffect(() => {
    if (!appRef.current) return;
    const idKey = notes.map((n) => n.id).join('|');
    if (idKey === lastNoteIdsRef.current) return;
    lastNoteIdsRef.current = idKey;
    rebuildNoteVisuals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const staffBottomY = () => STAFF.topLineY + STAFF.lineGap * 4;
  const stepHeightPx = () => STAFF.lineGap / 2;
  const diatonicToY = (step: number) => staffBottomY() - (step - BOTTOM_LINE) * stepHeightPx();

  function computeSlotWidth() {
    const { width } = viewportRef.current;
    const contentLeft = STAFF.clefWidth + STAFF.leftPadding;
    const contentRight = width - STAFF.rightPadding;
    const available = Math.max(0, contentRight - contentLeft);
    const count = Math.max(1, notes.length);
    return Math.max(STAFF.minSlotWidth, available / count);
  }

  function slotX(index: number) {
    const slotW = computeSlotWidth();
    const contentLeft = STAFF.clefWidth + STAFF.leftPadding;
    return contentLeft + (index + 0.5) * slotW;
  }

  function drawStaticLayers() {
    const staff = staffLayerRef.current;
    const clef = clefLayerRef.current;
    const playhead = playheadRef.current;
    if (!staff || !clef) return;

    const { width } = viewportRef.current;
    staff.clear();

    const bandTop = STAFF.topLineY - 10;
    const bandBottom = staffBottomY() + 10;
    staff.rect(0, bandTop, width, bandBottom - bandTop).fill({ color: 0x0d1017, alpha: 0.35 });

    for (let i = 0; i < 5; i += 1) {
      const y = staffBottomY() - i * STAFF.lineGap;
      staff
        .moveTo(STAFF.clefWidth - 4, y)
        .lineTo(width - 8, y)
        .stroke({ width: 1.5, color: COLORS.staff, alpha: 0.95 });
    }

    if (playhead) {
      playhead.clear();
      playhead
        .moveTo(0, STAFF.topLineY - 22)
        .lineTo(0, staffBottomY() + 22)
        .stroke({ width: 2, color: COLORS.playhead, alpha: 0.72 });
      playhead
        .circle(0, STAFF.topLineY - 22, 3.5)
        .fill({ color: COLORS.playhead, alpha: 0.95 });
    }

    clef.removeChildren();
    const brace = new Graphics();
    brace
      .moveTo(18, STAFF.topLineY - 6)
      .lineTo(18, staffBottomY() + 6)
      .stroke({ width: 4, color: COLORS.staffBright, alpha: 0.9 });
    brace
      .roundRect(26, STAFF.topLineY - 4, 14, (staffBottomY() - STAFF.topLineY) + 8, 4)
      .fill({ color: COLORS.staffBright, alpha: 0.15 })
      .stroke({ width: 1, color: COLORS.staffBright, alpha: 0.7 });
    clef.addChild(brace);
  }

  function rebuildNoteVisuals() {
    const layer = notesLayerRef.current;
    if (!layer) return;

    noteVisualsRef.current.forEach((v) => {
      v.container.destroy({ children: true });
    });
    noteVisualsRef.current.clear();
    layer.removeChildren();

    const seededStatuses = noteStatusRef.current;

    notes.forEach((note, index) => {
      const step = labelToDiatonic(note.label);
      const headY = diatonicToY(step);

      const container = new Container();
      container.x = slotX(index);
      container.y = 0;

      const glyph = new Container();
      glyph.x = 0;
      glyph.y = headY;

      const ledger = new Graphics();
      const head = new Graphics();
      const stem = new Graphics();

      glyph.addChild(ledger);
      glyph.addChild(head);
      glyph.addChild(stem);

      const label = new Text({
        text: note.label,
        style: {
          fill: COLORS.text,
          fontFamily: 'Nunito, system-ui, sans-serif',
          fontSize: 11,
          fontWeight: '700',
        },
      });
      label.x = -label.width / 2;
      label.y = staffBottomY() + 10;

      container.addChild(glyph);
      container.addChild(label);
      layer.addChild(container);

      const seededStatus: LessonNoteStatus = seededStatuses[note.id] ?? 'pending';

      const visual: NoteVisual = {
        note,
        container,
        glyph,
        head,
        stem,
        ledger,
        anchorX: container.x,
        lastStatus: seededStatus,
        lastActive: false,
        lastMatching: false,
        pulseStartedAt: null,
        pulseKind: null,
      };

      drawLedgerLines(visual);
      drawNoteHead(visual, seededStatus, false, false);
      noteVisualsRef.current.set(note.id, visual);
    });
  }

  function layoutNoteVisuals() {
    let i = 0;
    notes.forEach((note) => {
      const v = noteVisualsRef.current.get(note.id);
      if (v) {
        const x = slotX(i);
        v.anchorX = x;
        v.container.x = x;
      }
      i += 1;
    });
  }

  function drawLedgerLines(v: NoteVisual) {
    const step = labelToDiatonic(v.note.label);
    const ledger = v.ledger;
    ledger.clear();
    const w = 14;
    const stepH = stepHeightPx();
    if (step < BOTTOM_LINE) {
      for (let lp = BOTTOM_LINE - 2; lp >= step; lp -= 2) {
        const dy = (step - lp) * stepH;
        ledger
          .moveTo(-w, dy)
          .lineTo(w, dy)
          .stroke({ width: 1.5, color: COLORS.staff, alpha: 0.95 });
      }
    } else if (step > TOP_LINE) {
      for (let lp = TOP_LINE + 2; lp <= step; lp += 2) {
        const dy = (step - lp) * stepH;
        ledger
          .moveTo(-w, dy)
          .lineTo(w, dy)
          .stroke({ width: 1.5, color: COLORS.staff, alpha: 0.95 });
      }
    }
  }

  function headColor(status: LessonNoteStatus, active: boolean, matching: boolean): number {
    if (status === 'hit') return COLORS.hit;
    if (status === 'miss') return COLORS.miss;
    if (active && matching) return COLORS.matchLive;
    if (active) return COLORS.active;
    return COLORS.pending;
  }

  function drawNoteHead(v: NoteVisual, status: LessonNoteStatus, active: boolean, matching: boolean) {
    const step = labelToDiatonic(v.note.label);
    const shape = shapeForDuration(v.note.durationBeats);
    const color = headColor(status, active, matching);

    v.head.clear();
    if (shape === 'quarter') {
      v.head
        .ellipse(0, 0, 9, 6.5)
        .fill({ color })
        .stroke({ width: 1.2, color: 0x000000, alpha: 0.4 });
    } else {
      v.head
        .ellipse(0, 0, 9.5, 6.8)
        .fill({ color: 0x0b0f16, alpha: 1 })
        .stroke({ width: 2.2, color });
    }
    if (active && status === 'pending') {
      v.head
        .ellipse(0, 0, 13, 9.5)
        .stroke({ width: 1.5, color, alpha: 0.7 });
    }

    const middleLine = BOTTOM_LINE + 4;
    v.stem.clear();
    if (shape !== 'whole') {
      if (step < middleLine) {
        v.stem
          .moveTo(9, 0)
          .lineTo(9, -28)
          .stroke({ width: 1.8, color });
      } else {
        v.stem
          .moveTo(-9, 0)
          .lineTo(-9, 28)
          .stroke({ width: 1.8, color });
      }
    }
  }

  function tick() {
    const notesLayer = notesLayerRef.current;
    if (!notesLayer) return;

    const now = performance.now();
    const timeMs = currentTimeRef.current;
    const statuses = noteStatusRef.current;
    const det = detectionRef.current;

    let activeNote: LessonTimelineNote | null = null;
    let activeSlotX = STAFF.clefWidth + 24;
    let activeIsMatching = false;

    const slotW = computeSlotWidth();
    let playheadX: number | null = null;

    let index = 0;
    noteVisualsRef.current.forEach((v) => {
      const status = statuses[v.note.id] ?? 'pending';
      const inWindow = timeMs >= v.note.startMs && timeMs < v.note.startMs + v.note.durationMs;
      const isActive = status === 'pending' && inWindow;
      const isMatching =
        isActive &&
        isLiveMatching(
          v.note.label,
          det.hz,
          det.confidence,
          det.tuningOffsetCents ?? 0,
        ).isMatch;

      if (inWindow) {
        activeNote = v.note;
        activeSlotX = v.anchorX;
        activeIsMatching = isMatching;
        const p = Math.max(0, Math.min(1, (timeMs - v.note.startMs) / Math.max(1, v.note.durationMs)));
        playheadX = v.anchorX - slotW * 0.4 + p * (slotW * 0.8);
      }

      if (v.lastStatus === 'pending' && (status === 'hit' || status === 'miss')) {
        v.pulseStartedAt = now;
        v.pulseKind = status;
      }

      if (status !== v.lastStatus || isActive !== v.lastActive || isMatching !== v.lastMatching) {
        drawNoteHead(v, status, isActive, isMatching);
        v.lastStatus = status;
        v.lastActive = isActive;
        v.lastMatching = isMatching;
      }

      if (v.pulseStartedAt != null && v.pulseKind != null) {
        const progress = (now - v.pulseStartedAt) / STAFF.activePulseDurationMs;
        if (progress >= 1) {
          v.pulseStartedAt = null;
          v.pulseKind = null;
          v.glyph.scale.set(1);
          v.glyph.alpha = 1;
        } else {
          const wave = Math.sin(progress * Math.PI);
          if (v.pulseKind === 'hit') {
            v.glyph.scale.set(1 + 0.22 * wave);
            v.glyph.alpha = 1;
          } else {
            v.glyph.scale.set(1);
            v.glyph.alpha = 1 - 0.4 * wave;
          }
        }
      }

      index += 1;
    });
    void index;

    // 1. Playhead update
    const playhead = playheadRef.current;
    if (playhead) {
      if (timeMs > 0 && notes.length > 0) {
        if (playheadX == null) {
          const first = notes[0];
          const last = notes[notes.length - 1];
          if (timeMs < first.startMs) {
            playheadX = slotX(0) - slotW * 0.4;
          } else {
            const lastEnd = last.startMs + last.durationMs;
            playheadX =
              timeMs >= lastEnd
                ? slotX(notes.length - 1) + slotW * 0.4
                : slotX(0);
          }
        }
        playhead.x = playheadX;
        playhead.visible = true;
      } else {
        playhead.visible = false;
      }
    }

    // 2. Live pitch marker update
    const livePitch = livePitchRef.current;
    if (livePitch) {
      if (det.hz != null && det.confidence >= AUDIO.minConfidence) {
        const rawMidi = frequencyToMidi(det.hz);
        if (Number.isFinite(rawMidi)) {
          const clampedMidi = Math.max(40, Math.min(84, rawMidi));
          const step = midiToDiatonic(clampedMidi);
          const py = Math.max(18, Math.min(height - 18, diatonicToY(step)));
          livePitch.x = activeNote != null ? activeSlotX : STAFF.clefWidth + 24;
          livePitch.y = py;
          livePitch.tint = activeIsMatching ? COLORS.matchLive : COLORS.livePitchOff;
          livePitch.visible = true;
        } else {
          livePitch.visible = false;
        }
      } else {
        livePitch.visible = false;
      }
    }

    // 3. Cents readout on active note (throttled ~80 ms)
    const centsText = centsTextRef.current;
    if (centsText) {
      if (activeNote && det.hz != null && det.confidence >= AUDIO.minConfidence) {
        if (now - lastCentsUpdateAtRef.current >= 80) {
          lastCentsUpdateAtRef.current = now;
          const targetHz = noteLabelToFrequency((activeNote as LessonTimelineNote).label);
          if (targetHz != null) {
            const c = Math.round(centsBetween(det.hz, targetHz) - (det.tuningOffsetCents ?? 0));
            const label =
              Math.abs(c) <= 6 ? 'In tune' : c > 0 ? `+${c}c` : `${c}c`;
            centsText.text = label;
            centsText.style.fill =
              Math.abs(c) <= 15
                ? COLORS.matchLive
                : Math.abs(c) <= 45
                  ? COLORS.active
                  : COLORS.miss;
          }
        }
        centsText.x = activeSlotX - centsText.width / 2;
        centsText.y = STAFF.topLineY - 30;
        centsText.visible = centsText.text.length > 0;
      } else {
        centsText.visible = false;
      }
    }
  }

  return (
    <div className="w-full overflow-hidden sp-card">
      <div ref={hostRef} style={{ width: '100%', height }} />
    </div>
  );
}
