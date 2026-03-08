# SonicMambo

Ear-training MVP for guitarists: play a target note, get real-time pitch detection and match feedback.

## Stack

- **React 18** + **Vite** + **TypeScript**
- **Tailwind CSS**
- **Meyda.js** – RMS/loudness
- **Pitchfinder** (AMDF) – guitar pitch detection
- **Web Audio API** – `AudioContext`, `AnalyserNode`, microphone

## Setup

```bash
npm install
npm run dev
```

Open the URL shown (e.g. `http://localhost:5173`). Use **HTTPS or localhost** so the mic works.

## Usage

1. Click **Start Lesson** (grants mic access and starts the audio engine).
2. Read the **Target note** (e.g. “Play an E2”).
3. Play that note on your guitar; **Detected note** updates in real time.
4. Green = match, red = keep trying. Use **New target note** to pick another.

## Project layout

- `src/hooks/useAudioEngine.ts` – AudioContext, mic stream, Meyda RMS, Pitchfinder AMDF, frequency→note, cleanup on unmount.
- `src/utils/noteFromFrequency.ts` – Hz → note name (e.g. 440 → A4).
- `src/types/audio.ts` – Interfaces for audio state and config.
- `src/App.tsx` – UI: Start Lesson, target/detected note, match indicator.

## Build

```bash
npm run build
npm run preview
```
