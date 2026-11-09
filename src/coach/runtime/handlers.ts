import { createLogger } from '../../shared/node/log';
import type { CoachClientMessage, CoachServerMessage } from '../protocol';
import { handleRecords } from '../tracking/records-api';
import { MealCoach } from '../meals/meal-coach';
import type { RuntimeCtx } from './ctx';

const log = createLogger('runtime');
export const READ_ONLY = new Set<string>(['subscribe', 'records-list', 'ride-detail', 'gym-preview']);

/** What a handler gets besides the message: where to answer and when a change queued offline was made. */
export type Call = { send: (msg: CoachServerMessage) => void; atMs: number | undefined };
export type Handler<T extends CoachClientMessage['type']> = (msg: Extract<CoachClientMessage, { type: T }>, ctx: RuntimeCtx, call: Call) => Promise<void> | void;
export type Handlers = { [T in CoachClientMessage['type']]: Handler<T> };

type WithProfile = { profileId: string };

/** The coach's own writes: the rides are scanned first and every client gets the new view afterwards. */
const coachMsg = <T extends CoachClientMessage['type']>(fn: (m: Extract<CoachClientMessage, { type: T }> & WithProfile, ctx: RuntimeCtx, call: Call) => void): Handler<T> =>
  (m, ctx, call) => {
    ctx.coach.scanRides(ctx.coached());
    fn(m as Extract<CoachClientMessage, { type: T }> & WithProfile, ctx, call);
    ctx.publish();
  };
/** Writes that start a coach run when no ride is open. */
const refreshing = (ctx: RuntimeCtx, id: string): void => { if (ctx.noOpenRide()) ctx.refresh(id); };
/** A request that wants an answer gets its empty one when nothing can be done. */
const emptyAnswer = (m: { type: string }, send: Call['send']): void => {
  if (m.type === 'gym-preview') send({ type: 'gym-preview', preview: null });
  if (m.type === 'gym-confirm') send({ type: 'gym-confirm-result', result: 'failed' });
};
const nothing = (): void => {};

/** Settings, ticks and who eats are local writes and fine with a ride open. Planning and swapping wait for no ride (the coach checks). */
const meals = <T extends CoachClientMessage['type']>(fn: (m: Extract<CoachClientMessage, { type: T }> & WithProfile, meal: MealCoach, atMs: number | undefined, sync: () => void) => void): Handler<T> =>
  (m, ctx, call) => {
    const coach = ctx.mealsNow();
    if (!coach) return;
    const sync = () => ctx.publish();
    fn(m as Extract<CoachClientMessage, { type: T }> & WithProfile, coach, call.atMs, sync);
    sync();
  };

/** Gym writes that need the gym coach switched on. */
const gymOn = <T extends CoachClientMessage['type']>(fn: (m: Extract<CoachClientMessage, { type: T }> & WithProfile, ctx: RuntimeCtx) => void): Handler<T> =>
  (m, ctx) => {
    if (!ctx.gym.enabled((m as WithProfile).profileId)) return;
    fn(m as Extract<CoachClientMessage, { type: T }> & WithProfile, ctx);
    ctx.publish();
  };

