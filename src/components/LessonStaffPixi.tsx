import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { LessonTimelineNote, LessonNoteStatus } from '../types/lesson';
import { STAFF } from '../config/staff';
import { frequencyToMidi, noteLabelToMidi } from '../utils/noteFromFrequency';

export interface DetectionRef {
  hz: number | null;
  label: string | null;
  confidence: number;
  timestamp: number;
}

export interface LessonStaffFlash {
  status: 'hit' | 'miss' | null;
  /** Monotonic counter bumped each time a flash should fire. */
  token: number;
}

interface LessonStaffPixiProps {
  notes: LessonTimelineNote[];
  beatMs: number;
  currentTimeRef: React.MutableRefObject<number>;
  detectionRef: React.MutableRefObject<DetectionRef>;
  noteStatusRef: React.MutableRefObject<Record<string, LessonNoteStatus>>;
  flashRef: React.MutableRefObject<LessonStaffFlash>;
  height?: number;
}

const COLORS = {
  staff: 0x3a4252,
  staffBright: 0x5a6676,
  pending: 0xcbd3dd,
  hit: 0x1db954,
  miss: 0xff4b4b,
  hitLine: 0x1db954,
  hitLineGlow: 0x1db954,
  text: 0x9aa3b2,
  ribbon: 0xff9500,
  ribbonGlow: 0xffb347,
  activeHead: 0xffd666,
  holdBarPending: 0x57616f,
  holdBarHit: 0x1db954,
  holdBarMiss: 0xff4b4b,
} as const;

/** Semitone (0=C..11=B) -> half-step position on the diatonic staff, within one octave.
 *  Letters sit on integer values; accidentals sit halfway between. */
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

interface NoteVisual {
  note: LessonTimelineNote;
  container: Container;
  head: Graphics;
  stem: Graphics;
  holdBar: Graphics;
  ledger: Graphics;
  lastStatus: LessonNoteStatus | null;
  lastActive: boolean;
}

