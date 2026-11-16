import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { CoursePracticeMode, CourseTabNote } from '../data/guitarCourses';
import type { DetectionSnapshot } from '../hooks/useAudioEngine';
import type { LessonNoteStatus } from '../types/lesson';
import { centsBetween, frequencyToMidi, noteLabelToFrequency, noteLabelToMidi } from '../utils/noteFromFrequency';

export type NotationMode = 'staff' | 'tab';
export type HiddenDifficulty = 'ghost-passing' | 'bar-anchors' | 'full-blackout';

export interface StageMotionSnapshot {
  running: boolean;
  previewing: boolean;
  inCountIn: boolean;
  countInNumber: number;
  shadowPhase: 'idle' | 'listen' | 'respond';
  /** Course-global beat position (`0 .. totalBars * beatsPerBar`). */
  courseBeat: number;
  beatInBar: number;
  activeTargetNoteId: string | null;
  focusStartBeat: number;
}

export interface MinimalScoreCanvasPixiProps {
  notes: readonly CourseTabNote[];
  barChords: readonly string[];
  totalBars: number;
  beatsPerBar: number;
  accentHex: string;
  notationMode: NotationMode;
  practiceMode: CoursePracticeMode;
  hiddenDifficulty: HiddenDifficulty;
  loopRange: 'all' | { startBar: number; endBar: number };
  motionRef: React.MutableRefObject<StageMotionSnapshot>;
  detectionRef: React.MutableRefObject<DetectionSnapshot>;
  noteStatusRef: React.MutableRefObject<Record<string, LessonNoteStatus>>;
  onSelectBar?: (barNumber: number) => void;
}

const CANVAS_HEIGHT = 300;
const CLEF_MARGIN_W = 74;
const PX_PER_BEAT = 82;

// Staff vertical layout (concert E3 = bottom line of octave-transposed guitar treble staff)
const STAFF_LINE_GAP = 14;
const STAFF_HALF_STEP = STAFF_LINE_GAP / 2;
const STAFF_TOP_Y = 136;
const STAFF_BOTTOM_Y = STAFF_TOP_Y + STAFF_LINE_GAP * 4; // 192

// TAB vertical layout (6 strings)
const TAB_LINE_GAP = 21;
const TAB_TOP_Y = 98;

const STEP_BY_SEMITONE = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const;
const IS_SHARP_SEMITONE = [false, true, false, true, false, false, true, false, true, false, true, false] as const;
const CONTINUOUS_STEP = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6] as const;

function midiToStaffStep(midi: number): { diatonicStep: number; isSharp: boolean } {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  const semi = ((rounded % 12) + 12) % 12;
  return {
    diatonicStep: (octave + 1) * 7 + STEP_BY_SEMITONE[semi],
    isSharp: IS_SHARP_SEMITONE[semi],
  };
}

function continuousMidiToStaffY(midi: number): number {
  const octave = Math.floor(midi / 12) - 1;
  const semiCont = ((midi % 12) + 12) % 12;
  const semiFloor = Math.floor(semiCont);
  const frac = semiCont - semiFloor;
  const base = CONTINUOUS_STEP[semiFloor];
  const next = semiFloor === 11 ? 7 : CONTINUOUS_STEP[semiFloor + 1];
  const step = (octave + 1) * 7 + base + frac * (next - base);
  return STAFF_BOTTOM_Y - (step - BOTTOM_E3_STEP) * STAFF_HALF_STEP;
}

const BOTTOM_E3_STEP = midiToStaffStep(52).diatonicStep; // E3 = MIDI 52
const TOP_F4_STEP = BOTTOM_E3_STEP + 8; // F4 = MIDI 65

function parseHexColor(hex: string): number {
  const clean = hex.replace('#', '');
  const parsed = Number.parseInt(clean, 16);
  return Number.isFinite(parsed) ? parsed : 0x1db954;
}

function shouldHideNote(
  note: CourseTabNote,
  isFirstInBar: boolean,
  practiceMode: CoursePracticeMode,
  difficulty: HiddenDifficulty,
  status: LessonNoteStatus,
  previewing: boolean,
): boolean {
  if (practiceMode !== 'hidden' || previewing) return false;
  if (status === 'hit' || status === 'miss') return false;
  if (difficulty === 'full-blackout') return true;
  if (difficulty === 'bar-anchors') return !isFirstInBar;
  return !note.isAnchor;
}

