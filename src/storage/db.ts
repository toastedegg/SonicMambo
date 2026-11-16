import type { LiveCapturedTakeManifest } from '../dsp/qualityJudge.ts';
import type { NoteAttemptResult } from '../types/lesson.ts';

export type SessionModeKind =
  | 'lesson'
  | 'course'
  | 'jazz'
  | 'sensei'
  | 'loop-doctor'
  | 'groove'
  | 'flow'
  | 'shadow'
  | 'fretboard'
  | 'intonation'
  | 'warmup';

export interface PracticeSessionRecord {
  id: string;
  mode: SessionModeKind;
  title: string;
  courseSeed?: string;
  startedAtIso: string;
  durationSec: number;
  tempoBpm: number;
  hits: number;
  misses: number;
  accuracy: number;
  meanTimingOffsetMs: number | null;
  meanCentsError: number | null;
  noteResults: NoteAttemptResult[];
  notesSummary?: string;
  extraMetrics?: Record<string, number | string | boolean | null>;
}

export interface PassageStatRecord {
  passageId: string;
  title: string;
  lessonId: string;
  notes: Array<{ id: string; label: string; startBeat: number; durationBeats: number }>;
  targetBpm: number;
  currentBpm: number;
  cleanStreak: number;
  slipStreak: number;
  errorScore: number;
  intervalDays: number;
  nextDueIso: string;
  graduated: boolean;
  updatedAtIso: string;
}

export interface LiveTakeBlobRecord {
  takeId: string;
  manifest: LiveCapturedTakeManifest;
  wavBytes: number[]; // compact JSON-serializable byte array for IndexedDB & backup
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

const DB_NAME = 'sonicmambo-db';
const DB_VERSION = 1;
const STORE_NAMES = ['sessions', 'passageStats', 'liveTakes', 'settings'] as const;
type StoreName = (typeof STORE_NAMES)[number];

// In-memory fallback for Node tests, SSR, or restricted private-browsing contexts.
const memoryStores: Record<StoreName, Map<string, unknown>> = {
  sessions: new Map(),
  passageStats: new Map(),
  liveTakes: new Map(),
  settings: new Map(),
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('passageStats')) {
          db.createObjectStore('passageStats', { keyPath: 'passageId' });
        }
        if (!db.objectStoreNames.contains('liveTakes')) {
          db.createObjectStore('liveTakes', { keyPath: 'takeId' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

function keyForRecord(store: StoreName, value: unknown): string {
  const rec = value as Record<string, string>;
  switch (store) {
    case 'sessions':
      return rec.id;
    case 'passageStats':
      return rec.passageId;
    case 'liveTakes':
      return rec.takeId;
    case 'settings':
      return rec.key;
  }
}

async function putItem<T>(store: StoreName, value: T): Promise<void> {
  const db = await openDb();
  if (!db) {
    memoryStores[store].set(keyForRecord(store, value), value);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllItems<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  if (!db) {
    return Array.from(memoryStores[store].values()) as T[];
  }
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function getItem<T>(store: StoreName, key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) {
    return (memoryStores[store].get(key) as T | undefined) ?? null;
  }
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function clearStore(store: StoreName): Promise<void> {
  const db = await openDb();
  if (!db) {
    memoryStores[store].clear();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function savePracticeSession(session: PracticeSessionRecord): Promise<void> {
  await putItem('sessions', session);
}

export async function listPracticeSessions(): Promise<PracticeSessionRecord[]> {
  const all = await getAllItems<PracticeSessionRecord>('sessions');
  return all.sort((a, b) => b.startedAtIso.localeCompare(a.startedAtIso));
}

export async function savePassageStat(stat: PassageStatRecord): Promise<void> {
  await putItem('passageStats', stat);
}

export async function listPassageStats(): Promise<PassageStatRecord[]> {
  return getAllItems<PassageStatRecord>('passageStats');
}

export async function saveLiveTake(take: LiveTakeBlobRecord): Promise<void> {
  await putItem('liveTakes', take);
}

export async function listLiveTakes(): Promise<LiveTakeBlobRecord[]> {
  return getAllItems<LiveTakeBlobRecord>('liveTakes');
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await putItem<SettingRecord>('settings', { key, value });
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const rec = await getItem<SettingRecord>('settings', key);
  return rec ? (rec.value as T) : null;
}

export async function clearAllStores(): Promise<void> {
  await Promise.all(STORE_NAMES.map((s) => clearStore(s)));
}

/**
 * Computes weekly practice minutes (rolling last 7 days) + active practice days.
 * Follows the gamification principle: consistency over perfection (no streak punishment).
 */
export function computeWeeklyPracticeSummary(
  sessions: readonly PracticeSessionRecord[],
  nowMs: number = Date.now(),
): {
  weeklyMinutes: number;
  sessionsLast7Days: number;
  activeDaysLast7Days: number;
  totalSessions: number;
} {
  const sevenDaysAgo = nowMs - 7 * 24 * 60 * 60 * 1000;
  let totalSec = 0;
  let sessionsLast7Days = 0;
  const dayKeys = new Set<string>();

  for (const s of sessions) {
    const ts = Date.parse(s.startedAtIso);
    if (!Number.isFinite(ts) || ts < sevenDaysAgo || ts > nowMs + 60_000) continue;
    sessionsLast7Days += 1;
    totalSec += Math.max(0, s.durationSec);
    dayKeys.add(new Date(ts).toISOString().slice(0, 10));
  }

  return {
    weeklyMinutes: Math.round((totalSec / 60) * 10) / 10,
    sessionsLast7Days,
    activeDaysLast7Days: dayKeys.size,
    totalSessions: sessions.length,
  };
}
