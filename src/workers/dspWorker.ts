import { createDetectorBackend, type DetectorBackendKind } from '../dsp/mlBackends.ts';
import { DspPipeline } from '../dsp/pipeline.ts';
import type { NoteEvent, PitchFrame } from '../dsp/types.ts';

type MainToWorkerMessage =
  | { type: 'init'; sampleRate: number; rmsThreshold: number; backend?: DetectorBackendKind }
  | { type: 'config'; rmsThreshold?: number; recordRaw?: boolean; backend?: DetectorBackendKind }
  | { type: 'reset' }
  | { type: 'flush'; endTimeMs?: number };

type WorkletHopMessage = {
  type: 'hop';
  samples: Float32Array;
  audioTimeSec: number;
};

interface WorkerScopeLike {
  onmessage: ((event: MessageEvent<MainToWorkerMessage>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}

const workerSelf = self as unknown as WorkerScopeLike;

let pipeline: DspPipeline | null = null;
let workletPort: MessagePort | null = null;
let recordRaw = false;
let lastFramePostMs = -Infinity;
let lastPostedLabel: string | null = null;

// Accumulate 4x 256-sample hops = 1024 samples before sending raw audio back to main thread.
const RAW_BATCH_SIZE = 1024;
let rawBatch = new Float32Array(RAW_BATCH_SIZE);
let rawBatchWrite = 0;

function postFrame(frame: PitchFrame, tuningOffsetCents: number): void {
  const now = frame.timeMs;
  const labelChanged = frame.label !== lastPostedLabel;
  if (!labelChanged && now - lastFramePostMs < 11) {
    return;
  }
  lastFramePostMs = now;
  lastPostedLabel = frame.label;
  workerSelf.postMessage({
    type: 'frame',
    frame,
    tuningOffsetCents,
  });
}

function postNoteEvent(note: NoteEvent): void {
  workerSelf.postMessage({
    type: 'note-event',
    note,
  });
}

function handleHop(samples: Float32Array, audioTimeSec: number): void {
  if (!pipeline) return;

  if (recordRaw) {
    let offset = 0;
    while (offset < samples.length) {
      const space = RAW_BATCH_SIZE - rawBatchWrite;
      const copyCount = Math.min(space, samples.length - offset);
      rawBatch.set(samples.subarray(offset, offset + copyCount), rawBatchWrite);
      rawBatchWrite += copyCount;
      offset += copyCount;

      if (rawBatchWrite >= RAW_BATCH_SIZE) {
        const out = rawBatch;
        rawBatch = new Float32Array(RAW_BATCH_SIZE);
        rawBatchWrite = 0;
        workerSelf.postMessage({ type: 'raw-chunk', samples: out }, [out.buffer]);
      }
    }
  }

  const { frames, noteEvents } = pipeline.pushSamples(samples, audioTimeSec);
  const tuningOffsetCents = pipeline.getTuningOffsetCents();

  for (let i = 0; i < noteEvents.length; i += 1) {
    postNoteEvent(noteEvents[i]);
  }
  for (let i = 0; i < frames.length; i += 1) {
    postFrame(frames[i], tuningOffsetCents);
  }
}

let currentRmsThreshold = 0.008;

workerSelf.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'init') {
    currentRmsThreshold = msg.rmsThreshold;
    pipeline = new DspPipeline({
      sampleRate: msg.sampleRate,
      frameSize: 2048,
      hopSize: 256,
      rmsThreshold: msg.rmsThreshold,
      detector: msg.backend
        ? createDetectorBackend(msg.backend, msg.rmsThreshold)
        : undefined,
    });
    lastFramePostMs = -Infinity;
    lastPostedLabel = null;

    if (event.ports && event.ports[0]) {
      workletPort?.close();
      workletPort = event.ports[0];
      workletPort.onmessage = (portEvent: MessageEvent<WorkletHopMessage>) => {
        const hopMsg = portEvent.data;
        if (hopMsg && hopMsg.type === 'hop') {
          handleHop(hopMsg.samples, hopMsg.audioTimeSec);
        }
      };
    }
    workerSelf.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'config') {
    if (typeof msg.rmsThreshold === 'number' && pipeline) {
      currentRmsThreshold = msg.rmsThreshold;
      pipeline.setRmsThreshold(msg.rmsThreshold);
    }
    if (msg.backend && pipeline) {
      pipeline.setDetector(createDetectorBackend(msg.backend, currentRmsThreshold));
    }
    if (typeof msg.recordRaw === 'boolean') {
      recordRaw = msg.recordRaw;
      rawBatchWrite = 0;
    }
    return;
  }

  if (msg.type === 'reset') {
    pipeline?.reset();
    lastFramePostMs = -Infinity;
    lastPostedLabel = null;
    rawBatchWrite = 0;
    return;
  }

  if (msg.type === 'flush') {
    const flushed = pipeline?.flush(msg.endTimeMs);
    if (flushed) postNoteEvent(flushed);
  }
};
