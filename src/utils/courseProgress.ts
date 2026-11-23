import { GUITAR_COURSES, type CoursePracticeMode, type GuitarCourse } from '../data/guitarCourses.ts';

export const PASS_ACCURACY_THRESHOLD = 0.6;

export interface CourseMasteryRecord {
  courseId: string;
  completed: boolean;
  bestAccuracy: number; // 0..1
  stars: 0 | 1 | 2 | 3;
  completedModes: CoursePracticeMode[];
  attempts: number;
  lastPlayedIso: string;
}

export interface CourseProgressStore {
  courses: Record<string, CourseMasteryRecord>;
  unlockAll: boolean;
}

const PROGRESS_STORAGE_KEY = 'sonicmambo:courseProgress:v2';

export function computeStarsForAccuracy(accuracy: number): 0 | 1 | 2 | 3 {
  if (accuracy >= 0.92) return 3;
  if (accuracy >= 0.8) return 2;
  if (accuracy >= PASS_ACCURACY_THRESHOLD) return 1;
  return 0;
}

export function readCourseProgress(): CourseProgressStore {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { courses: {}, unlockAll: false };
    }
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return { courses: {}, unlockAll: false };
    const parsed = JSON.parse(raw) as Partial<CourseProgressStore>;
    return {
      courses: parsed.courses && typeof parsed.courses === 'object' ? parsed.courses : {},
      unlockAll: Boolean(parsed.unlockAll),
    };
  } catch {
    return { courses: {}, unlockAll: false };
  }
}

export function writeCourseProgress(store: CourseProgressStore): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(store));
    }
  } catch {
    // ignore
  }
}

export function isCourseUnlocked(
  course: GuitarCourse,
  store: CourseProgressStore,
  allCourses: readonly GuitarCourse[] = GUITAR_COURSES,
): boolean {
  if (store.unlockAll) return true;
  if (course.order <= 1) return true;
  const prev = allCourses.find((c) => c.order === course.order - 1);
  if (!prev) return true;
  return Boolean(store.courses[prev.id]?.completed);
}

export function getNextCourse(
  currentCourseId: string,
  allCourses: readonly GuitarCourse[] = GUITAR_COURSES,
): GuitarCourse | null {
  const cur = allCourses.find((c) => c.id === currentCourseId);
  if (!cur) return null;
  return allCourses.find((c) => c.order === cur.order + 1) ?? null;
}

export function getFrontierCourse(
  store: CourseProgressStore,
  allCourses: readonly GuitarCourse[] = GUITAR_COURSES,
): GuitarCourse {
  const sorted = [...allCourses].sort((a, b) => a.order - b.order);
  for (let i = 0; i < sorted.length; i += 1) {
    const c = sorted[i];
    if (isCourseUnlocked(c, store, sorted) && !store.courses[c.id]?.completed) {
      return c;
    }
  }
  return sorted[sorted.length - 1];
}

export function recordCourseAttempt(
  store: CourseProgressStore,
  params: {
    courseId: string;
    mode: CoursePracticeMode;
    accuracy: number;
  },
  allCourses: readonly GuitarCourse[] = GUITAR_COURSES,
): {
  nextStore: CourseProgressStore;
  passed: boolean;
  starsEarned: 0 | 1 | 2 | 3;
  newlyUnlockedCourse: GuitarCourse | null;
} {
  const clampedAcc = Math.max(0, Math.min(1, params.accuracy));
  const passed = clampedAcc >= PASS_ACCURACY_THRESHOLD;
  const starsEarned = computeStarsForAccuracy(clampedAcc);

  const nextCandidate = getNextCourse(params.courseId, allCourses);
  const wasNextUnlocked = nextCandidate
    ? isCourseUnlocked(nextCandidate, store, allCourses)
    : true;

  const existing = store.courses[params.courseId];
  const bestAccuracy = Math.max(existing?.bestAccuracy ?? 0, clampedAcc);
  const bestStars = Math.max(existing?.stars ?? 0, starsEarned) as 0 | 1 | 2 | 3;
  const prevModes = existing?.completedModes ?? [];
  const completedModes =
    passed && !prevModes.includes(params.mode)
      ? [...prevModes, params.mode]
      : prevModes;

  const updatedRecord: CourseMasteryRecord = {
    courseId: params.courseId,
    completed: Boolean(existing?.completed) || passed,
    bestAccuracy,
    stars: bestStars,
    completedModes,
    attempts: (existing?.attempts ?? 0) + 1,
    lastPlayedIso: new Date().toISOString(),
  };

  const nextStore: CourseProgressStore = {
    ...store,
    courses: {
      ...store.courses,
      [params.courseId]: updatedRecord,
    },
  };

  writeCourseProgress(nextStore);

  const isNextNowUnlocked = nextCandidate
    ? isCourseUnlocked(nextCandidate, nextStore, allCourses)
    : false;

  return {
    nextStore,
    passed,
    starsEarned,
    newlyUnlockedCourse:
      !wasNextUnlocked && isNextNowUnlocked && nextCandidate ? nextCandidate : null,
  };
}
