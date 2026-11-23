# 06 · Riso Circuit Stage (Unified Risograph Soul × Engraved Contour Staff × 3D Perspective Neck)

- **Branch:** `design/06-riso-circuit-stage` (branched from `design/03-neo-groove-arcade`)
- **Synthesis Architecture:**
  - **Visual Skin & Tactile Soul (`03`):** Warm Risograph paper `#FFFBF0`, recessed cream `#F4ECDC`, `2.5px` `#121212` ink strokes, 3D pressable medallions (`border-b-[6px]`), and the clickable **3-Pedal Stompbox Rack** (`Twin Clean / Tweed Crunch / Plexi Lead`).
  - **Tier A — Engraved Contour & Vanishing Score (`04` + `01`):** Stationary 4-bar phrase window (`B1–4 | B5–8`), clickable measure chord pills (`M1..M4 ↻`), 5-line treble staff with **Fret-Inside-Notehead** pills, smooth `#2B59FF` melodic contour ribbon, 4-Pass Vanishing Ink (`100% INK → 55% GHOST → 25% CONTOUR → 0% EAR`), zero-jank SVG playhead (`ref` transform), and strict 4-state semantic color + shape accessibility (zero rainbow string encoding).
  - **Tier B — 1:1 Perspective Luthiery Neck (`05` re-inked):** 22-fret logarithmic perspective guitar neck (Frets `0–17`) rendered in roasted rosewood (`#231E1B`) and bone inlays (`#F5E6CC`), highlighting only the active `#D8FF2E` string/fret, curved `#2B59FF` Spring-Vector Sightline Arc to the next target, and direct-on-string `#FF3B7F` bleed feedback (`× MUTE G3`).
- **Anti-Bloat & Sound-First Gates Met:**
  - Eliminated left course-catalog `Sidebar` (merged into single-row `56px` `TopBar` with auto-dimming during live play) and right-hand 3-card essay column.
  - **`01-roadmap.png` (`?demo=1`):** Full-canvas Risograph Act poster scene connected by a `1/4"` TS guitar patch cable with metal plugs & animated signal flow, hover 2-bar audio riff preview (`BackingTransport`), perforated Concert Ticket Stub popover, and bottom-left `BAND TAPE` stem unlock pills (`≤ 35` words total).
  - **`02-stage-play.png` (`?demo=1&view=stage`):** Two-Tier Harmonized Soundstage with **0 prose sentences**, **0 Mambo Buddy chat boxes**, and **0 `TIP:` footers**.
  - **`03-interaction-detail.png` (`?demo=1&view=detail`):** Re-materialized 4-bar score with continuous played pitch & timing pocket forensic ribbon + 3 pinned curve callouts (`SLIDE 12→7 · +2¢`, `LAYBACK -11ms`, `VIB 5.2Hz`), 6-word Mambo Buddy celebration stamp, and 3-Pedal Stompbox Rack.
- **Verification:** `npm test && npm run lint && npm run build` passed (exit 0).
