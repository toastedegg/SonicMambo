# SonicMambo

Real-time guitar practice & ear-training web app: connect via audio interface or mic, get low-latency monophonic pitch + note-event detection, and play along on an interactive musical staff.

## Stack

- **React 18** + **Vite 7** + **TypeScript** (`strict`)
- **Tailwind CSS**
- **Pixi.js v8** — hardware-accelerated musical staff (`LessonStaffPixi.tsx`)
- **Pitchy (`Autocorrelator`) + `fft.js` + Custom Guitar DSP (`src/dsp/`)** — 60 Hz Butterworth high-pass filter, lag-bounded McLeod Pitch Method (MPM, 70–1400 Hz) with Goertzel multi-harmonic (`m=2..8`) subharmonic & wound-string 2nd-harmonic verification, semitone median smoothing with jump reset, session tuning-offset compensation, spectral-flux/legato onset segmentation, and cents-based hold scoring.
- **Web Audio API** — raw guitar capture (`echoCancellation: false, noiseSuppression: false, autoGainControl: false`), `BiquadFilterNode`, `AnalyserNode`.

## Setup & Commands

```bash
npm install
npm run dev       # Start Vite dev server (use localhost or HTTPS for mic access)
npm test          # Run unit + real-audio DSP regression tests (Node native test runner)
npm run eval      # Run full offline benchmark against traninig_set/t1 & t2 + synthetic suite
npm run lint      # Run ESLint v9 flat config check
npm run build     # Type-check (tsc -b) + production Vite build
```

## Offline Benchmark (`traninig_set`)

`npm run eval` decodes `traninig_set/t1/jam4jimi.mp4` (146 BPM Hendrix R&B lead) and `traninig_set/t2/ejitjtmat-001-lg_audio.mp4` (112 BPM 16th-note Country Pickin' lead) and writes `reports/training-set-benchmark.md`:

- **Jam 4 Jimi (107 notes):** Legacy M0 `19.6%` → Tuned MPM **`100.0%` (`107 / 107`)**
- **Country Pickin' (218 notes):** Legacy M0 `11.5%` → Tuned MPM **`100.0%` (`218 / 218`)**
- **Production JS bundle:** reduced from `3,005 kB` (`935 kB` gzip with Essentia WASM) to **`473 kB`** (`149 kB` gzip).
