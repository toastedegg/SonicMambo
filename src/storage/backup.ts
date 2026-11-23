import {
  clearAllStores,
  listLiveTakes,
  listPassageStats,
  listPracticeSessions,
  saveLiveTake,
  savePassageStat,
  savePracticeSession,
  saveSetting,
  type LiveTakeBlobRecord,
  type PassageStatRecord,
  type PracticeSessionRecord,
} from './db.ts';

export interface SonicMamboBackupPayload {
  version: 1;
  exportedAtIso: string;
  localStorage: Record<string, string>;
  sessions: PracticeSessionRecord[];
  passageStats: PassageStatRecord[];
  liveTakes: LiveTakeBlobRecord[];
}

const LOCAL_STORAGE_KEYS = [
  'sonicmambo:onboarded',
  'sonicmambo:calibration',
  'sonicmambo:inputProfile',
  'sonicmambo:audioOutputMode',
  'sonicmambo:detectorBackend',
  'sonicmambo:analyticsOptIn',
] as const;

export async function exportAllDataJson(): Promise<string> {
  const lsSnapshot: Record<string, string> = {};
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      for (const key of LOCAL_STORAGE_KEYS) {
        const val = window.localStorage.getItem(key);
        if (val != null) lsSnapshot[key] = val;
      }
    }
  } catch {
    // ignore
  }

  const [sessions, passageStats, liveTakes] = await Promise.all([
    listPracticeSessions(),
    listPassageStats(),
    listLiveTakes(),
  ]);

  const payload: SonicMamboBackupPayload = {
    version: 1,
    exportedAtIso: new Date().toISOString(),
    localStorage: lsSnapshot,
    sessions,
    passageStats,
    liveTakes,
  };

  return JSON.stringify(payload, null, 2);
}

export async function importAllDataJson(json: string): Promise<{
  sessionsImported: number;
  passagesImported: number;
  liveTakesImported: number;
}> {
  const parsed = JSON.parse(json) as Partial<SonicMamboBackupPayload>;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
    throw new Error('Invalid SonicMambo backup JSON format');
  }

  await clearAllStores();

  if (parsed.localStorage && typeof window !== 'undefined' && window.localStorage) {
    for (const [k, v] of Object.entries(parsed.localStorage)) {
      if (k.startsWith('sonicmambo:') && typeof v === 'string') {
        window.localStorage.setItem(k, v);
      }
    }
  }

  let sessionsImported = 0;
  for (const s of parsed.sessions) {
    if (s && typeof s.id === 'string') {
      await savePracticeSession(s);
      sessionsImported += 1;
    }
  }

  let passagesImported = 0;
  for (const p of parsed.passageStats ?? []) {
    if (p && typeof p.passageId === 'string') {
      await savePassageStat(p);
      passagesImported += 1;
    }
  }

  let liveTakesImported = 0;
  for (const t of parsed.liveTakes ?? []) {
    if (t && typeof t.takeId === 'string') {
      await saveLiveTake(t);
      liveTakesImported += 1;
    }
  }

  await saveSetting('lastImportIso', new Date().toISOString());

  return { sessionsImported, passagesImported, liveTakesImported };
}
