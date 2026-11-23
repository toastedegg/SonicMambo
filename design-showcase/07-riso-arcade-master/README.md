# 07 · Riso Arcade Master (Best-of-All-Worlds Single-Focus Stage)

- **Branch:** `design/07-riso-arcade-master` (branched from `design/06-riso-circuit-stage`)
- **Core Product Architecture — One Calm Stage, Three World-Class Single-Focus Lenses:**
  - **Strict 3 Horizontal Strata (`CourseStageView.tsx`):** Eliminated stacked double headers and vertically stacked competing views. Every stage screen renders **ONE unified `56px` Stage Header** (with `[ 🕹️ ARCADE | 🎼 STAFF+TAB | 🎸 3D NECK ]` single-focus switcher, live pitch reticle, flow stamp, and `AMP` / `MIC ON` LEDs), **ONE generous Full-Stage Canvas**, and **ONE compact `58px` Bottom Transport Bar** (`0` Mambo Buddy chat boxes, `0` `TIP:` footers).
  - **Lens 1 — Upgraded `🕹️ ARCADE` 6-String Riff Highway (`NeoArcadeStage.tsx`, Default Play Lens):** Restored from `design/03-neo-groove-arcade` with *Rocksmith*-style 6-string peripheral color reflex and proportional sustain bricks, upgraded with:
    1. Zero duplicate black inner telemetry strip & zero bottom `TIP:` bar (`LANE_HEIGHT = 82px`).
    2. Zero `"2 HOL"` truncation: compact bricks (`< 96px`) show only oversized `17px` bold fret digits; wide bricks show fret + sustain track + spacious note label.
    3. Left-of-Gate visual settling: already-hit notes to the left of the `PLAY` gate settle softly to `42%` opacity with crisp `✓` badges so the player's eye locks effortlessly onto the active gate + upcoming riff.
    4. Deleted dashed `"BASS Em7"` background clutter pills; smooth `60/120fps` `translate3d` scrolling driven directly via `trackRef`.
  - **Lens 2 — Coupled 5-Line Staff + Classical 6-Line Guitar TAB (`RisoEngravedScore.tsx`):** Restored `04-monolith-jazz` copperplate engraving discipline on `#FFFBF0` Risograph paper—tilted solid oval noteheads, `1.25px` stems, smooth `#2B59FF` melodic contour arc, classical slide `/`, vibrato `~~~`, and slur `⌒` marks (zero fat capsules inside the staff), vertically aligned beat-for-beat with frameless print TAB digits where only the active target wears the `#D8FF2E` badge, plus 4-Pass Vanishing Ink (`100% · 55% · 25% · 0%`).
  - **Lens 3 — De-cluttered Full-Stage 3D Perspective Neck (`RisoPerspectiveNeck.tsx`):** Roasted-rosewood 1:1 tapered neck (`Frets 0–17`) with bone inlays and strict **2-dot focus** (`Current #D8FF2E` → `Next #2B59FF` connected by a curved Spring-Vector Sightline Arc; zero scattered grey ghost dots, zero unprompted pink bleed laser).
  - **Roadmap (`CourseRoadmapView.tsx`):** 100% stroke-free (`stroke="none"`) 2-tone atmospheric Risograph horizon washes (`#F3EBD9` & `#E9EEF8`), circular 3D stage medallions (`84×84px`) wired by `1/4"` braided guitar patch cables, frameless labels + 3 plectrum stars, hover 2-bar audio preview, and perforated Concert Ticket Stub Popover.
  - **Post-Take Forensic Review & Compact Stompboxes (`?demo=1&view=detail`):** Coupled Staff + 6-Line TAB overlaid with continuous `#FF3B7F` played pitch curve, `#2B59FF` timing pocket envelope, and 3 delicate `1px` hairline pin callouts (`01 · SLIDE 12→7 +2¢`, `02 · -11ms POCKET`, `03 · VIB 5.2Hz`), paired with a compact `≤ 215px` muscular 3-Pedal Stompbox Rack (`42×42px` rotary knobs) & Backing Groove mixer.
- **Showcase Captures (`1440×900 @2x`):**
  - `01-roadmap.png` (`?demo=1`)
  - `02-stage-play.png` (`?demo=1&view=stage`)
  - `03-interaction-detail.png` (`?demo=1&view=detail`)
  - `04-stage-staff.png` (`?demo=1&view=staff`)
  - `05-stage-neck.png` (`?demo=1&view=neck`)
- **Verification:** `npm test && npm run lint && npm run build` passed (exit 0, 0 ESLint errors/warnings).
