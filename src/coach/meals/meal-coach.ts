import fs from 'node:fs';
import path from 'node:path';
import {
  addWeeks, CHAT_MAX_CHARS, dayIndex, eatersOf, DEFAULT_MEAL_SETTINGS, DIETS, EMPTY_STATE, HABITS, isChatRecordId, isWeekKey, mealKey, mergeStates,
  isFavRecordId, isLinkRecordId, isPlaceRecordId, parseMealKey, readPlaceRequest, type PlaceState, isRecipeRecordId, favouriteIds, type RecipeDetail, type RecipePage, newChatId, planRecordId, readLinkRequest, readMealChat, readMealState, SLOTS, stateRecordId, weekOf, weekOfRecordId, withEater, withItem, type Diet,
  type Habit, type ItemState, type LinkResult, type Meal, type MealChat, type MealPlan, type MealSettings, type MealState, type Person, type Slot,
} from '../../shared/meals';
import type { TrackedRecord } from '../../shared/records';
import type { RecordStore } from '../tracking/store';
import { fitsEveryone } from './check';
import { sanitizeUrl, type StoredRecipe } from './recipe-import';
import { fetchPicture, imageUrlOf, type Picture } from './recipe-image';
import { extractRecipe, fetchPage, type Page } from './recipe-link';
import { browse, detail, type BrowseQuery } from './recipe-browse';
import { planFromRecipes, recipeDish, type Favourites } from './recipe-plan';
import { RecipeStore, shownLink } from './recipe-store';
import { ruleValues } from '../../shared/training-policy';
import { buildMealPrompt, buildSwapPrompt, dishFrom, MEAL_SYSTEM_PROMPT, mealAnswerJsonSchema, mealAnswerSchema, mealsFromAnswer } from './prompt';
import { constraintsFor, ruleMeals, seeded, skeleton, type Member, type Slotted } from './rules';
import { applyChat, buildChatPrompt, CHAT_SYSTEM_PROMPT, chatAnswerJsonSchema, chatAnswerSchema, listDish, putDish, REPLY_NO_AI, REPLY_NO_PLAN, replySwapped, ruleTarget, type ChatResult } from './chat';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The plan for the coming week is made on Saturday from 06:00, or on Sunday if the Mac was off. */
const PLAN_DAY = 5;
const PLAN_HOUR = 6;
const PLAN_TIMEOUT_MS = 300_000;
const SWAP_TIMEOUT_MS = 120_000;
const CHAT_TIMEOUT_MS = 120_000;
/** Messages kept per person, the newest. */
const CHAT_KEEP = 10;
/** Link requests kept per person, the newest. */
const LINK_KEEP = 10;
const MAX_TAGS = 20;
const TAG_MAX = 40;
const TRAINING_WINDOW_DAYS = 28;
const TRAINING_MIN_SESSIONS = 2;

export const NOTICE_NO_AI = 'Der Coach war gerade nicht erreichbar. Der Plan kommt aus Pandafits Rezeptliste.';
const noticeReplaced = (n: number) => (n === 1 ? 'Ein Gericht vom Coach passte nicht zu allen Angaben und kommt aus der Rezeptliste.' : `${n} Gerichte vom Coach passten nicht zu allen Angaben und kommen aus der Rezeptliste.`);

type Ask = (input: { prompt: string; systemPrompt: string; schema: object; timeoutMs?: number }) => Promise<unknown>;
type Deps = {
  dir: string; nowMs: () => number;
  /** Every profile on this Mac, with the name and avatar the plan shows. */
  profiles: () => Person[];
  /** False while a ride is open: then nothing is planned and no AI is asked. */
  noOpenRide: () => boolean;
  ask?: Ask;
  /** Weekdays (Monday 0) the person usually trains on. */
  trainingDays?: (id: string) => number[];
  /** The tracked records of this Mac and whether a profile is linked to an account. Without them nothing is synced. */
  store?: Pick<RecordStore, 'all' | 'putMany'>;
  linked?: (id: string) => boolean;
  random?: () => number;
  /** Profiles whose records were just written, so their sync can go soon. */
  onExport?: (ids: string[]) => void;
  /** `<root>/recipes`: the recipe collection and its inbox. Without it there is none. */
  recipesDir?: string;
  /** Fetches the page of a link recipe; the guarded fetch unless a test gives its own. */
  fetchPage?: (url: string) => Promise<Page>;
  /** Downloads a recipe's picture; the guarded download unless a test gives its own. */
  fetchPicture?: (url: string) => Promise<Picture | null>;
};
type FileData = {
  settings: Record<string, MealSettings>; plans: Record<string, MealPlan>; states: Record<string, MealState>; notices: Record<string, string | null>; lastAuto: string | null;
  /** The chat with the coach, per person, oldest first. */
  chats: Record<string, MealChat[]>;
};

