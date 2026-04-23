import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { LessonTimelineNote, LessonNoteStatus } from '../types/lesson';
import { STAFF } from '../config/staff';
import { noteLabelToMidi } from '../utils/noteFromFrequency';

export interface DetectionRef {
  hz: number | null;
  label: string | null;
  confidence: number;
  timestamp: number;
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
  hit: 0x1db954,
  miss: 0xff4b4b,
  text: 0x9aa3b2,
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

type NoteShape = 'quarter' | 'half' | 'whole';

function shapeForDuration(durationBeats: number): NoteShape {
  if (durationBeats >= 4) return 'whole';
  if (durationBeats >= 2) return 'half';
  return 'quarter';
}

interface NoteVisual {
  note: LessonTimelineNote;
  /** Outer container: positioned at (slotX, headY). Never scaled. */
  container: Container;
  /** Inner container holding head/stem/ledger. Scales around its own origin = head center. */
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

  // Persistent layers
  const staffLayerRef = useRef<Graphics | null>(null);
  const clefLayerRef = useRef<Container | null>(null);
  const notesLayerRef = useRef<Container | null>(null);

  const noteVisualsRef = useRef<Map<string, NoteVisual>>(new Map());
  const viewportRef = useRef<{ width: number; height: number }>({ width: 760, height });
  /** Cached id-set signature of the last rebuilt note set, for rebuild-guarding. */
  const lastNoteIdsRef = useRef<string>('');

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

      const staff = new Graphics();
      const clef = new Container();
      const notesLayer = new Container();

      app.stage.addChild(staff);
      app.stage.addChild(notesLayer);
      app.stage.addChild(clef);

      staffLayerRef.current = staff;
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
      clefLayerRef.current = null;
      notesLayerRef.current = null;
      noteVisualsRef.current.clear();
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
      layoutNoteVisuals();
    });
    ro.observe(host);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // -------- Rebuild note visuals only when the note id-set actually changes --------
  useEffect(() => {
    if (!appRef.current) return;
    const idKey = notes.map((n) => n.id).join('|');
    if (idKey === lastNoteIdsRef.current) return;
    lastNoteIdsRef.current = idKey;
    rebuildNoteVisuals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  // ----------------------------------------------------------------
  // Geometry helpers
  // ----------------------------------------------------------------
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

  // ----------------------------------------------------------------
  // Static drawing (staff lines + clef marker)
  // ----------------------------------------------------------------
  function drawStaticLayers() {
    const staff = staffLayerRef.current;
    const clef = clefLayerRef.current;
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

    noteVisualsRef.current.forEach((v) => {
      v.container.destroy({ children: true });
    });
    noteVisualsRef.current.clear();
    layer.removeChildren();

    const seededStatuses = noteStatusRef.current;

    notes.forEach((note, index) => {
      const step = labelToDiatonic(note.label);
      const headY = diatonicToY(step);

      // Outer container: translates to the note's slot. Never scaled.
      const container = new Container();
      container.x = slotX(index);
      container.y = 0;

      // Inner glyph container: positioned at (0, headY) so that its local origin
      // coincides with the note head's visual center. Scaling this container
      // bounces the head in-place, never translating it vertically.
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

      // Label lives on the outer container so it never scales with the pulse.
      container.addChild(glyph);
      container.addChild(label);
      layer.addChild(container);

      // Seed last-* from the authoritative status ref so already-finalized notes
      // don't re-pulse just because the visuals were (re)built.
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

  /** Re-place existing containers after a resize (no destroy/rebuild needed). */
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

  /** Ledger lines are drawn in glyph-local coords: y=0 is the head, each step is stepHeightPx. */
  function drawLedgerLines(v: NoteVisual) {
    const step = labelToDiatonic(v.note.label);
    const ledger = v.ledger;
    ledger.clear();
    const w = 14;
    const stepH = stepHeightPx();
    if (step < BOTTOM_LINE) {
      for (let lp = BOTTOM_LINE - 2; lp >= step; lp -= 2) {
        const dy = (step - lp) * stepH; // positive: draw below the head (lp below head)
        ledger
          .moveTo(-w, dy)
          .lineTo(w, dy)
          .stroke({ width: 1.5, color: COLORS.staff, alpha: 0.95 });
      }
    } else if (step > TOP_LINE) {
      for (let lp = TOP_LINE + 2; lp <= step; lp += 2) {
        const dy = (step - lp) * stepH; // negative: draw above the head
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

  /** Head and stem are drawn in glyph-local coords: y=0 is the head center. */
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
      // Half and whole use a hollow oval.
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

    // Stem direction: below middle line -> stem up, at/above -> stem down.
    // Whole notes have no stem.
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

  // ----------------------------------------------------------------
  // Per-tick update: only color/scale/alpha changes, no position motion
  // ----------------------------------------------------------------
  function tick() {
    const notesLayer = notesLayerRef.current;
    if (!notesLayer) return;

    const now = performance.now();
    const timeMs = currentTimeRef.current;
    const statuses = noteStatusRef.current;
    const detectedLabel = detectionRef.current.label;

    noteVisualsRef.current.forEach((v) => {
      const status = statuses[v.note.id] ?? 'pending';
      const inWindow = timeMs >= v.note.startMs && timeMs < v.note.startMs + v.note.durationMs;
      const isActive = status === 'pending' && inWindow;
      const isMatching = isActive && detectedLabel != null && detectedLabel === v.note.label;

      // Kick off a pulse on pending -> hit/miss transition.
      if (v.lastStatus === 'pending' && (status === 'hit' || status === 'miss')) {
        v.pulseStartedAt = now;
        v.pulseKind = status;
      }

      // Redraw head/stem only when visual state actually changes.
      if (status !== v.lastStatus || isActive !== v.lastActive || isMatching !== v.lastMatching) {
        drawNoteHead(v, status, isActive, isMatching);
        v.lastStatus = status;
        v.lastActive = isActive;
        v.lastMatching = isMatching;
      }

      // Per-note pulse: local scale bounce on hit, local alpha dim on miss.
      // We animate the inner `glyph` (origin at head center) so the bounce is
      // strictly in-place. The outer container never moves or scales.
      if (v.pulseStartedAt != null && v.pulseKind != null) {
        const progress = (now - v.pulseStartedAt) / STAFF.activePulseDurationMs;
        if (progress >= 1) {
          v.pulseStartedAt = null;
          v.pulseKind = null;
          v.glyph.scale.set(1);
          v.glyph.alpha = 1;
        } else {
          const wave = Math.sin(progress * Math.PI); // 0 -> 1 -> 0
          if (v.pulseKind === 'hit') {
            const scale = 1 + 0.22 * wave;
            v.glyph.scale.set(scale);
            v.glyph.alpha = 1;
          } else {
            v.glyph.scale.set(1);
            v.glyph.alpha = 1 - 0.4 * wave;
          }
        }
      }
    });
  }

  return (
    <div className="w-full overflow-hidden sp-card">
      <div ref={hostRef} style={{ width: '100%', height }} />
    </div>
  );
}