export const handlers: Handlers = {
  // The server coach handles a profile update and a queued change itself, before they reach a runtime.
  queued: nothing,
  'profile-update': nothing,
  // Records check the profile themselves and always answer the request.
  'records-put': (m, ctx, { send }) => handleRecordsMessage(m, ctx, send),
  'records-list': (m, ctx, { send }) => handleRecordsMessage(m, ctx, send),
  // The password is only passed on to the server once, never stored, logged or sent back.
  'account-link': (m, ctx) => { void ctx.accountSync.link(m.profileId, m.url, m.name, m.password).catch((e) => log.error('account link', e)).finally(ctx.publish); ctx.publish(); },
  'account-unlink': (m, ctx) => { ctx.accountSync.unlink(m.profileId); ctx.publish(); },
  // The key is only passed on and stored privately, never sent back.
  'hevy-connect': (m, ctx) => { void ctx.hevy.connect(m.profileId, m.key).catch((e) => log.error('hevy connect', e)).finally(ctx.publish); ctx.publish(); },
  'hevy-disconnect': (m, ctx) => { ctx.hevy.disconnect(m.profileId); ctx.publish(); },
  // Login credentials are only passed on, never stored or sent back.
  'garmin-login': (m, ctx) => { ctx.garmin.login(m.profileId, m.email, m.password); },
  'garmin-mfa': (m, ctx) => { ctx.garmin.mfa(m.profileId, m.code); },
  // The profile's sync and upload stop first and keep nothing, so no token of the old login comes back.
  'garmin-disconnect': (m, ctx) => {
    ctx.garminSync.stop(m.profileId); ctx.uploader.stop(m.profileId); ctx.workouts.stop(m.profileId); ctx.garmin.disconnect(m.profileId);
    try { ctx.coach.garminDisconnected(m.profileId); } catch { /* unknown profile */ }
    ctx.publish();
  },

  'gym-forget': (m, ctx) => { ctx.gym.forget(m.profileId); ctx.publish(); },
  'gym-start': (m, ctx) => { ctx.gym.start(m.profileId); ctx.publish(); },
  // Hevy is only read or written with no ride open.
  'gym-preview': (m, ctx, { send }) => {
    if (!ctx.gym.enabled(m.profileId) || !ctx.noOpenRide()) { send({ type: 'gym-preview', preview: null }); return; }
    void ctx.gym.preview(m.profileId).catch(() => null).then((preview) => send({ type: 'gym-preview', preview }));
  },
  'gym-confirm': (m, ctx, { send }) => {
    if (!ctx.gym.enabled(m.profileId) || !ctx.noOpenRide()) { send({ type: 'gym-confirm-result', result: 'failed' }); return; }
    void ctx.gym.confirm(m.profileId, m.name).catch((): 'failed' => 'failed').then((result) => { send({ type: 'gym-confirm-result', result }); ctx.publish(); });
  },
  'gym-adjust': gymOn((m, ctx) => ctx.gym.adjust(m.profileId, m.how)),
  'gym-note': gymOn((m, ctx) => ctx.gym.note(m.profileId, m.text)),
  'gym-answer': gymOn((m, ctx) => ctx.gym.answer(m.profileId, m.question, m.text)),
  'gym-skip-question': gymOn((m, ctx) => ctx.gym.skipQuestion(m.profileId, m.question)),

  'meals-settings': meals((m, c) => c.setSettings(m.profileId, m.settings)),
  'meals-eater': meals((m, c, atMs) => c.setEater(m.profileId, m.week, m.meal, m.person, m.on === true, atMs)),
  'meals-item': meals((m, c, atMs) => c.setItem(m.profileId, m.week, m.item, m.state, atMs)),
  'meals-replan': meals((m, c, _at, sync) => { void c.replan(m.profileId, m.week).catch((e) => log.error('meals replan', e)).finally(sync); }),
  'meals-swap': meals((m, c, _at, sync) => { void c.swap(m.profileId, m.week, m.meal, m.ai === true).catch((e) => log.error('meals swap', e)).finally(sync); }),
  'meals-chat': meals((m, c, _at, sync) => { void c.chat(m.profileId, m.week, m.text).catch((e) => log.error('meals chat', e)).finally(sync); }),

  // Local writes only, also with a ride open: no AI, no Hevy, no Garmin.
  'mobility-done': (m, ctx) => { ctx.mobility.markDone(m.profileId, m.sessionId); ctx.publish(); },
  'mobility-feel': (m, ctx) => { ctx.mobility.feel(m.profileId, m.text); ctx.publish(); },

  subscribe: coachMsg((m, ctx, { send }) => { const v = ctx.view(m.profileId); if (v) send(v); }),
  feedback: coachMsg((m, ctx) => { ctx.coach.feedback(m.profileId, m.rideId, m.rating); refreshing(ctx, m.profileId); }),
  'skip-feedback': coachMsg((m, ctx) => { ctx.coach.skipFeedback(m.profileId); refreshing(ctx, m.profileId); }),
  note: coachMsg((m, ctx) => { ctx.coach.note(m.profileId, m.text); refreshing(ctx, m.profileId); }),
  'complaint-update': coachMsg((m, ctx, { atMs }) => { ctx.coach.updateComplaint(m.profileId, m.id, m.status, atMs); refreshing(ctx, m.profileId); }),
  'answer-question': coachMsg((m, ctx) => { ctx.coach.answerQuestion(m.profileId, m.questionId, m.text); refreshing(ctx, m.profileId); }),
  'skip-question': coachMsg((m, ctx) => ctx.coach.skipQuestion(m.profileId)),
  'debrief-seen': coachMsg((m, ctx) => ctx.coach.debriefSeen(m.profileId)),
  'garmin-upload-settings': coachMsg((m, ctx) => ctx.coach.setUploadMode(m.profileId, m.mode === 'off' ? 'off' : 'ask')),
  'garmin-upload': coachMsg((m, ctx) => ctx.startUpload(m.profileId, m.rideId, m.repoLink === true)),
  'debrief-answer': coachMsg((m, ctx) => { ctx.coach.answerDebrief(m.profileId, m.rideId, m.question, m.text); refreshing(ctx, m.profileId); }),
  'debrief-skip-question': coachMsg((m, ctx) => ctx.coach.skipDebriefQuestion(m.profileId, m.rideId, m.question)),
  'remove-motive': coachMsg((m, ctx) => { ctx.coach.removeMotive(m.profileId, m.atMs); refreshing(ctx, m.profileId); }),
  'set-ftp': coachMsg((m, ctx) => { if (m.ftpW >= 50) { ctx.coach.setFtp(m.profileId, m.ftpW); refreshing(ctx, m.profileId); } }),
  adjust: coachMsg((m, ctx) => ctx.coach.adjustNext(m.profileId, m.how)),
  'skip-ramp': coachMsg((m, ctx) => ctx.coach.skipRamp(m.profileId)),
  'ride-detail': coachMsg((m, ctx, { send }) => {
    const detail = ctx.coach.rideDetail(m.profileId, m.rideId);
    if (detail) send({ type: 'ride-detail', detail });
  }),
  'word-result': coachMsg((m, ctx) => ctx.coach.wordResult(m.profileId, m.nl, m.knew)),
  'pass-select': coachMsg((m, ctx) => ctx.coach.passSelect(m.profileId, m.passId)),
  'pass-progress': coachMsg((m, ctx) => ctx.coach.passProgress(m.profileId, m.passId, m.distanceM)),
  'pass-summit': coachMsg((m, ctx) => ctx.coach.passSummit(m.profileId, m.passId)),
  // Live ride messages are for the relay, not for the coach. They only get the common treatment.
  'live-state': coachMsg(nothing),
  'live-end': coachMsg(nothing),
  'live-ack': coachMsg(nothing),
  'live-command': coachMsg(nothing),
};

