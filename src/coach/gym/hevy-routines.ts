import { tidyGroups } from '../../shared/superset';
import { restOf } from '../../shared/rest';
import fs from 'node:fs';
import path from 'node:path';
import type { Exercise } from '../../shared/exercises';
import type { ExerciseTemplate, GymWorkout } from '../../shared/gym/types';
import { writeJsonAtomic } from '../../shared/node/atomic-write';
import { createLogger } from '../../shared/node/log';

const log = createLogger('hevy-routines');

const API = 'https://api.hevyapp.com';
const FOLDER_TITLE = 'Pandafit';
const TIMEOUT_MS = 20_000;
const TEMPLATE_PAGE = 100;
const LIST_PAGE = 10;
const TEMPLATE_TTL_MS = 7 * 86_400_000;
const TEMPLATE_FILE = 'templates.json';

type Options = { key: string; dir: string; nowMs: () => number; fetchFn?: typeof fetch };
type RawRoutine = { id: string; folder_id?: number | null; updated_at: string };
type RawTemplate = { id: string; title: string; type?: string; primary_muscle_group?: string; equipment?: string };

/** Carries the status only, never the key or a response body. */
export class HevyError extends Error {
  constructor(readonly status: number) { super(`Hevy ${status}`); }
}
class NotFound extends HevyError {}

/**
 * The only place that writes to Hevy: one folder, one routine in it, and updates of that routine.
 * There is deliberately no delete. Errors carry the status only, never the key or any body.
 */
export class HevyRoutines {
  private folderId: number | null = null;

  constructor(private opts: Options) {}

  private async call<T>(method: 'GET' | 'POST' | 'PUT', pathAndQuery: string, body?: unknown): Promise<T> {
    const res = await (this.opts.fetchFn ?? fetch)(`${API}${pathAndQuery}`, {
      method,
      headers: { 'api-key': this.opts.key, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) throw new NotFound(404);
    if (!res.ok) throw new HevyError(res.status);
    return await res.json() as T;
  }

  private async pages<T>(route: string, name: string, size: number): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    let count = 1;
    while (page <= count) {
      const data = await this.call<Record<string, unknown> & { page_count?: number }>('GET', `${route}?page=${page}&pageSize=${size}`);
      all.push(...((data[name] as T[] | undefined) ?? []));
      // A missing count must never read as "one page": a wrong "not found" would create a duplicate that cannot be deleted.
      if (typeof data.page_count !== 'number') throw new Error('Hevy list incomplete');
      count = data.page_count;
      page += 1;
    }
    return all;
  }

  async templates(): Promise<ExerciseTemplate[]> {
    let expired: ExerciseTemplate[] | null = null;
    try {
      const cached = JSON.parse(fs.readFileSync(path.join(this.opts.dir, TEMPLATE_FILE), 'utf8')) as { fetchedMs: number; templates: ExerciseTemplate[] };
      if (Array.isArray(cached.templates)) {
        if (this.opts.nowMs() - cached.fetchedMs < TEMPLATE_TTL_MS) return cached.templates;
        expired = cached.templates;
      }
    } catch { /* fetch again */ }
    try {
      return await this.refreshTemplates();
    } catch (e) {
      if (expired) return expired;
      throw e;
    }
  }

  /** Fetches past the cache, for when a stored template id may be out of date. Only reads from Hevy. */
  async refreshTemplates(): Promise<ExerciseTemplate[]> {
    const file = path.join(this.opts.dir, TEMPLATE_FILE);
    const raw = await this.pages<RawTemplate>('/v1/exercise_templates', 'exercise_templates', TEMPLATE_PAGE);
    const templates = raw.map((t) => ({ id: t.id, title: t.title, type: t.type ?? '', primaryMuscle: t.primary_muscle_group ?? '', equipment: t.equipment ?? '' }));
    try {
      fs.mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
      writeJsonAtomic(file, { fetchedMs: this.opts.nowMs(), templates }, { mode: 0o600 });
    } catch (e) { log.error('hevy templates not cached', e); /* The fetched templates still count; the next plan fetches again. */ }
    return templates;
  }

  private async ensureFolder(): Promise<number> {
    if (this.folderId !== null) return this.folderId;
    const folders = await this.pages<{ id: number; title: string }>('/v1/routine_folders', 'routine_folders', LIST_PAGE);
    let found = folders.find((f) => f.title === FOLDER_TITLE)?.id;
    if (found === undefined) {
      const created = await this.call<{ id?: number; routine_folder?: { id: number } }>('POST', '/v1/routine_folders', { routine_folder: { title: FOLDER_TITLE } });
      found = created.routine_folder?.id ?? created.id;
      if (typeof found !== 'number') throw new Error('Hevy folder missing');
    }
    this.folderId = found;
    return found;
  }

  private body(workout: GymWorkout, folderId: number | null, catalog?: readonly Exercise[]) {
    return { routine: {
      title: workout.name, ...(folderId !== null ? { folder_id: folderId } : {}), notes: '',
      exercises: tidyGroups(workout.exercises).map((e) => ({
        exercise_template_id: e.templateId, superset_id: e.supersetId, rest_seconds: Math.max(0, Math.min(600, Math.round(restOf(e, catalog)))), notes: e.notes,
        sets: e.sets.map((s) => ({ type: s.type, weight_kg: s.weightKg, reps: s.reps, rep_range: s.repRange ?? null })),
      })),
    } };
  }

  private static result(data: { routine: RawRoutine | RawRoutine[] }): { routineId: string; updatedAt: string } {
    const r = Array.isArray(data.routine) ? data.routine[0] : data.routine;
    if (!r?.id) throw new Error('Hevy routine missing');
    return { routineId: r.id, updatedAt: r.updated_at };
  }

  /**
   * Caller contract: call `editedSince` before asking the rider to confirm, and call this only after the confirmation,
   * which covers overwriting hand edits. `known.updatedAt` is deliberately not checked here.
   * Updates the known routine or one found in the coach's folder; creates one only when there is none. */
  async writeRoutine(workout: GymWorkout, known: { routineId: string | null; updatedAt: string | null }, catalog?: readonly Exercise[]): Promise<{ routineId: string; updatedAt: string }> {
    const folderId = await this.ensureFolder();
    const body = this.body(workout, folderId, catalog);
    let id = known.routineId;
    if (!id) {
      const mine = await this.pages<RawRoutine>('/v1/routines', 'routines', LIST_PAGE);
      id = mine.find((r) => r.folder_id === folderId)?.id ?? null;
    }
    if (id) {
      try {
        return HevyRoutines.result(await this.call('PUT', `/v1/routines/${encodeURIComponent(id)}`, this.body(workout, null, catalog)));
      } catch (e) {
        if (!(e instanceof NotFound)) throw e;
      }
    }
    return HevyRoutines.result(await this.call('POST', '/v1/routines', body));
  }

  /** True when the routine changed in Hevy after the last write. A routine that is gone counts as not edited. */
  async editedSince(routineId: string, updatedAt: string): Promise<boolean> {
    try {
      const data = await this.call<{ routine: RawRoutine | RawRoutine[] }>('GET', `/v1/routines/${encodeURIComponent(routineId)}`);
      return HevyRoutines.result(data).updatedAt !== updatedAt;
    } catch (e) {
      if (e instanceof NotFound) return false;
      throw e;
    }
  }
}