export function LessonStaffPixi({
  notes,
  beatMs,
  currentTimeRef,
  detectionRef,
  noteStatusRef,
  flashRef,
  height = 240,
}: LessonStaffPixiProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);

  // Layers (persistent across renders)
  const staffLayerRef = useRef<Graphics | null>(null);
  const clefLayerRef = useRef<Container | null>(null);
  const notesLayerRef = useRef<Container | null>(null);
  const ribbonLayerRef = useRef<Graphics | null>(null);
  const hitLineLayerRef = useRef<Graphics | null>(null);
  const hitFlashLayerRef = useRef<Graphics | null>(null);

  const noteVisualsRef = useRef<Map<string, NoteVisual>>(new Map());
  const ribbonBufferRef = useRef<Array<{ t: number; step: number }>>([]);
  const lastFlashTokenRef = useRef(0);
  const flashStartedAtRef = useRef<number | null>(null);
  const flashStatusRef = useRef<'hit' | 'miss' | null>(null);

  const viewportRef = useRef<{ width: number; height: number }>({ width: 760, height });

  // -------- Setup Pixi app once --------
  useEffect(() => {
    let cancelled = false;

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

      // Build persistent layers (bottom -> top).
      const staff = new Graphics();
      const clef = new Container();
      const ribbon = new Graphics();
      const notesLayer = new Container();
      const hitLine = new Graphics();
      const hitFlash = new Graphics();

      app.stage.addChild(staff);
      app.stage.addChild(ribbon);
      app.stage.addChild(notesLayer);
      app.stage.addChild(hitLine);
      app.stage.addChild(hitFlash);
      app.stage.addChild(clef);

      staffLayerRef.current = staff;
      clefLayerRef.current = clef;
      notesLayerRef.current = notesLayer;
      ribbonLayerRef.current = ribbon;
      hitLineLayerRef.current = hitLine;
      hitFlashLayerRef.current = hitFlash;

      drawStaticLayers();
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
      clefLayerRef.current = null;
      notesLayerRef.current = null;
      ribbonLayerRef.current = null;
      hitLineLayerRef.current = null;
      hitFlashLayerRef.current = null;
      noteVisualsRef.current.clear();
      ribbonBufferRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- Resize handling --------
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
    });
    ro.observe(host);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // -------- Rebuild note visuals when `notes` identity changes --------
  useEffect(() => {
    if (!appRef.current) return;
    rebuildNoteVisuals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  // ----------------------------------------------------------------
  // Geometry helpers (read from viewportRef so they're always current)
  // ----------------------------------------------------------------
  const staffBottomY = () => STAFF.topLineY + STAFF.lineGap * 4;
  const hitX = () => viewportRef.current.width * STAFF.hitLineFraction;
  const stepHeightPx = () => STAFF.lineGap / 2;

  const diatonicToY = (step: number) => staffBottomY() - (step - BOTTOM_LINE) * stepHeightPx();

  // ----------------------------------------------------------------
  // Static drawing (staff lines + clef marker)
  // ----------------------------------------------------------------
  function drawStaticLayers() {
    const staff = staffLayerRef.current;
    const clef = clefLayerRef.current;
    if (!staff || !clef) return;

    const { width } = viewportRef.current;
    staff.clear();

    // Background tint for the staff band (subtle, helps separate from page).
    const bandTop = STAFF.topLineY - 10;
    const bandBottom = staffBottomY() + 10;
    staff.rect(0, bandTop, width, bandBottom - bandTop).fill({ color: 0x0d1017, alpha: 0.35 });

    // 5 staff lines.
    for (let i = 0; i < 5; i += 1) {
      const y = staffBottomY() - i * STAFF.lineGap;
      staff
        .moveTo(48, y)
        .lineTo(width - 8, y)
        .stroke({ width: 1.5, color: COLORS.staff, alpha: 0.95 });
    }

    // Simple left-edge brace (stylized, not a real clef glyph yet).
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

  // ----------------------------------------------------------------
  // Build / rebuild per-note visuals
  // ----------------------------------------------------------------
  function rebuildNoteVisuals() {
    const layer = notesLayerRef.current;
    if (!layer) return;

    // Dispose existing visuals.
    noteVisualsRef.current.forEach((v) => {
      v.container.destroy({ children: true });
    });
    noteVisualsRef.current.clear();
    layer.removeChildren();

    notes.forEach((note) => {
      const step = labelToDiatonic(note.label);
      const y = diatonicToY(step);

      const container = new Container();
      container.y = 0; // all positioning is via per-element y; container carries x translation.

      const ledger = new Graphics();
      const holdBar = new Graphics();
      const head = new Graphics();
      const stem = new Graphics();

      container.addChild(holdBar);
      container.addChild(ledger);
      container.addChild(head);
      container.addChild(stem);

      // Label under note (kept visible, small).
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
      container.addChild(label);

      layer.addChild(container);

      const visual: NoteVisual = {
        note,
        container,
        head,
        stem,
        holdBar,
        ledger,
        lastStatus: null,
        lastActive: false,
      };

      drawNoteHead(visual, 'pending', false);
      drawLedgerLines(visual, step, y);
      drawHoldBar(visual, 'pending');
      noteVisualsRef.current.set(note.id, visual);
    });
  }

  function drawLedgerLines(v: NoteVisual, step: number, y: number) {
    const ledger = v.ledger;
    ledger.clear();
    const w = 14;
    if (step < BOTTOM_LINE) {
      for (let lp = BOTTOM_LINE - 2; lp >= step; lp -= 2) {
        const ly = diatonicToY(lp);
        ledger
          .moveTo(-w, ly)
          .lineTo(w, ly)
          .stroke({ width: 1.5, color: COLORS.staff, alpha: 0.95 });
      }
    } else if (step > TOP_LINE) {
      for (let lp = TOP_LINE + 2; lp <= step; lp += 2) {
        const ly = diatonicToY(lp);
        ledger
          .moveTo(-w, ly)
          .lineTo(w, ly)
          .stroke({ width: 1.5, color: COLORS.staff, alpha: 0.95 });
      }
    }
    // ensure y=0 at head position isn't needed since we drew in world-y within container
    void y;
  }

  function drawNoteHead(v: NoteVisual, status: LessonNoteStatus, active: boolean) {
    const step = labelToDiatonic(v.note.label);
    const y = diatonicToY(step);
    const isHalfOrLonger = v.note.durationBeats >= 2;
    const color =
      status === 'hit' ? COLORS.hit
        : status === 'miss' ? COLORS.miss
          : active ? COLORS.activeHead
            : COLORS.pending;

    v.head.clear();
    if (isHalfOrLonger) {
      // Hollow oval.
      v.head
        .ellipse(0, y, 9, 6.5)
        .fill({ color: 0x0b0f16, alpha: 1 })
        .stroke({ width: 2.2, color });
    } else {
      // Filled oval.
      v.head
        .ellipse(0, y, 9, 6.5)
        .fill({ color })
        .stroke({ width: 1.2, color: 0x000000, alpha: 0.4 });
    }
    if (active) {
      // Soft active glow.
      v.head
        .ellipse(0, y, 13, 9.5)
        .stroke({ width: 1.5, color: COLORS.activeHead, alpha: 0.7 });
    }

    // Stem direction: below middle line -> stem up, at/above -> stem down.
    const middleLine = BOTTOM_LINE + 4;
    v.stem.clear();
    if (step < middleLine) {
      v.stem
        .moveTo(9, y)
        .lineTo(9, y - 28)
        .stroke({ width: 1.8, color });
    } else {
      v.stem
        .moveTo(-9, y)
        .lineTo(-9, y + 28)
        .stroke({ width: 1.8, color });
    }
  }

  function drawHoldBar(v: NoteVisual, status: LessonNoteStatus) {
    const bar = v.holdBar;
    const step = labelToDiatonic(v.note.label);
    const y = diatonicToY(step);
    const widthPx = v.note.durationBeats * STAFF.pixelsPerBeat;
    const barHeight = 10;
    const color =
      status === 'hit' ? COLORS.holdBarHit
        : status === 'miss' ? COLORS.holdBarMiss
          : COLORS.holdBarPending;
    const alpha = status === 'pending' ? 0.55 : 0.85;

    bar.clear();
    bar
      .roundRect(0, y - barHeight / 2, widthPx, barHeight, barHeight / 2)
      .fill({ color, alpha });
    // Leading edge accent.
    bar
      .moveTo(0, y - barHeight / 2)
      .lineTo(0, y + barHeight / 2)
      .stroke({ width: 2, color, alpha: 0.95 });
  }

  // ----------------------------------------------------------------
  // Per-tick render
  // ----------------------------------------------------------------
  function tick() {
    const app = appRef.current;
    const notesLayer = notesLayerRef.current;
    const hitLine = hitLineLayerRef.current;
    const hitFlash = hitFlashLayerRef.current;
    const ribbon = ribbonLayerRef.current;
    if (!app || !notesLayer || !hitLine || !hitFlash || !ribbon) return;

    const now = performance.now();
    const timeMs = currentTimeRef.current;
    const currentBeat = beatMs > 0 ? timeMs / beatMs : 0;
    const hx = hitX();
    const { width } = viewportRef.current;

    // --- Notes: update x, status color, active glow ---
    const statuses = noteStatusRef.current;
    noteVisualsRef.current.forEach((v) => {
      const startBeat = v.note.startBeat;
      const endBeat = startBeat + v.note.durationBeats;
      const x = hx + (startBeat - currentBeat) * STAFF.pixelsPerBeat;
      v.container.x = x;

      // Cull when fully off-screen (left of brace or far right of viewport).
      const rightEdge = x + v.note.durationBeats * STAFF.pixelsPerBeat;
      v.container.visible = rightEdge > 40 && x < width + 40;

      const status = statuses[v.note.id] ?? 'pending';
      const isActive = status === 'pending' && currentBeat >= startBeat && currentBeat < endBeat;

      if (status !== v.lastStatus || isActive !== v.lastActive) {
        drawNoteHead(v, status, isActive);
        drawHoldBar(v, status);
        v.lastStatus = status;
        v.lastActive = isActive;
      }
    });

    // --- Hit line ---
    hitLine.clear();
    hitLine
      .rect(hx - 2, STAFF.topLineY - 30, 4, (staffBottomY() - STAFF.topLineY) + 60)
      .fill({ color: COLORS.hitLine, alpha: 0.95 });
    hitLine
      .rect(hx - 8, STAFF.topLineY - 30, 16, (staffBottomY() - STAFF.topLineY) + 60)
      .fill({ color: COLORS.hitLineGlow, alpha: 0.12 });

    // --- Hit/miss flash ---
    const flash = flashRef.current;
    if (flash.token !== lastFlashTokenRef.current) {
      lastFlashTokenRef.current = flash.token;
      flashStartedAtRef.current = now;
      flashStatusRef.current = flash.status;
    }
    hitFlash.clear();
    if (flashStartedAtRef.current != null && flashStatusRef.current) {
      const elapsed = now - flashStartedAtRef.current;
      const progress = Math.min(elapsed / STAFF.flashDurationMs, 1);
      if (progress >= 1) {
        flashStartedAtRef.current = null;
        flashStatusRef.current = null;
      } else {
        const flashColor = flashStatusRef.current === 'hit' ? COLORS.hit : COLORS.miss;
        const alpha = (1 - progress) * 0.55;
        const radius = 20 + progress * 80;
        hitFlash
          .rect(hx - radius, STAFF.topLineY - 30, radius * 2, (staffBottomY() - STAFF.topLineY) + 60)
          .fill({ color: flashColor, alpha });
      }
    }

    // --- Pitch ribbon: sample and draw ---
    const det = detectionRef.current;
    const buf = ribbonBufferRef.current;
    if (det.hz != null && Number.isFinite(det.hz)) {
      const step = midiToDiatonic(frequencyToMidi(det.hz));
      buf.push({ t: timeMs, step });
    } else {
      // Push a "gap" marker so we don't connect across silence.
      buf.push({ t: timeMs, step: Number.NaN });
    }
    // Drop samples outside the visible window.
    const oldestVisibleTime = timeMs - STAFF.ribbonWindowMs;
    while (buf.length > 0 && buf[0].t < oldestVisibleTime) buf.shift();
    if (buf.length > STAFF.ribbonBufferSize) {
      buf.splice(0, buf.length - STAFF.ribbonBufferSize);
    }

    ribbon.clear();
    if (buf.length > 1) {
      let drawing = false;
      for (let i = 0; i < buf.length; i += 1) {
        const sample = buf[i];
        if (!Number.isFinite(sample.step)) {
          drawing = false;
          continue;
        }
        const sx = hx + ((sample.t - timeMs) / beatMs) * STAFF.pixelsPerBeat;
        const sy = diatonicToY(sample.step);
        if (!drawing) {
          ribbon.moveTo(sx, sy);
          drawing = true;
        } else {
          ribbon.lineTo(sx, sy);
        }
      }
      ribbon.stroke({ width: 3, color: COLORS.ribbon, alpha: 0.9 });

      // Pitch dot at the most recent sample that has a valid step.
      for (let i = buf.length - 1; i >= 0; i -= 1) {
        const sample = buf[i];
        if (!Number.isFinite(sample.step)) continue;
        const sx = hx + ((sample.t - timeMs) / beatMs) * STAFF.pixelsPerBeat;
        const sy = diatonicToY(sample.step);
        ribbon
          .circle(sx, sy, 5)
          .fill({ color: COLORS.ribbon, alpha: 0.95 })
          .stroke({ width: 1.5, color: 0x000000, alpha: 0.35 });
        break;
      }
    }
  }

  return (
    <div className="w-full overflow-hidden sp-card">
      <div ref={hostRef} style={{ width: '100%', height }} />
    </div>
  );
}