interface BuiltNoteGlyph {
  note: CourseTabNote;
  isFirstInBar: boolean;
  worldX: number;
  trueY: number;
  hiddenY: number;
  container: Container;
  sustainTail: Graphics;
  ledgerGraphic: Graphics;
  glyphGraphic: Graphics;
  textLabel: Text | null;
  accidentalText: Text | null;
  lastStateKey: string;
  pulseAgeSec: number;
  lastStatus: LessonNoteStatus;
}

export function MinimalScoreCanvasPixi({
  notes,
  barChords,
  totalBars,
  beatsPerBar,
  accentHex,
  notationMode,
  practiceMode,
  hiddenDifficulty,
  loopRange,
  motionRef,
  detectionRef,
  noteStatusRef,
  onSelectBar,
}: MinimalScoreCanvasPixiProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const barProgressRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Keep latest reactive props in refs so Pixi ticker never needs to recreate the WebGL context
  const configRef = useRef({
    notes,
    barChords,
    totalBars,
    beatsPerBar,
    accentColor: parseHexColor(accentHex),
    notationMode,
    practiceMode,
    hiddenDifficulty,
    loopRange,
  });
  configRef.current = {
    notes,
    barChords,
    totalBars,
    beatsPerBar,
    accentColor: parseHexColor(accentHex),
    notationMode,
    practiceMode,
    hiddenDifficulty,
    loopRange,
  };

  const rebuildSceneRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let disposed = false;
    let appInstance: Application | null = null;

    const builtNotes: BuiltNoteGlyph[] = [];
    let cameraX = 0;
    let cameraInitialized = false;
    let smoothLiveMidi: number | null = null;
    let userScrubOffsetBeats = 0;

    const initPixi = async () => {
      const host = hostRef.current;
      if (!host) return;

      const initWidth = Math.max(320, host.clientWidth || 920);
      const app = new Application();
      await app.init({
        width: initWidth,
        height: CANVAS_HEIGHT,
        antialias: true,
        backgroundAlpha: 0,
        resolution: Math.min(2, window.devicePixelRatio || 1),
        autoDensity: true,
        powerPreference: 'high-performance',
      });

      if (disposed) {
        app.destroy(true);
        return;
      }

      host.innerHTML = '';
      host.appendChild(app.canvas);
      appInstance = app;

      // Scene graph layers (allocated once!)
      const bgLinesLayer = new Graphics();
      const worldContainer = new Container();
      const worldBarsLayer = new Graphics();
      const worldChordsContainer = new Container();
      const worldNotesContainer = new Container();
      worldContainer.addChild(worldBarsLayer);
      worldContainer.addChild(worldChordsContainer);
      worldContainer.addChild(worldNotesContainer);

      const playheadLayer = new Graphics();
      const livePitchLayer = new Graphics();
      const leftMarginMask = new Graphics();
      const clefContainer = new Container();

      const countInText = new Text({
        text: '',
        style: {
          fill: 0xffffff,
          fontFamily: 'Nunito, system-ui, sans-serif',
          fontSize: 44,
          fontWeight: '900',
        },
      });
      countInText.anchor.set(0.5, 0.5);
      countInText.visible = false;

      const phaseBadgeText = new Text({
        text: '',
        style: {
          fill: 0x94a3b8,
          fontFamily: 'Nunito, system-ui, sans-serif',
          fontSize: 11,
          fontWeight: '800',
          letterSpacing: 1.6,
        },
      });
      phaseBadgeText.anchor.set(1, 0);
      phaseBadgeText.visible = false;

      app.stage.addChild(bgLinesLayer);
      app.stage.addChild(worldContainer);
      app.stage.addChild(playheadLayer);
      app.stage.addChild(livePitchLayer);
      app.stage.addChild(leftMarginMask);
      app.stage.addChild(clefContainer);
      app.stage.addChild(countInText);
      app.stage.addChild(phaseBadgeText);

      const drawNoteAppearance = (
        item: BuiltNoteGlyph,
        status: LessonNoteStatus,
        isTarget: boolean,
        hidden: boolean,
        accentColor: number,
        isStaff: boolean,
        shadowListen: boolean,
      ) => {
        const { note, glyphGraphic, sustainTail, textLabel, accidentalText } = item;
        glyphGraphic.clear();
        sustainTail.clear();

        let primary = 0xe2e8f0;
        if (status === 'hit') primary = 0x1db954;
        else if (status === 'miss') primary = 0xf43f5e;
        else if (isTarget) primary = shadowListen ? 0x38bdf8 : accentColor;
        else if (hidden) primary = 0x64748b;

        // Subtle horizontal sustain whisper-line for held notes
        if (note.durationBeats >= 0.85 && !hidden) {
          const tailLen = Math.max(12, (note.durationBeats - 0.35) * PX_PER_BEAT);
          sustainTail
            .moveTo(isStaff ? 8 : 11, 0)
            .lineTo(tailLen, 0)
            .stroke({
              width: 2.2,
              color: status === 'hit' ? 0x1db954 : isTarget ? primary : 0x334155,
              alpha: status === 'hit' || isTarget ? 0.55 : 0.28,
            });
        }

        if (isTarget) {
          glyphGraphic
            .circle(0, 0, isStaff ? 13 : 14)
            .fill({ color: primary, alpha: 0.14 });
        }

        if (hidden) {
          // Minimalist hollow mystery diamond
          glyphGraphic
            .poly([0, -7, 7, 0, 0, 7, -7, 0])
            .fill({ color: 0x0b0e14 })
            .stroke({ width: 1.5, color: isTarget ? primary : 0x475569 });
          if (textLabel) {
            textLabel.visible = false;
          }
          if (accidentalText) accidentalText.visible = false;
          return;
        }

        if (isStaff) {
          if (accidentalText) {
            accidentalText.visible = true;
            accidentalText.style.fill = primary;
          }

          const dur = note.durationBeats;
          const isHollow = dur >= 1.75;
          const hasStem = dur < 3.5;

          // Draw rotated musical oval notehead via tilted polygon/ellipse container
          glyphGraphic.ellipse(0, 0, 6.2, 4.5);
          if (isHollow) {
            glyphGraphic
              .fill({ color: 0x0b0e14 })
              .stroke({ width: 1.9, color: primary });
          } else {
            glyphGraphic.fill({ color: primary });
          }

          if (hasStem) {
            const stemUp = item.trueY > STAFF_TOP_Y + STAFF_LINE_GAP * 2;
            const stemX = stemUp ? 5.5 : -5.5;
            const stemTipY = stemUp ? -29 : 29;
            glyphGraphic
              .moveTo(stemX, 0)
              .lineTo(stemX, stemTipY)
              .stroke({ width: 1.5, color: primary, alpha: 0.92 });

            // Crisp engraved 8th / 16th flags (always on the right of the stem, curving toward notehead)
            if (dur < 0.75) {
              const dir = stemUp ? 1 : -1;
              glyphGraphic
                .moveTo(stemX, stemTipY)
                .bezierCurveTo(
                  stemX + 3,
                  stemTipY + dir * 3,
                  stemX + 8.5,
                  stemTipY + dir * 6,
                  stemX + 6.5,
                  stemTipY + dir * 12,
                )
                .stroke({ width: 1.6, color: primary, alpha: 0.92 });
              if (dur <= 0.3) {
                const y2 = stemTipY + dir * 6.5;
                glyphGraphic
                  .moveTo(stemX, y2)
                  .bezierCurveTo(
                    stemX + 3,
                    y2 + dir * 3,
                    stemX + 8.5,
                    y2 + dir * 6,
                    stemX + 6.5,
                    y2 + dir * 12,
                  )
                  .stroke({ width: 1.6, color: primary, alpha: 0.92 });
              }
            }
          }
        } else {
          // Minimalist engraved TAB fret numeral: clean dark cutout on string line + sharp numeral
          const w = note.fret >= 10 ? 20 : 15;
          glyphGraphic
            .roundRect(-w / 2, -8.5, w, 17, 4)
            .fill({ color: 0x0b0e14 });

          if (isTarget || status !== 'pending') {
            glyphGraphic
              .roundRect(-w / 2 - 2, -9.5, w + 4, 19, 5)
              .stroke({ width: 1.3, color: primary, alpha: isTarget ? 0.9 : 0.55 });
          }

          if (textLabel) {
            textLabel.visible = true;
            textLabel.text = String(note.fret);
            textLabel.style.fill = primary;
          }
        }
      };

      const buildScene = () => {
        const cfg = configRef.current;
        const w = app.screen.width;
        const isStaff = cfg.notationMode === 'staff';

        // 1. Static horizontal staff or 6-string TAB lines
        bgLinesLayer.clear();
        if (isStaff) {
          for (let i = 0; i < 5; i += 1) {
            const y = STAFF_TOP_Y + i * STAFF_LINE_GAP;
            bgLinesLayer
              .moveTo(0, y)
              .lineTo(w, y)
              .stroke({ width: 1, color: 0x262e3d, alpha: 0.95 });
          }
        } else {
          for (let s = 0; s < 6; s += 1) {
            const y = TAB_TOP_Y + s * TAB_LINE_GAP;
            bgLinesLayer
              .moveTo(0, y)
              .lineTo(w, y)
              .stroke({ width: s >= 3 ? 1.25 : 1, color: 0x232a38, alpha: 0.95 });
          }
        }

        // 2. Left Clef / TAB Legend Margin Mask
        leftMarginMask.clear();
        leftMarginMask
          .rect(0, 0, CLEF_MARGIN_W, CANVAS_HEIGHT)
          .fill({ color: 0x0b0e14, alpha: 0.94 });
        leftMarginMask
          .moveTo(CLEF_MARGIN_W, isStaff ? STAFF_TOP_Y - 8 : TAB_TOP_Y - 8)
          .lineTo(CLEF_MARGIN_W, isStaff ? STAFF_BOTTOM_Y + 8 : TAB_TOP_Y + TAB_LINE_GAP * 5 + 8)
          .stroke({ width: 1, color: 0x1e2533 });

        clefContainer.removeChildren().forEach((c) => c.destroy());
        if (isStaff) {
          const clefGlyph = new Text({
            text: '𝄞',
            style: {
              fill: 0x64748b,
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 54,
            },
          });
          clefGlyph.anchor.set(0.5, 0.5);
          clefGlyph.position.set(CLEF_MARGIN_W * 0.5, STAFF_TOP_Y + STAFF_LINE_GAP * 2 + 2);
          const sub8 = new Text({
            text: '8',
            style: {
              fill: 0x475569,
              fontFamily: 'Nunito, system-ui, sans-serif',
              fontSize: 10,
              fontWeight: '800',
            },
          });
          sub8.anchor.set(0.5, 0);
          sub8.position.set(CLEF_MARGIN_W * 0.5, STAFF_BOTTOM_Y + 11);
          clefContainer.addChild(clefGlyph);
          clefContainer.addChild(sub8);
        } else {
          const labels = ['e', 'B', 'G', 'D', 'A', 'E'];
          for (let s = 0; s < 6; s += 1) {
            const t = new Text({
              text: labels[s],
              style: {
                fill: 0x64748b,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 11,
                fontWeight: '700',
              },
            });
            t.anchor.set(0.5, 0.5);
            t.position.set(CLEF_MARGIN_W * 0.5, TAB_TOP_Y + s * TAB_LINE_GAP);
            clefContainer.addChild(t);
          }
        }

        // 3. World Barlines & Floating Chord Labels
        worldBarsLayer.clear();
        worldChordsContainer.removeChildren().forEach((c) => c.destroy());

        const lineTop = isStaff ? STAFF_TOP_Y : TAB_TOP_Y;
        const lineBot = isStaff ? STAFF_BOTTOM_Y : TAB_TOP_Y + TAB_LINE_GAP * 5;
        const barWidthPx = cfg.beatsPerBar * PX_PER_BEAT;

        for (let b = 0; b <= cfg.totalBars; b += 1) {
          const bx = b * barWidthPx;
          const inLoop =
            cfg.loopRange === 'all' ||
            (b + 1 >= cfg.loopRange.startBar && b + 1 <= cfg.loopRange.endBar);

          // Loop highlight tint behind looped bars
          if (
            cfg.practiceMode === 'loop' &&
            cfg.loopRange !== 'all' &&
            b < cfg.totalBars &&
            inLoop
          ) {
            worldBarsLayer
              .rect(bx, lineTop - 16, barWidthPx, lineBot - lineTop + 32)
              .fill({ color: cfg.accentColor, alpha: 0.04 });
          }

          worldBarsLayer
            .moveTo(bx, lineTop)
            .lineTo(bx, lineBot)
            .stroke({
              width: b === cfg.totalBars ? 2 : 1,
              color: 0x2c3547,
              alpha: 0.9,
            });

          if (b === cfg.totalBars) {
            worldBarsLayer
              .moveTo(bx - 4, lineTop)
              .lineTo(bx - 4, lineBot)
              .stroke({ width: 1, color: 0x2c3547, alpha: 0.9 });
          }

          if (b < cfg.totalBars) {
            // Subtle beat ticks along top hair-space
            for (let beat = 1; beat < cfg.beatsPerBar; beat += 1) {
              const tx = bx + beat * PX_PER_BEAT;
              worldBarsLayer
                .moveTo(tx, lineTop)
                .lineTo(tx, lineBot)
                .stroke({ width: 1, color: 0x161b26, alpha: 0.55 });
            }

            const numText = new Text({
              text: String(b + 1),
              style: {
                fill: 0x475569,
                fontFamily: 'Nunito, system-ui, sans-serif',
                fontSize: 10,
                fontWeight: '700',
              },
            });
            numText.position.set(bx + 6, 22);
            worldChordsContainer.addChild(numText);

            const chord = cfg.barChords[b];
            if (chord) {
              const chordText = new Text({
                text: chord,
                style: {
                  fill: 0xcbd5e1,
                  fontFamily: 'Nunito, system-ui, sans-serif',
                  fontSize: 13,
                  fontWeight: '800',
                },
              });
              chordText.position.set(bx + 22, 19);
              worldChordsContainer.addChild(chordText);
            }
          }
        }

        // 4. Build Pre-Allocated Note Display Objects
        worldNotesContainer.removeChildren().forEach((c) => c.destroy());
        builtNotes.length = 0;

        const seenBars = new Set<number>();
        for (let i = 0; i < cfg.notes.length; i += 1) {
          const note = cfg.notes[i];
          const isFirstInBar = !seenBars.has(note.bar);
          seenBars.add(note.bar);

          const worldX = (note.startBeat + 0.28) * PX_PER_BEAT;
          const midi = noteLabelToMidi(note.label) ?? 60;
          const staffInfo = midiToStaffStep(midi);

          const trueY = isStaff
            ? STAFF_BOTTOM_Y - (staffInfo.diatonicStep - BOTTOM_E3_STEP) * STAFF_HALF_STEP
            : TAB_TOP_Y + (note.stringNum - 1) * TAB_LINE_GAP;

          const hiddenY = isStaff
            ? STAFF_TOP_Y + STAFF_LINE_GAP * 2
            : trueY;

          const container = new Container();
          container.position.set(worldX, trueY);

          const sustainTail = new Graphics();
          const ledgerGraphic = new Graphics();
          const glyphGraphic = new Graphics();

          // Pre-draw static ledger lines for Staff notes outside the 5 lines
          if (isStaff) {
            const step = staffInfo.diatonicStep;
            if (step <= BOTTOM_E3_STEP - 2) {
              for (let s = BOTTOM_E3_STEP - 2; s >= step; s -= 2) {
                const ly = STAFF_BOTTOM_Y - (s - BOTTOM_E3_STEP) * STAFF_HALF_STEP - trueY;
                ledgerGraphic
                  .moveTo(-10, ly)
                  .lineTo(10, ly)
                  .stroke({ width: 1.2, color: 0x3b4659 });
              }
            } else if (step >= TOP_F4_STEP + 2) {
              for (let s = TOP_F4_STEP + 2; s <= step; s += 2) {
                const ly = STAFF_BOTTOM_Y - (s - BOTTOM_E3_STEP) * STAFF_HALF_STEP - trueY;
                ledgerGraphic
                  .moveTo(-10, ly)
                  .lineTo(10, ly)
                  .stroke({ width: 1.2, color: 0x3b4659 });
              }
            }
          }

          container.addChild(sustainTail);
          container.addChild(ledgerGraphic);
          container.addChild(glyphGraphic);

          let accidentalText: Text | null = null;
          if (isStaff && staffInfo.isSharp) {
            accidentalText = new Text({
              text: '♯',
              style: {
                fill: 0xe2e8f0,
                fontFamily: 'Georgia, system-ui, sans-serif',
                fontSize: 15,
                fontWeight: '700',
              },
            });
            accidentalText.anchor.set(1, 0.52);
            accidentalText.position.set(-9, 0);
            container.addChild(accidentalText);
          }

          let textLabel: Text | null = null;
          if (!isStaff) {
            textLabel = new Text({
              text: String(note.fret),
              style: {
                fill: 0xe2e8f0,
                fontFamily: 'Nunito, system-ui, sans-serif',
                fontSize: 12.5,
                fontWeight: '900',
              },
            });
            textLabel.anchor.set(0.5, 0.5);
            container.addChild(textLabel);
          }

          worldNotesContainer.addChild(container);

          const item: BuiltNoteGlyph = {
            note,
            isFirstInBar,
            worldX,
            trueY,
            hiddenY,
            container,
            sustainTail,
            ledgerGraphic,
            glyphGraphic,
            textLabel,
            accidentalText,
            lastStateKey: '',
            pulseAgeSec: 99,
            lastStatus: 'pending',
          };
          builtNotes.push(item);
        }
      };

      rebuildSceneRef.current = buildScene;
      buildScene();

      // Horizontal wheel / drag scrubbing when idle so user can inspect all 8 bars effortlessly
      const onWheel = (ev: WheelEvent) => {
        const m = motionRef.current;
        if (m.running || m.previewing) return;
        const delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
        if (Math.abs(delta) < 1) return;
        const maxBeat = Math.max(0, configRef.current.totalBars * configRef.current.beatsPerBar - 4);
        userScrubOffsetBeats = Math.max(
          0,
          Math.min(maxBeat, userScrubOffsetBeats + delta * 0.012),
        );
      };
      app.canvas.addEventListener('wheel', onWheel, { passive: true });

      const onResize = () => {
        const h = hostRef.current;
        if (!h || !appInstance) return;
        const nextW = Math.max(320, h.clientWidth);
        if (Math.abs(nextW - appInstance.screen.width) > 2) {
          appInstance.renderer.resize(nextW, CANVAS_HEIGHT);
          buildScene();
        }
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(host);

      // 120fps WebGL Ticker — ZERO allocations, ZERO React re-renders!
      const tick = () => {
        const cfg = configRef.current;
        const motion = motionRef.current;
        const statuses = noteStatusRef.current;
        const det = detectionRef.current;
        const dtSec = Math.min(0.05, app.ticker.deltaMS / 1000);
        const screenW = app.screen.width;
        const isStaff = cfg.notationMode === 'staff';

        const playheadScreenX = Math.max(
          CLEF_MARGIN_W + 68,
          Math.min(260, Math.round(screenW * 0.26)),
        );

        if (motion.running || motion.previewing) {
          userScrubOffsetBeats = 0;
        }

        const anchorBeat =
          motion.running || motion.previewing
            ? Math.max(0, motion.courseBeat)
            : motion.focusStartBeat + userScrubOffsetBeats;

        const targetWorldX = playheadScreenX - (anchorBeat + 0.28) * PX_PER_BEAT;
        if (!cameraInitialized || Math.abs(targetWorldX - cameraX) > PX_PER_BEAT * 6) {
          cameraX = targetWorldX;
          cameraInitialized = true;
        } else {
          const alpha = 1 - Math.exp(-dtSec * 15);
          cameraX += (targetWorldX - cameraX) * alpha;
        }
        worldContainer.x = cameraX;

        // Playhead hairline
        playheadLayer.clear();
        const lineTop = isStaff ? STAFF_TOP_Y - 22 : TAB_TOP_Y - 18;
        const lineBot = isStaff ? STAFF_BOTTOM_Y + 22 : TAB_TOP_Y + TAB_LINE_GAP * 5 + 18;
        const phColor =
          motion.shadowPhase === 'listen' ? 0x38bdf8 : cfg.accentColor;
        const phAlpha = motion.running || motion.previewing ? 0.85 : 0.3;

        playheadLayer
          .moveTo(playheadScreenX, lineTop)
          .lineTo(playheadScreenX, lineBot)
          .stroke({ width: 1.6, color: phColor, alpha: phAlpha });

        // Soft beat downbeat dot at top of playhead
        const beatFrac = ((motion.courseBeat % 1) + 1) % 1;
        const beatPulse =
          motion.running || motion.previewing ? Math.max(0, 1 - beatFrac * 3.2) : 0;
        playheadLayer
          .circle(playheadScreenX, lineTop - 4, 3 + beatPulse * 2.2)
          .fill({ color: phColor, alpha: 0.45 + beatPulse * 0.55 });

        // Count-In & Shadow Phase minimal typography
        if (motion.running && motion.inCountIn) {
          countInText.visible = true;
          countInText.text = String(motion.countInNumber);
          countInText.position.set(playheadScreenX + 54, 46);
          countInText.alpha = 0.9;
        } else {
          countInText.visible = false;
        }

        if (motion.running && motion.shadowPhase !== 'idle') {
          phaseBadgeText.visible = true;
          phaseBadgeText.text =
            motion.shadowPhase === 'listen' ? 'LISTEN' : 'YOUR TURN';
          phaseBadgeText.style.fill =
            motion.shadowPhase === 'listen' ? 0x38bdf8 : 0x1db954;
          phaseBadgeText.position.set(screenW - 22, 20);
        } else if (motion.previewing) {
          phaseBadgeText.visible = true;
          phaseBadgeText.text = 'PREVIEW';
          phaseBadgeText.style.fill = 0xfbbf24;
          phaseBadgeText.position.set(screenW - 22, 20);
        } else {
          phaseBadgeText.visible = false;
        }

        // Update Notes (only re-tessellate Graphics when state transitions!)
        let activeNoteObj: BuiltNoteGlyph | null = null;
        const shadowListen = motion.shadowPhase === 'listen';

        for (let i = 0; i < builtNotes.length; i += 1) {
          const item = builtNotes[i];
          const screenX = cameraX + item.worldX;

          // Cull offscreen notes cleanly for ultra-fast GPU draw
          if (screenX < CLEF_MARGIN_W - 40 || screenX > screenW + 80) {
            item.container.visible = false;
            continue;
          }
          item.container.visible = true;

          // Soft fade as notes pass behind the left clef margin
          const edgeFade = Math.max(0, Math.min(1, (screenX - CLEF_MARGIN_W) / 28));
          const status = statuses[item.note.id] ?? 'pending';
          const isTarget =
            (motion.running || motion.previewing) &&
            !motion.inCountIn &&
            motion.activeTargetNoteId === item.note.id;

          if (isTarget) activeNoteObj = item;

          const hidden = shouldHideNote(
            item.note,
            item.isFirstInBar,
            cfg.practiceMode,
            cfg.hiddenDifficulty,
            status,
            motion.previewing,
          );

          item.ledgerGraphic.visible = !hidden;

          // Smooth Y reveal when hidden note gets scored
          const goalY = hidden ? item.hiddenY : item.trueY;
          item.container.y += (goalY - item.container.y) * Math.min(1, dtSec * 18);

          if (status !== item.lastStatus) {
            if (status === 'hit' || status === 'miss') {
              item.pulseAgeSec = 0;
            }
            item.lastStatus = status;
          }

          if (item.pulseAgeSec < 0.32) {
            item.pulseAgeSec += dtSec;
            const p = item.pulseAgeSec / 0.32;
            const bump = 1 + Math.sin(p * Math.PI) * 0.24;
            item.glyphGraphic.scale.set(bump);
          } else if (item.glyphGraphic.scale.x !== 1) {
            item.glyphGraphic.scale.set(1);
          }

          const stateKey = `${status}:${isTarget ? 1 : 0}:${hidden ? 1 : 0}:${cfg.accentColor}:${shadowListen ? 1 : 0}`;
          if (stateKey !== item.lastStateKey) {
            item.lastStateKey = stateKey;
            drawNoteAppearance(
              item,
              status,
              isTarget,
              hidden,
              cfg.accentColor,
              isStaff,
              shadowListen,
            );
          }

          // Past played notes dim subtly so upcoming phrase pops effortlessly
          const pastFade =
            (motion.running || motion.previewing) && screenX < playheadScreenX - 24
              ? 0.55
              : 1;
          item.container.alpha = edgeFade * pastFade;
        }

        // Live Pitch Indicator on Playhead (120fps direct ref read!)
        livePitchLayer.clear();
        if (det.hz != null && det.confidence >= 0.55) {
          const rawMidi = frequencyToMidi(det.hz) - det.tuningOffsetCents / 100;
          if (Number.isFinite(rawMidi)) {
            smoothLiveMidi =
              smoothLiveMidi == null
                ? rawMidi
                : smoothLiveMidi + (rawMidi - smoothLiveMidi) * Math.min(1, dtSec * 22);

            let isLockedMatch = false;
            let centsErr = 0;
            if (activeNoteObj) {
              const targetHz = noteLabelToFrequency(activeNoteObj.note.label);
              if (targetHz != null) {
                centsErr = centsBetween(det.hz, targetHz) - det.tuningOffsetCents;
                isLockedMatch = Math.abs(centsErr) <= 45;
              }
            }

            const orbColor = isLockedMatch ? 0x1db954 : 0x60a5fa;
            let orbY: number;
            if (isStaff) {
              orbY = Math.max(46, Math.min(CANVAS_HEIGHT - 28, continuousMidiToStaffY(smoothLiveMidi)));
            } else if (activeNoteObj) {
              const clampedCents = Math.max(-60, Math.min(60, centsErr));
              orbY = activeNoteObj.trueY - (clampedCents / 60) * 16;
            } else {
              orbY = TAB_TOP_Y + TAB_LINE_GAP * 2.5;
            }

            livePitchLayer
              .circle(playheadScreenX, orbY, isLockedMatch ? 6.5 : 5)
              .fill({ color: orbColor, alpha: 0.25 });
            livePitchLayer
              .circle(playheadScreenX, orbY, 3.6)
              .fill({ color: orbColor, alpha: 0.95 });
          }
        } else {
          smoothLiveMidi = null;
        }

        // Update minimal bottom bar-scrubber fill directly via DOM style (zero React renders!)
        const barEls = barProgressRefs.current;
        for (let b = 0; b < cfg.totalBars; b += 1) {
          const el = barEls[b];
          if (!el) continue;
          const bStart = b * cfg.beatsPerBar;
          const bEnd = bStart + cfg.beatsPerBar;
          let pct = 0;
          if (motion.running || motion.previewing) {
            if (motion.courseBeat >= bEnd) pct = 100;
            else if (motion.courseBeat > bStart) {
              pct = ((motion.courseBeat - bStart) / cfg.beatsPerBar) * 100;
            }
          }
          el.style.width = `${pct.toFixed(1)}%`;
        }
      };

      app.ticker.add(tick);

      return () => {
        ro.disconnect();
        app.canvas.removeEventListener('wheel', onWheel);
      };
    };

    let cleanupListeners: (() => void) | undefined;
    void initPixi().then((fn) => {
      cleanupListeners = fn;
    });

    return () => {
      disposed = true;
      rebuildSceneRef.current = null;
      cleanupListeners?.();
      if (appInstance) {
        appInstance.destroy(true);
        appInstance = null;
      }
    };
    // Only mount WebGL once! Prop changes trigger lightweight `rebuildSceneRef.current()` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild display list cleanly when course, Staff/TAB switch, or loop highlight changes
  useEffect(() => {
    rebuildSceneRef.current?.();
  }, [notes, barChords, totalBars, beatsPerBar, notationMode, loopRange, accentHex]);

  return (
    <div className="relative rounded-2xl bg-[#0b0e14] border border-white/[0.07] overflow-hidden">
      {/* Pixi.js v8 WebGL Stage */}
      <div ref={hostRef} className="w-full h-[300px]" />

      {/* Whisper-minimal Bar Timeline Scrubber along bottom edge */}
      <div className="px-4 py-2 border-t border-white/[0.05] flex items-center gap-1.5">
        {Array.from({ length: totalBars }, (_, idx) => {
          const barNum = idx + 1;
          const isLooped =
            practiceMode === 'loop' &&
            loopRange !== 'all' &&
            barNum >= loopRange.startBar &&
            barNum <= loopRange.endBar;

          return (
            <button
              key={barNum}
              type="button"
              onClick={() => onSelectBar?.(barNum)}
              title={
                practiceMode === 'loop'
                  ? `Click to loop Bar ${barNum} (click again for all bars)`
                  : `Jump to Bar ${barNum}`
              }
              className={`group flex-1 flex flex-col gap-1 py-1 text-left transition-opacity ${
                practiceMode === 'loop' && loopRange !== 'all' && !isLooped
                  ? 'opacity-30 hover:opacity-70'
                  : 'opacity-90 hover:opacity-100'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-bold tracking-wider">
                <span className={isLooped ? 'text-white' : 'text-sp-text-muted'}>
                  {barNum}
                </span>
                {barChords[idx] && (
                  <span className="text-[10px] text-white/30 group-hover:text-white/60 truncate">
                    {barChords[idx]}
                  </span>
                )}
              </div>
              <div className="h-[3px] w-full rounded-full bg-white/[0.07] overflow-hidden">
                <div
                  ref={(el) => {
                    barProgressRefs.current[idx] = el;
                  }}
                  className="h-full transition-none"
                  style={{
                    width: '0%',
                    backgroundColor: isLooped ? '#ffffff' : accentHex,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
