import { useEffect, useRef } from 'react';
import { Application, Graphics, Text } from 'pixi.js';
import type { LessonTimelineNote } from '../types/lesson';

interface LessonStaffPixiProps {
  notes: LessonTimelineNote[];
  currentTimeMs: number;
  durationMs: number;
  detectedNoteLabel: string | null;
  width?: number;
  height?: number;
}

const COLORS = {
  staff: 0xd1d5db,
  pending: 0x334155,
  hit: 0x58cc02,
  miss: 0xff4b4b,
  bar: 0x1cb0f6,
  text: 0x64748b,
  detected: 0xff9500,
};

const LETTER_STEP: Record<string, number> = {
  C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6,
};

function noteToDiatonic(label: string): number {
  const m = /^([A-G])(#?)(-?\d)$/.exec(label.trim());
  if (!m) return 23;
  return Number(m[3]) * 7 + LETTER_STEP[m[1]];
}

const BOTTOM_LINE = noteToDiatonic('E3');
const TOP_LINE = BOTTOM_LINE + 8;

export function LessonStaffPixi({
  notes,
  currentTimeMs,
  durationMs,
  detectedNoteLabel,
  width = 760,
  height = 280,
}: LessonStaffPixiProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      const host = hostRef.current;
      if (!host) return;

      const app = new Application();
      await app.init({
        width,
        height,
        antialias: true,
        backgroundAlpha: 0,
      });
      if (cancelled) {
        app.destroy(true);
        return;
      }

      host.innerHTML = '';
      host.appendChild(app.canvas);
      appRef.current = app;
    };

    void setup();

    return () => {
      cancelled = true;
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
    };
  }, [height, width]);

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;

    app.stage.removeChildren();

    const left = 64;
    const right = width - 36;
    const topLineY = 72;
    const lineGap = 18;
    const staffBottom = topLineY + lineGap * 4;
    const trackWidth = right - left;
    const safeDuration = Math.max(durationMs, 1);
    const clampedTime = Math.min(Math.max(currentTimeMs, 0), safeDuration);

    const stepHeight = lineGap / 2;
    const toX = (timeMs: number) => left + (timeMs / safeDuration) * trackWidth;
    const toY = (noteLabel: string) => {
      const pos = noteToDiatonic(noteLabel);
      return staffBottom - (pos - BOTTOM_LINE) * stepHeight;
    };

    const staff = new Graphics();
    for (let i = 0; i < 5; i += 1) {
      const y = staffBottom - i * lineGap;
      staff
        .moveTo(left, y)
        .lineTo(right, y)
        .stroke({ width: 2, color: COLORS.staff, alpha: 0.9 });
    }
    app.stage.addChild(staff);

    const ledgerHW = 14;

    notes.forEach((note) => {
      const x = toX(note.startMs + note.durationMs * 0.5);
      const y = toY(note.label);
      const pos = noteToDiatonic(note.label);
      const noteColor =
        note.status === 'hit'
          ? COLORS.hit
          : note.status === 'miss'
            ? COLORS.miss
            : COLORS.pending;

      const ledgerGfx = new Graphics();
      if (pos < BOTTOM_LINE) {
        for (let lp = BOTTOM_LINE - 2; lp >= pos; lp -= 2) {
          const ly = staffBottom - (lp - BOTTOM_LINE) * stepHeight;
          ledgerGfx
            .moveTo(x - ledgerHW, ly)
            .lineTo(x + ledgerHW, ly)
            .stroke({ width: 2, color: COLORS.staff, alpha: 0.9 });
        }
        app.stage.addChild(ledgerGfx);
      } else if (pos > TOP_LINE) {
        for (let lp = TOP_LINE + 2; lp <= pos; lp += 2) {
          const ly = staffBottom - (lp - BOTTOM_LINE) * stepHeight;
          ledgerGfx
            .moveTo(x - ledgerHW, ly)
            .lineTo(x + ledgerHW, ly)
            .stroke({ width: 2, color: COLORS.staff, alpha: 0.9 });
        }
        app.stage.addChild(ledgerGfx);
      }

      const noteHead = new Graphics();
      noteHead
        .ellipse(x, y, 10, 7)
        .fill({ color: noteColor, alpha: 0.95 })
        .stroke({ width: 1.5, color: 0x0f172a, alpha: 0.25 });
      noteHead
        .moveTo(x + 10, y)
        .lineTo(x + 10, y - 26)
        .stroke({ width: 2, color: noteColor, alpha: 0.95 });
      app.stage.addChild(noteHead);

      const label = new Text({
        text: note.label,
        style: {
          fill: COLORS.text,
          fontFamily: 'Nunito, system-ui, sans-serif',
          fontSize: 13,
          fontWeight: '700',
        },
      });
      label.x = x - label.width / 2;
      label.y = staffBottom + 14;
      app.stage.addChild(label);
    });

    if (detectedNoteLabel) {
      const pitchY = toY(detectedNoteLabel);
      const pitchLine = new Graphics();
      pitchLine
        .moveTo(left, pitchY)
        .lineTo(right, pitchY)
        .stroke({ width: 2, color: COLORS.detected, alpha: 0.55 });
      app.stage.addChild(pitchLine);

      const pitchLabel = new Text({
        text: detectedNoteLabel,
        style: {
          fill: COLORS.detected,
          fontFamily: 'Nunito, system-ui, sans-serif',
          fontSize: 12,
          fontWeight: '700',
        },
      });
      pitchLabel.x = left - pitchLabel.width - 6;
      pitchLabel.y = pitchY - pitchLabel.height / 2;
      app.stage.addChild(pitchLabel);
    }

    const barX = toX(clampedTime);
    const playhead = new Graphics();
    playhead
      .moveTo(barX, topLineY - 24)
      .lineTo(barX, staffBottom + 38)
      .stroke({ width: 3, color: COLORS.bar, alpha: 0.95 });
    app.stage.addChild(playhead);
  }, [currentTimeMs, detectedNoteLabel, durationMs, height, notes, width]);

  return (
    <div className="w-full overflow-hidden rounded-2xl bg-white border border-brand-gray-dark/40 shadow-sm">
      <div ref={hostRef} />
    </div>
  );
}