export type MealWeek = { plan: MealPlan; state: MealState; notice: string | null };
export type MealsView = {
  settings: MealSettings;
  /** The current week, then the next one if it is planned already. */
  weeks: MealWeek[];
  currentWeek: string; today: number;
  /** A week or a meal key being planned right now, or "chat" while the coach answers a message. */
  planning: string | null;
  /** This person's last messages to the coach about the plan, oldest first. */
  chat: MealChat[];
  /** False while a ride is open. */
  canPlan: boolean;
  /** How big the recipe collection is against the number it is planned from; null without a collection. */
  recipes: { collection: number; unlock: number } | null;
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const tags = (x: unknown): string[] => (Array.isArray(x) ? [...new Set(x.filter((t): t is string => typeof t === 'string').map((t) => t.trim().replace(/\s+/g, ' ').slice(0, TAG_MAX)).filter(Boolean))].slice(0, MAX_TAGS) : []);

/** Settings as sent by the app, cut to the known shape. Anything unknown takes the default. */
export function cleanSettings(x: unknown): MealSettings {
  const d = DEFAULT_MEAL_SETTINGS;
  if (!isObj(x)) return { ...d, habits: { ...d.habits } };
  const h = isObj(x.habits) ? x.habits : {};
  const habits = Object.fromEntries(SLOTS.map((s) => [s, HABITS.includes(h[s] as Habit) ? h[s] : d.habits[s]])) as Record<Slot, Habit>;
  return { on: x.on === true, diet: DIETS.includes(x.diet as Diet) ? x.diet as Diet : d.diet, dislikes: tags(x.dislikes), intolerances: tags(x.intolerances), habits };
}

/** Weekdays with at least two sessions in the last four weeks. */
export function usualTrainingDays(startsMs: number[], nowMs: number): number[] {
  const count = new Array(7).fill(0) as number[];
  for (const t of startsMs) if (t <= nowMs && nowMs - t <= TRAINING_WINDOW_DAYS * DAY) count[dayIndex(t)]!++;
  return count.flatMap((n, d) => (n >= TRAINING_MIN_SESSIONS ? [d] : []));
}

/**
 * The household's meal plan: one per Mac, for every profile that turned it on. Plans on Saturday morning for the coming
 * week, with the AI when it is there and from the own recipe list otherwise. Never with a ride open. A profile with the
 * plan off is not read, not asked about and not synced.
 */
export class MealCoach {
  private data: FileData | null = null;
  private planning: string | null = null;
  private store: RecipeStore | null = null;
  private linking = false;
  constructor(private deps: Deps) {}

  private file(): string { return path.join(this.deps.dir, 'household.json'); }
  private load(): FileData {
    if (this.data) return this.data;
    let d: Partial<FileData> = {};
    try { const parsed = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as unknown; if (isObj(parsed)) d = parsed as Partial<FileData>; } catch { /* no file yet */ }
    this.data = { settings: isObj(d.settings) ? d.settings : {}, plans: isObj(d.plans) ? d.plans : {}, states: isObj(d.states) ? d.states : {}, notices: isObj(d.notices) ? d.notices : {}, lastAuto: typeof d.lastAuto === 'string' ? d.lastAuto : null, chats: isObj(d.chats) ? d.chats : {} };
    return this.data;
  }
  private save(): void {
    const d = this.load();
    const now = this.deps.nowMs();
    // Only the last, this and the next week are kept.
    const keep = new Set([addWeeks(weekOf(now), -1), weekOf(now), addWeeks(weekOf(now), 1)]);
    for (const k of Object.keys(d.plans)) if (!keep.has(k)) { delete d.plans[k]; delete d.states[k]; delete d.notices[k]; }
    fs.mkdirSync(this.deps.dir, { recursive: true });
    const f = this.file();
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(d));
    fs.renameSync(`${f}.tmp`, f);
  }

  /** The recipe collection, opened on first use; null without a directory for it. */
  recipes(): RecipeStore | null {
    if (!this.deps.recipesDir) return null;
    this.store ??= new RecipeStore(this.deps.recipesDir, this.deps.nowMs);
    return this.store;
  }

  private counted: { atMs: number; value: { collection: number; unlock: number } } | null = null;
  /** The collection's size for the view, read at most once a minute (the view is built often). */
  private recipeCount(): { collection: number; unlock: number } | null {
    try {
      const store = this.recipes();
      if (!store) return null;
      const now = this.deps.nowMs();
      if (!this.counted || now - this.counted.atMs > 60_000 || now < this.counted.atMs) { const s = store.stats(); this.counted = { atMs: now, value: { collection: s.collection, unlock: s.unlock } }; }
      return this.counted.value;
    } catch { return null; }
  }

  /** Takes recipes waiting in the inbox. Never while a ride is open; never throws. */
  private async importInbox(): Promise<void> {
    try {
      const store = this.recipes();
      if (!store || !this.deps.noOpenRide()) return;
      await store.scanInbox({ noOpenRide: this.deps.noOpenRide, ...(this.deps.fetchPicture ? { fetchPicture: this.deps.fetchPicture } : {}), ...(this.deps.ask ? { ask: this.deps.ask } : {}) });
    } catch { /* the next scan tries again */ }
  }

  /**
   * One link a person gave: fetched with the guard, the Recipe found in its JSON-LD, the same pipeline as the collection. Counts against
   * the household's daily limit whether or not it works. Never throws.
   */
  async addLink(owner: string, url: string): Promise<LinkResult> {
    try {
      const store = this.recipes();
      const clean = typeof url === 'string' ? sanitizeUrl(url.trim()) : null;
      if (!store || !clean || !clean.startsWith('https://')) return { state: 'bad' };
      if (store.linksToday() >= ruleValues('meals.import-limits').linkPerDay!) return { state: 'limit' };
      store.countLink();
      const page = await (this.deps.fetchPage ?? fetchPage)(clean);
      if (!page.ok) return { state: ['scheme', 'credentials', 'port', 'host', 'private', 'unresolved'].includes(page.reason) ? 'bad' : page.reason === 'type' ? 'none' : 'fetch' };
      const found = extractRecipe(page.html);
      if (!found) return { state: 'none' };
      const out = await store.add({ source: 'link', owner, url: clean, recipe: found, ...(this.deps.ask ? { ask: this.deps.ask, tagAsk: this.deps.ask } : {}) });
      if (out.status === 'saved' || out.status === 'duplicate') {
        // The page's own picture, when the recipe has none: a failed download never fails the import.
        try {
          const address = imageUrlOf((found as { image?: unknown }).image);
          if (address && !store.imageOf(out.recipe.id)) { const pic = await (this.deps.fetchPicture ?? fetchPicture)(address); if (pic) store.setImage(out.recipe.id, pic); }
        } catch { /* the recipe stays without a picture */ }
        return { state: 'saved', title: out.recipe.title };
      }
      if (out.status === 'pending') return { state: 'wait', title: String((found as { name?: unknown }).name ?? '').slice(0, 120) || 'Rezept' };
      return { state: out.status === 'rejected' ? 'veg' : 'none' };
    } catch { return { state: 'fetch' }; }
  }

  /** Answers waiting link requests of people with the plan on and a linked account, a few per tick, never with a ride open. */
  private async answerLinks(): Promise<boolean> {
    const { store } = this.deps;
    if (!store || this.linking || !this.recipes() || !this.deps.noOpenRide()) return false;
    this.linking = true;
    let any = false;
    const touched = new Set<string>();
    try {
      let budget = 5;
      for (const p of this.deps.profiles()) {
        if (!this.synced(p.id)) continue;
        for (const r of store.all(p.id, 'mealplan')) {
          if (budget <= 0) return any;
          if (r.deleted || !isLinkRecordId(r.id)) continue;
          const req = readLinkRequest(r.id, r.body);
          if (!req || req.result) continue;
          budget--;
          const result = await this.addLink(p.id, req.url);
          const now = this.deps.nowMs();
          const body = isObj(r.body) ? r.body : {};
          store.putMany(p.id, [{ ...r, updatedMs: Math.max(now, r.updatedMs + 1), body: { ...body, result, answeredMs: now } }]);
          any = true;
          touched.add(p.id);
        }
      }
    } catch { /* the next tick tries again */ } finally {
      this.linking = false;
      if (touched.size > 0) { try { this.deps.onExport?.([...touched]); } catch { /* a listener never matters here */ } }
    }
    return any;
  }

  /** The recipes this person marked as favourites (their `fav-` records). */
  favourites(profileId: string): Set<string> {
    try { return favouriteIds(this.deps.store?.all(profileId, 'mealplan') ?? []); } catch { return new Set(); }
  }
  /** One page of recipes this person may browse. Empty without a collection. */
  browse(profileId: string, q: BrowseQuery): RecipePage {
    try { const store = this.recipes(); return store ? browse(store, profileId, this.favourites(profileId), q) : { items: [], more: false }; } catch { return { items: [], more: false }; }
  }
  recipeDetail(profileId: string, id: string): RecipeDetail | null {
    try { const store = this.recipes(); return store ? detail(store, profileId, this.favourites(profileId), id) : null; } catch { return null; }
  }

  /**
   * A person wants a recipe at a meal ("In den Plan"). The same checks as a swap: the week must still be changeable, the day not past,
   * the recipe one this person may see, and it must fit everyone who eats the meal (diet, dislikes, intolerances). A meal that is not
   * there yet is added. The recipe replaces the dish like a swap does; the meal's leftovers follow.
   */
  private place(id: string, req: { week: string; meal: string; recipeId: string }): PlaceState {
    const now = this.deps.nowMs();
    const current = weekOf(now);
    const d = this.load();
    const plan = d.plans[req.week];
    if (!plan || (req.week !== current && req.week !== addWeeks(current, 1))) return 'noplan';
    const at = parseMealKey(req.meal);
    if (!at) return 'noplan';
    if (req.week === current && at.day < dayIndex(now)) return 'past';
    const recipe = this.recipes()?.canSee(req.recipeId, id) ?? null;
    if (!recipe) return 'gone';
    const members = this.members();
    const state = d.states[req.week] ?? EMPTY_STATE;
    const existing = plan.meals.find((m) => mealKey(m.day, m.slot) === req.meal);
    const eaters = existing ? eatersOf(plan, state, req.meal) : plan.people.map((p) => p.id);
    if (!fitsEveryone(recipe, constraintsFor(members, eaters).map((m) => m.settings))) return 'nofit';
    let meal = existing;
    if (!meal) {
      meal = { day: at.day, slot: at.slot, dish: recipeDish(recipe), reuseOf: null, eaters, takeAlong: false };
      plan.meals.push(meal);
      plan.meals.sort((a, b) => a.day - b.day || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
    }
    delete meal.askedBy;
    putDish(plan, state, members, req.meal, recipeDish(recipe), this.deps.random ?? Math.random);
    meal.askedBy = id;
    this.save();
    return 'placed';
  }

  /** Answers waiting "In den Plan" requests, a few per tick, never with a ride open and never next to a planning run. */
  private answerPlacements(): boolean {
    const { store } = this.deps;
    if (!store || this.planning || !this.deps.noOpenRide()) return false;
    let any = false;
    const touched = new Set<string>();
    try {
      let budget = 5;
      for (const p of this.deps.profiles()) {
        if (!this.synced(p.id)) continue;
        for (const r of store.all(p.id, 'mealplan')) {
          if (budget <= 0) return any;
          if (r.deleted || !isPlaceRecordId(r.id)) continue;
          const req = readPlaceRequest(r.id, r.body);
          if (!req || req.result) continue;
          budget--;
          this.importStates();
          const result = this.place(p.id, req);
          const now = this.deps.nowMs();
          store.putMany(p.id, [{ ...r, updatedMs: Math.max(now, r.updatedMs + 1), body: { ...(isObj(r.body) ? r.body : {}), result, answeredMs: now } }]);
          any = true;
          touched.add(p.id);
        }
      }
    } catch { /* the next tick tries again */ } finally {
      if (any) this.exportAll();
      if (touched.size > 0) { try { this.deps.onExport?.([...touched]); } catch { /* a listener never matters here */ } }
    }
    return any;
  }

  /** A person deleted a recipe from their list (the record has a tombstone): the recipe goes too. */
  private removeDeletedRecipes(owner: string, have: TrackedRecord[]): void {
    const store = this.recipes();
    if (!store) return;
    for (const r of have) if (r.deleted && isRecipeRecordId(r.id)) { try { store.remove(owner, r.id.slice('recipe-'.length)); } catch { /* gone already */ } }
  }

  settings(id: string): MealSettings { return cleanSettings(this.load().settings[id]); }
  enabled(id: string): boolean { return this.settings(id).on; }
  isPlanning(): boolean { return this.planning !== null; }

  private members(): Member[] {
    return this.deps.profiles().filter((p) => this.enabled(p.id)).map((p) => ({ id: p.id, settings: this.settings(p.id) }));
  }
  private people(): Person[] { return this.deps.profiles().filter((p) => this.enabled(p.id)).map(({ id, name, avatar }) => ({ id, name, ...(avatar ? { avatar } : {}) })); }

  setSettings(id: string, raw: unknown): void {
    if (!this.deps.profiles().some((p) => p.id === id)) return;
    const d = this.load();
    const next = cleanSettings(raw);
    const was = this.settings(id).on;
    d.settings[id] = next;
    for (const plan of Object.values(d.plans)) {
      const inPlan = plan.people.some((p) => p.id === id);
      // Off: out of every plan, so portions and the shopping list shrink. On: in the plan, eating once switched on.
      if (!next.on && inPlan) { plan.people = plan.people.filter((p) => p.id !== id); for (const m of plan.meals) m.eaters = m.eaters.filter((e) => e !== id); }
      if (next.on && !was && !inPlan) { const p = this.deps.profiles().find((x) => x.id === id); if (p) plan.people.push({ id: p.id, name: p.name, ...(p.avatar ? { avatar: p.avatar } : {}) }); }
    }
    this.save();
    this.exportAll();
  }

  /** A moving person's settings from their Mac, taken only when the household has none for them yet. True when taken. */
  adoptSettings(id: string, raw: unknown): boolean {
    const d = this.load();
    if (Object.prototype.hasOwnProperty.call(d.settings, id)) return false;
    d.settings[id] = cleanSettings(raw);
    this.save();
    this.exportAll();
    return true;
  }

  view(id: string): MealsView {
    const now = this.deps.nowMs();
    const d = this.load();
    const current = weekOf(now);
    const weeks = [current, addWeeks(current, 1)].flatMap((w) => (d.plans[w] ? [{ plan: d.plans[w]!, state: d.states[w] ?? EMPTY_STATE, notice: d.notices[w] ?? null }] : []));
    const on = this.enabled(id);
    return { settings: this.settings(id), weeks: on ? weeks : [], currentWeek: current, today: dayIndex(now), planning: this.planning, canPlan: this.deps.noOpenRide(), chat: on ? d.chats[id] ?? [] : [], recipes: on ? this.recipeCount() : null };
  }

  /**
   * From the scan loop. Never throws into it, never plans with a ride open, and does nothing at all with no one in.
   * `plan: false` keeps the scheduled weekly plan back (quiet hours on the server) but still answers a person's waiting messages.
   */
  async tick(opts: { plan?: boolean } = {}): Promise<string[]> {
    try {
      // The collection grows whether or not anyone plans meals.
      await this.importInbox();
      // No profile ever turned the plan on: nothing is read, written or sent.
      if (Object.keys(this.load().settings).length === 0) return [];
      if (this.members().length === 0) return this.exportAll();
      this.importStates();
      await this.answerLinks();
      this.answerPlacements();
      let touched = this.exportAll();
      // Messages from phones, and those typed here during a ride, once no ride is open.
      if (await this.answerPending()) touched = [...new Set([...touched, ...this.exportAll()])];
      const now = this.deps.nowMs();
      const day = dayIndex(now);
      const due = (day === PLAN_DAY && new Date(now).getHours() >= PLAN_HOUR) || day === PLAN_DAY + 1;
      const target = addWeeks(weekOf(now), 1);
      const d = this.load();
      if (opts.plan !== false && due && !d.plans[target] && d.lastAuto !== target && this.deps.noOpenRide() && !this.planning) {
        d.lastAuto = target;
        this.save();
        await this.planWeek(target, 0);
        return [...new Set([...touched, ...this.exportAll()])];
      }
      return touched;
    } catch { return []; }
  }

  /** "Neu planen": the shown week, from today on for the current one. */
  async replan(id: string, week: string): Promise<void> {
    const now = this.deps.nowMs();
    const current = weekOf(now);
    if (!this.enabled(id) || !this.deps.noOpenRide() || this.planning || (week !== current && week !== addWeeks(current, 1))) return;
    await this.planWeek(week, week === current ? dayIndex(now) : 0);
    this.exportAll();
  }

  private training(): number[] {
    return [...new Set(this.members().flatMap((m) => { try { return this.deps.trainingDays?.(m.id) ?? []; } catch { return []; } }))].sort();
  }

  private async planWeek(week: string, fromDay: number): Promise<void> {
    const members = this.members();
    if (members.length === 0) return;
    this.planning = week;
    try {
      const d = this.load();
      const trainingDays = this.training();
      const random = this.deps.random ?? seeded(`${week}-${fromDay}-${this.deps.nowMs()}`);
      const lastIds = new Set((d.plans[addWeeks(week, -1)]?.meals ?? []).flatMap((m) => (m.dish.recipeId ? [m.dish.recipeId] : [])));
      // What stays in this week (a replan from today keeps the days before) is not planned again.
      for (const m of d.plans[week]?.meals ?? []) if (m.day < fromDay && m.dish.recipeId) lastIds.add(m.dish.recipeId);
      const lastWeek = [...new Set((d.plans[addWeeks(week, -1)]?.meals ?? []).map((m) => m.dish.title))];
      // Real recipes first: the household's link recipes always, the collection once it is big enough. None at all: exactly the plan of before.
      const real = await this.realMeals({ members, fromDay, trainingDays, random, lastIds, lastWeek, week });
      const realKeys = new Set(real.map((m) => mealKey(m.day, m.slot)));
      const aiSlots = skeleton(members, fromDay, false).filter((s) => !realKeys.has(mealKey(s.day, s.slot)));
      let fromAi: Meal[] = [];
      let notice: string | null = null;
      if (aiSlots.length === 0) {
        // Every meal came from a real recipe: nothing to invent.
      } else if (this.deps.ask) {
        try {
          const raw = await this.deps.ask({ prompt: buildMealPrompt({ members, slots: aiSlots, trainingDays, lastWeek }), systemPrompt: MEAL_SYSTEM_PROMPT, schema: mealAnswerJsonSchema, timeoutMs: PLAN_TIMEOUT_MS });
          fromAi = mealsFromAnswer(raw, members, aiSlots);
          const replaced = aiSlots.length - fromAi.length;
          if (!mealAnswerSchema.safeParse(raw).success) notice = NOTICE_NO_AI;
          else if (replaced > 0) notice = noticeReplaced(replaced);
        } catch { notice = NOTICE_NO_AI; }
      } else notice = NOTICE_NO_AI;
      // Whatever the AI left open comes from the list, with the rule's cook-once-eat-twice where both halves are open.
      const have = new Set([...fromAi, ...real].map((m) => mealKey(m.day, m.slot)));
      const open = skeleton(members, fromDay, true).filter((s) => !have.has(mealKey(s.day, s.slot))).map((s) => (s.reuseOf && have.has(s.reuseOf) ? { ...s, reuseOf: null } : s));
      for (const m of real) if (m.dish.recipeId) lastIds.add(m.dish.recipeId);
      const fromList = ruleMeals(members, open, trainingDays, random, lastIds);
      const kept = (d.plans[week]?.meals ?? []).filter((m) => m.day < fromDay);
      const meals = [...kept, ...real, ...fromAi, ...fromList].sort((a, b) => a.day - b.day || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
      const source = fromAi.length === 0 ? 'liste' : fromList.length + real.length === 0 ? 'coach' : 'gemischt';
      d.plans[week] = { week, createdMs: this.deps.nowMs(), source, people: this.people(), meals, trainingDays };
      d.notices[week] = notice;
      this.save();
    } finally { this.planning = null; }
  }

  /**
   * Meals from real recipes for the open slots of a week. Below the unlock only the household's link recipes are candidates, for at most
   * a third of the meals; from it the collection joins, for every meal, and the AI chooses from the shortlists. Empty without recipes.
   */
  private async realMeals(i: { members: Member[]; fromDay: number; trainingDays: number[]; random: () => number; lastIds: Set<string>; lastWeek: string[]; week: string }): Promise<Meal[]> {
    try {
      const store = this.recipes();
      if (!store) return [];
      const unlocked = store.unlocked();
      const seed = [...i.week].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 4294967291, 7);
      const pool: StoredRecipe[] = [...store.links()];
      if (unlocked) for (const slot of SLOTS) pool.push(...store.collectionFor(slot, 2000, seed));
      // Favourites are candidates even below the unlock, like the household's own recipes.
      const favourites: Favourites = new Map(i.members.map((m) => [m.id, this.favourites(m.id)] as const));
      if (!unlocked) { const have = new Set(pool.map((r) => r.id)); pool.push(...store.getMany([...new Set([...favourites.values()].flatMap((f) => [...f]))]).filter((r) => !have.has(r.id))); }
      if (pool.length === 0) return [];
      const slots = skeleton(i.members, i.fromDay, unlocked);
      const cap = unlocked ? undefined : Math.max(1, Math.floor(slots.length / 3));
      // Below the unlock the slots are looked at in a random order, so the links do not always land on the same days.
      const order = unlocked ? slots : [...slots].sort(() => i.random() - 0.5);
      const meals = await planFromRecipes({
        members: i.members, slots: order, trainingDays: i.trainingDays, pool, lastIds: i.lastIds, random: i.random, lastWeek: i.lastWeek,
        ...(cap !== undefined ? { cap } : {}), favourites, aiChoice: unlocked, ...(this.deps.ask ? { ask: this.deps.ask } : {}),
      });
      return meals;
    } catch { return []; }
  }

  /** "Tauschen": another fitting dish for one meal, from the list at once or, with `ai`, from the AI when it answers. */
  async swap(id: string, week: string, key: string, ai: boolean): Promise<void> {
    if (!this.enabled(id) || !this.deps.noOpenRide() || this.planning) return;
    const d = this.load();
    const plan = d.plans[week];
    const meal = plan?.meals.find((m) => mealKey(m.day, m.slot) === key);
    if (!plan || !meal) return;
    const members = this.members();
    const state = d.states[week] ?? EMPTY_STATE;
    const eatersNow = (k: string) => eatersOf(plan, state, k);
    const slot: Slotted = { day: meal.day, slot: meal.slot, eaters: eatersNow(key), takeAlong: meal.takeAlong, reuseOf: null };
    const reuses = plan.meals.filter((m) => m.reuseOf === key);
    const who = constraintsFor(members, [...new Set([...slot.eaters, ...reuses.flatMap((r) => eatersNow(mealKey(r.day, r.slot)))])]);
    const random = this.deps.random ?? Math.random;
    let dish = null;
    if (ai && this.deps.ask) {
      this.planning = key;
      try {
        const avoid = [...new Set(plan.meals.map((m) => m.dish.title))];
        const raw = await this.deps.ask({ prompt: buildSwapPrompt({ members, slot, training: plan.trainingDays.includes(meal.day), avoid }), systemPrompt: MEAL_SYSTEM_PROMPT, schema: mealAnswerJsonSchema, timeoutMs: SWAP_TIMEOUT_MS });
        const parsed = mealAnswerSchema.safeParse(raw);
        const a = parsed.success ? parsed.data.mahlzeiten[0] : undefined;
        const got = a ? dishFrom(a) : null;
        if (got && !avoid.includes(got.title) && fitsEveryone(got, who.map((m) => m.settings))) dish = got;
      } catch { /* the list takes over */ } finally { this.planning = null; }
    }
    dish ??= listDish(plan, state, members, key, random);
    if (!dish) return;
    // Re-read: the plan may have changed while the AI thought.
    const fresh = this.load().plans[week];
    const target = fresh?.meals.find((m) => mealKey(m.day, m.slot) === key);
    if (!fresh || !target || target.dish.title !== meal.dish.title) return;
    delete target.askedBy;
    putDish(fresh, this.load().states[week] ?? EMPTY_STATE, members, key, dish, random);
    this.save();
    this.exportAll();
  }

  // ---- The chat with the coach ----

  /** A message typed on this Mac. It is answered at once with no ride open, otherwise at the first tick after the ride. */
  async chat(id: string, week: string, text: string): Promise<void> {
    const t = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ').slice(0, CHAT_MAX_CHARS) : '';
    const d = this.load();
    if (!this.enabled(id) || !t || !isWeekKey(week) || !d.plans[week]) return;
    const now = this.deps.nowMs();
    this.keepChat(id, { id: newChatId(now, this.deps.random), week, text: t, atMs: now, reply: null, answeredMs: null, changed: [] });
    this.save();
    this.exportAll();
    if (await this.answerPending()) this.exportAll();
  }

  private keepChat(id: string, c: MealChat): void {
    const d = this.load();
    d.chats[id] = [...(d.chats[id] ?? []).filter((x) => x.id !== c.id), c].sort((a, b) => a.atMs - b.atMs).slice(-CHAT_KEEP);
  }

  /** Answers waiting messages one by one, oldest first, never with a ride open and never next to another AI call. True when one was answered. */
  private async answerPending(): Promise<boolean> {
    let any = false;
    for (let n = 0; n < CHAT_KEEP * 2; n++) {
      if (!this.deps.noOpenRide() || this.planning) return any;
      const d = this.load();
      const next = this.members().flatMap((m) => (d.chats[m.id] ?? []).filter((c) => c.reply === null).map((c) => ({ id: m.id, c }))).sort((a, b) => a.c.atMs - b.c.atMs)[0];
      if (!next) return any;
      await this.answer(next.id, next.c);
      any = true;
    }
    return any;
  }

  private async answer(id: string, msg: MealChat): Promise<void> {
    const now = this.deps.nowMs();
    const current = weekOf(now);
    const random = this.deps.random ?? Math.random;
    const done = (reply: string, changed: string[] = []) => {
      const have = (this.load().chats[id] ?? []).find((c) => c.id === msg.id);
      if (have) this.keepChat(id, { ...have, reply, answeredMs: this.deps.nowMs(), changed });
      this.save();
    };
    if (!this.load().plans[msg.week] || (msg.week !== current && msg.week !== addWeeks(current, 1))) { done(REPLY_NO_PLAN); return; }
    const fromDay = msg.week === current ? dayIndex(now) : 0;
    const input = () => {
      const d = this.load();
      return { members: this.members(), asker: id, plan: d.plans[msg.week]!, state: d.states[msg.week] ?? EMPTY_STATE, fromDay, text: msg.text, history: (d.chats[id] ?? []).filter((c) => c.id !== msg.id) };
    };
    let answer = null;
    if (this.deps.ask) {
      this.planning = 'chat';
      try {
        const raw = await this.deps.ask({ prompt: buildChatPrompt(input()), systemPrompt: CHAT_SYSTEM_PROMPT, schema: chatAnswerJsonSchema, timeoutMs: CHAT_TIMEOUT_MS });
        const parsed = chatAnswerSchema.safeParse(raw);
        if (parsed.success) answer = parsed.data;
      } catch { /* the rules take over */ } finally { this.planning = null; }
    }
    const d = this.load();
    // Re-read after the AI: the plan may have been replanned meanwhile, and every check runs on what is there now.
    if (!d.plans[msg.week]) { done(REPLY_NO_PLAN); return; }
    if (answer) {
      const result: ChatResult = applyChat(input(), answer);
      d.plans[msg.week]!.meals = result.meals;
      if (result.remembered.length) d.settings[id] = { ...this.settings(id), dislikes: [...this.settings(id).dislikes, ...result.remembered] };
      done(result.reply, result.changed);
      return;
    }
    // Without the AI: a plain "Mittwoch Mittag tauschen" swaps from the list, anything else gets a plain answer.
    const key = ruleTarget(msg.text, msg.week === current ? dayIndex(now) : null);
    const plan = d.plans[msg.week]!;
    const meal = key ? plan.meals.find((m) => mealKey(m.day, m.slot) === key) : undefined;
    const dish = meal && meal.day >= fromDay ? listDish(plan, d.states[msg.week] ?? EMPTY_STATE, this.members(), key!, random) : null;
    if (!meal || !dish) { done(REPLY_NO_AI); return; }
    putDish(plan, d.states[msg.week] ?? EMPTY_STATE, this.members(), key!, dish, random);
    meal.askedBy = id;
    done(replySwapped(meal, dish.title), [key!]);
  }

  /**
   * `atMs` is when the change was made, for one applied late (queued while offline): it then only wins against an older entry.
   * Phones' changes are taken in first, so one not merged yet is neither overwritten nor undone.
   */
  setEater(id: string, week: string, key: string, person: string, on: boolean, atMs?: number): void {
    const d = this.load();
    const plan = d.plans[week];
    if (!this.enabled(id) || !plan || !plan.meals.some((m) => mealKey(m.day, m.slot) === key) || !plan.people.some((p) => p.id === person)) return;
    this.importStates();
    this.putState(week, (s) => withEater(s, key, person, on, atMs ?? this.deps.nowMs()), atMs);
  }

  setItem(id: string, week: string, item: string, state: ItemState, atMs?: number): void {
    const d = this.load();
    if (!this.enabled(id) || !d.plans[week] || typeof item !== 'string' || item.length > 120 || !['offen', 'gekauft', 'da'].includes(state)) return;
    this.importStates();
    this.putState(week, (s) => withItem(s, item, state, atMs ?? this.deps.nowMs()), atMs);
  }

  /** A change made now replaces its entry; one made at an earlier `atMs` is merged, so a newer entry stays. */
  private putState(week: string, change: (s: MealState) => MealState, atMs: number | undefined): void {
    const d = this.load();
    const before = d.states[week] ?? EMPTY_STATE;
    d.states[week] = atMs === undefined ? change(before) : mergeStates(before, change(EMPTY_STATE));
    this.save();
    this.exportAll();
  }

  // ---- Sync through the accounts: only for profiles with the plan on and a linked account ----

  private synced(id: string): boolean {
    try { return !!this.deps.store && this.enabled(id) && (this.deps.linked?.(id) ?? false); } catch { return false; }
  }

  /** Changes from phones (shopping ticks, who eats) into the household's state, entry by entry. */
  private importStates(): void {
    const { store } = this.deps;
    if (!store) return;
    const d = this.load();
    let changed = false;
    for (const p of this.deps.profiles()) {
      if (!this.synced(p.id)) continue;
      for (const r of store.all(p.id, 'mealplan')) {
        const w = weekOfRecordId(r.id);
        if (!w || w.part !== 'state' || r.deleted || !d.plans[w.week]) continue;
        const before = d.states[w.week] ?? EMPTY_STATE;
        const merged = mergeStates(before, readMealState(r.body));
        if (JSON.stringify(merged) !== JSON.stringify(before)) { d.states[w.week] = merged; changed = true; }
      }
    }
    if (changed) this.save();
  }

  /** New messages from this person's phone into the chat. True when there was one. */
  private importChats(id: string, have: TrackedRecord[]): boolean {
    const d = this.load();
    const known = new Set((d.chats[id] ?? []).map((c) => c.id));
    const oldest = (d.chats[id] ?? []).length >= CHAT_KEEP ? d.chats[id]![0]!.atMs : -Infinity;
    let any = false;
    for (const r of have) {
      if (r.deleted || !isChatRecordId(r.id) || known.has(r.id)) continue;
      const c = readMealChat(r.id, r.body);
      // A message older than every kept one was trimmed here before; it is not taken in again.
      if (!c || c.atMs < oldest) continue;
      this.keepChat(id, c);
      any = true;
    }
    return any;
  }

  /** The person's recipe list as records, and the newest link requests kept; a recipe whose record the person deleted is removed first. */
  private keepRecipeRecords(id: string, have: TrackedRecord[], recipes: RecipeStore, wanted: Map<string, unknown>, keep: Set<string>): void {
    try {
      this.removeDeletedRecipes(id, have);
      for (const r of recipes.mine(id)) wanted.set(`recipe-${r.id}`, { title: r.title, sourceUrl: shownLink(r), minutes: r.minutes });
      for (const r of have) if (!r.deleted && isFavRecordId(r.id)) keep.add(r.id);
      const requests = have.flatMap((r) => { const q = !r.deleted && isLinkRecordId(r.id) ? readLinkRequest(r.id, r.body) : null; return q ? [{ id: r.id, atMs: q.atMs }] : []; });
      for (const q of requests.sort((a, b) => b.atMs - a.atMs).slice(0, LINK_KEEP)) keep.add(q.id);
      const places = have.flatMap((r) => { const q = !r.deleted && isPlaceRecordId(r.id) ? readPlaceRequest(r.id, r.body) : null; return q ? [{ id: r.id, atMs: q.atMs }] : []; });
      for (const q of places.sort((a, b) => b.atMs - a.atMs).slice(0, LINK_KEEP)) keep.add(q.id);
    } catch { /* the plan's records go on without them */ }
  }

  /** Writes the plan and its state into each synced profile's records, and tombstones what is no longer wanted. Returns the profiles it changed. */
  exportAll(): string[] {
    const { store } = this.deps;
    if (!store) return [];
    const touched: string[] = [];
    const now = this.deps.nowMs();
    const d = this.load();
    const current = weekOf(now);
    const weeks = [current, addWeeks(current, 1)].filter((w) => d.plans[w]);
    for (const p of this.deps.profiles()) {
      try {
        const have = store.all(p.id, 'mealplan');
        // Never on and nothing there: no read beyond this, no write, nothing to send.
        if (!this.synced(p.id) && !have.some((r) => !r.deleted)) continue;
        const wanted = new Map<string, unknown>();
        // Link requests and the person's own recipes are managed apart from the plan: kept, not tombstoned as unknown.
        const keep = new Set<string>();
        const recipes = this.synced(p.id) ? this.recipes() : null;
        if (recipes) this.keepRecipeRecords(p.id, have, recipes, wanted, keep);
        if (this.synced(p.id)) {
          for (const w of weeks) {
            wanted.set(planRecordId(w), { ...d.plans[w], you: p.id });
            wanted.set(stateRecordId(w), d.states[w] ?? EMPTY_STATE);
          }
          // Messages typed on a phone first, so none is taken for an old one and removed before it was read.
          if (this.importChats(p.id, have)) this.save();
          for (const c of d.chats[p.id] ?? []) { const { id: cid, ...body } = c; wanted.set(cid, body); }
        }
        const out: TrackedRecord[] = [];
        for (const [rid, body] of wanted) {
          const r = have.find((x) => x.id === rid);
          if (r && !r.deleted && JSON.stringify(r.body) === JSON.stringify(body)) continue;
          out.push({ kind: 'mealplan', id: rid, updatedMs: Math.max(now, (r?.updatedMs ?? 0) + 1), deleted: false, body });
        }
        for (const r of have) if (!r.deleted && !wanted.has(r.id) && !keep.has(r.id)) out.push({ ...r, updatedMs: Math.max(now, r.updatedMs + 1), deleted: true });
        if (out.length > 0) { store.putMany(p.id, out); touched.push(p.id); }
      } catch { /* the next tick tries again */ }
    }
    if (touched.length > 0) { try { this.deps.onExport?.(touched); } catch { /* a listener never matters here */ } }
    return touched;
  }
}

export const isMealWeek = isWeekKey;
