import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(p, 'utf8');
function files(dir: string, exts: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, exts, out);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

// Sichtbarer Text: JSX-Text zwischen > und < (auch über Zeilen) und String-Literale. Bezeichner wie CoachScreen zählen nicht.
const VISIBLE = /(?:>[^<>{}]*\bCoach(?:es)?\b[^<>{}]*<)|(?:(['"`])(?:(?!\1)[\s\S])*?\bCoach(?:es)?\b(?:(?!\1)[\s\S])*?\1)/g;
const hits = (paths: string[]) =>
  paths.flatMap((f) => [...read(f).replace(/^\s*import .*$/gm, '').matchAll(VISIBLE)].map((m) => `${f}: ${m[0].slice(0, 80)}`));

describe('Sensei wording', () => {
  it('never calls Bo a coach in the web app', () => {
    expect(hits([...files('src/web', ['.ts', '.tsx']), ...files('src/tracking/ui', ['.ts', '.tsx'])])).toEqual([]);
  });
  it('never calls Bo a coach in push and e-mail texts', () => {
    expect(hits([...files('src/coach', ['.ts']), ...files('web-server', ['.ts'])].filter((f) => /push|mail|notif/i.test(f)))).toEqual([]);
  });
  it('takes the fixed Bo texts from one place', () => {
    const kit = read('src/tracking/ui/kit/Dojo.tsx');
    expect(kit).toContain('BO.ask');
    expect(kit).toContain('BO_LINES.seeProposal');
    for (const f of ['src/web/today/CoachLine.tsx', 'src/tracking/ui/CoachScreen.tsx']) {
      expect(read(f)).toContain('<AskBoButton');
      expect(read(f)).not.toContain('Vorschlag ansehen');
    }
  });
  it('tells every persona never to say Coach, and keeps the word out of prompt text', async () => {
    const { CHAT_SYSTEM_PROMPT, WORKOUT_SYSTEM_PROMPT } = await import('../../src/coach/chat/chat-coach');
    const { CHAT_SYSTEM_PROMPT: MEAL_CHAT } = await import('../../src/coach/meals/chat');
    const { SYSTEM_PROMPT } = await import('../../src/coach/coach');
    const { DEBRIEF_SYSTEM_PROMPT } = await import('../../src/coach/debrief');
    const { GYM_SYSTEM_PROMPT } = await import('../../src/coach/gym/prompt');
    const { RUN_SYSTEM_PROMPT } = await import('../../src/coach/run/prompt');
    const { TASKS_GUIDE } = await import('../../src/coach/coach-tasks');
    for (const p of [CHAT_SYSTEM_PROMPT, WORKOUT_SYSTEM_PROMPT, MEAL_CHAT, SYSTEM_PROMPT, DEBRIEF_SYSTEM_PROMPT, GYM_SYSTEM_PROMPT, RUN_SYSTEM_PROMPT]) {
      expect(p).toContain('sag nie "Coach"');
      // Only the instruction itself may name the word.
      expect(p.replace(/sag nie "Coach"/g, '')).not.toMatch(/Coach/);
    }
    expect(TASKS_GUIDE('bike')).not.toMatch(/Coach/);
  });
});

describe('Bo persona in one place', () => {
  it('starts every prompt in Bo\'s voice from BO_PERSONA', async () => {
    const { BO_PERSONA } = await import('../../src/shared/bo');
    const { CHAT_SYSTEM_PROMPT, WORKOUT_SYSTEM_PROMPT } = await import('../../src/coach/chat/chat-coach');
    const { CHAT_SYSTEM_PROMPT: MEAL_CHAT } = await import('../../src/coach/meals/chat');
    const { SYSTEM_PROMPT } = await import('../../src/coach/coach');
    const { DEBRIEF_SYSTEM_PROMPT } = await import('../../src/coach/debrief');
    const { GYM_SYSTEM_PROMPT } = await import('../../src/coach/gym/prompt');
    const { RUN_SYSTEM_PROMPT } = await import('../../src/coach/run/prompt');
    const { DAY_SYSTEM_PROMPT } = await import('../../src/coach/day-text');
    const all = [CHAT_SYSTEM_PROMPT, WORKOUT_SYSTEM_PROMPT, MEAL_CHAT, SYSTEM_PROMPT, DEBRIEF_SYSTEM_PROMPT, GYM_SYSTEM_PROMPT, RUN_SYSTEM_PROMPT, DAY_SYSTEM_PROMPT];
    expect(all).toHaveLength(8);
    for (const p of all) expect(p.startsWith(BO_PERSONA)).toBe(true);
  });
});
