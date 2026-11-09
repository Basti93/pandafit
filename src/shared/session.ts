import { z } from 'zod';

const base = { durationS: z.number().positive(), label: z.string(), hrZone: z.number().int().min(1).max(5).optional() };
const stepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('erg'), ftpFraction: z.number().positive(), hrHold: z.boolean().optional(), ...base }),
  z.object({ kind: z.literal('grade'), gradePct: z.number(), scale: z.number().positive(), sudden: z.boolean().optional(), ...base }),
]);
export const sessionSchema = z.object({ id: z.string().min(1), name: z.string(), description: z.string().optional(), steps: z.array(stepSchema).min(1) });

export type Step = z.infer<typeof stepSchema>;
export type Session = z.infer<typeof sessionSchema>;
export const parseSession = (input: unknown): Session => sessionSchema.parse(input);

/**
 * Fraction of FTP at which a section is ridden. Climbs run on a watt target:
 * the Hub One has only one sprocket, so a simulated grade would be far above FTP at normal cadence.
 */
export const stepFtpFraction = (s: Step): number => (s.kind === 'erg' ? s.ftpFraction : Math.max(0.5, 0.55 + (s.gradePct * s.scale) / 20));