const handleRecordsMessage = (m: Extract<CoachClientMessage, { type: 'records-put' | 'records-list' }>, ctx: RuntimeCtx, send: Call['send']): void => {
  if (m.type === 'records-put' && ctx.known(m.profileId)) ctx.accountSync.touch(m.profileId);
  // A finished workout plans the gym here only for a profile coached here; the server plans for a moved one.
  const recordsGym = { start: (id: string) => { if (ctx.coachHere(id)) ctx.gym.start(id); }, workoutFinished: (id: string) => { if (ctx.coachHere(id)) ctx.gym.workoutFinished(id); } };
  const out = handleRecords({ store: ctx.records, gym: recordsGym, profiles: () => ctx.profiles().map((p) => p.id) }, m);
  send(out.reply);
  if (out.changed) {
    ctx.notifyRecords(out.changed);
    ctx.publish();
  }
};

/** Messages that are answered whatever the profile: they check the profile themselves or are not about one. */
const UNGATED = new Set<string>(['queued', 'profile-update', 'records-put', 'records-list']);
/** Account link and unlink also work for a profile the server coaches. They are not counted as a write to sync. */
const ACCOUNT = new Set<string>(['account-link', 'account-unlink']);

export const createHandle = (ctx: RuntimeCtx) => (m: CoachClientMessage, reply: (msg: CoachServerMessage) => void, atMs?: number): void => {
  const send = (msg: CoachServerMessage) => { try { reply(msg); } catch { /* connection gone */ } };
  const call: Call = { send, atMs };
  const run = (): void => { void (handlers[m.type] as Handler<typeof m.type>)(m as never, ctx, call); };
  try {
    if (UNGATED.has(m.type)) { run(); return; }
    // Only this runtime's profiles: a message for any other changes nothing here. A request still gets its empty answer.
    const profileId = (m as { profileId?: unknown }).profileId;
    if (typeof profileId !== 'string' || !ctx.known(profileId)) { emptyAnswer(m, send); return; }
    if (ACCOUNT.has(m.type)) { run(); return; }
    // The server coaches a moved profile; only its meals stay here while the meal plan is local.
    if (!ctx.coachHere(profileId) && !m.type.startsWith('meals-')) { emptyAnswer(m, send); return; }
    if (!READ_ONLY.has(m.type)) ctx.accountSync.touch(profileId);
    run();
  } catch { /* ignore invalid message */ }
};
