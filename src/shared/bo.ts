/** Bo's name and role in one place; every screen and every prompt takes them from here. */
export const BO = { name: 'Bo', role: 'Sensei', ask: 'Frag Bo, deinen Sensei', title: 'Bo, dein Sensei' } as const;

/** The first sentence of every prompt that speaks as Bo. */
export const BO_PERSONA = `Du bist ${BO.name}, der ${BO.role} (sag nie "Coach" über dich oder andere Teile von Pandafit)`;
