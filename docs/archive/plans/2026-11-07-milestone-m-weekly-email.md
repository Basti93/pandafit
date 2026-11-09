# Milestone M: Weekly overview by email

Brief: `docs/roadmap.md`, section "Meilenstein M — Brief".

## Global Constraints

- **Public repo (pandafit):** no email address, token, hostname of the mail service with secrets, or personal data.
  - Tests use invented addresses (`a@example.org`).
  - Tokens are read from env vars set only in the server `.env`.
- No npm install, no new deps, no push, no deploy (Opus deploys).
- A workout is never lost. Mail problems never break the coach loop: catch, log once, retry next scan.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test` and `npm run typecheck` are green.

## Part 1: mail service (private repo `~/Projects/heimserver`, folder `mail/`)

Today the clients have fixed `recipients` in `clients.json`, and the body fields `to`, `cc`, `bcc`, `from` and `recipients` are refused (`server.py` `FORBIDDEN_FIELDS`). Read `mail/README.md` and the tests first.

- **New client option** `"allowRecipient": true`. For such a client, the body may contain `"to": "<one address>"`:
  - a string, not a list;
  - at most 254 chars;
  - a simple strict pattern (one `@`, no whitespace, no CR/LF, no comma or semicolon, a domain with a dot).
- When `to` is given, the mail goes only to it. When it is absent, the client's `recipients` are used as before.
- For clients without the option, `to` stays forbidden. `cc`, `bcc`, `from` and `recipients` stay forbidden for everybody.
- The daily limit and failed attempts count as before. The log line records the recipient's domain only (no full address), plus the status.
- Return `bad_request` with a clear message for an invalid `to`.
- Update `README.md` (Schnittstelle, Client anlegen) and `clients.example.json`, and add tests in `test_server.py`.
- Run `python3 -m unittest`.
- Commit in that repo: `mail: a client may name one recipient per mail when allowed`.
- **Do not deploy and do not touch the server.**

## Part 2: pandafit

### Contact record

- New record kind `contact` (per profile, id `contact`): `{ email: string | null, weekly: boolean, atMs }`.
- Validate it in `validate.ts` with the same pattern as the mail service (a shared helper `isEmail` in `src/shared/contact.ts`).
- Add the kind to `RECORD_KINDS`.
- The coach-side reader follows the existing pattern (`src/coach/tracking/`).

### Profil UI (web `src/web/App.tsx` Profil)

- Row "E-Mail — <address or 'keine'> ›" opens a small sheet with an email input (`type="email"`, `autocomplete="email"`), "Speichern" and "Entfernen" (link).
- It validates with `isEmail` and shows "Bitte gib eine gültige Adresse ein." on a bad value.
- Switch row "Wochenübersicht per E-Mail" with the hint "Sonntagabend: Rückblick und nächste Woche". It is disabled while there is no address.
- Writes go through the normal record put, stamped above the stored `updatedMs`.

### Weekly mail (coach runtime, server side)

- **New `src/coach/weekly-mail.ts`:**
  - `weeklyMailOf({ profileName, lastWeek, nextWeek, notes, openProposals, appUrl })` → `{ subject, text, html }`. It is pure and German.
  - **Subject:** "Deine Woche ab Mo., 9. Nov."
  - **Text, short:**
    - a greeting;
    - "Letzte Woche: 4 Einheiten, 3 Std 10 Min" plus up to 3 change notes ("Zuletzt geändert");
    - "Nächste Woche:" one line per day (the same day texts as the app, `plan-text.ts`), or, without a plan, "Es gibt noch keinen Plan. Frag den Coach in der App.";
    - "In der App wartet ein Vorschlag auf dich." when there is one;
    - the app link.
  - The HTML is the same content with minimal inline styles (no images, no tracking).
  - Reuse the existing helpers for the stats and the week plan; no new numbers.
- **Sending:** `src/coach/mail-client.ts` POSTs `${MAIL_URL}/v1/send` with a Bearer `MAIL_TOKEN`, body `{subject, text, html, to}`. A missing `MAIL_URL` or `MAIL_TOKEN` means mail is off (no error spam).
- **Schedule** (in the runtime scan): for each profile, when the local day is Sunday and the hour is at least `mail.weekly-hour` (register, 18), and the contact has an email and `weekly`, and the coach-side seen file `mail-sent.json` has no entry for this profile and week, then build and send.
  - On `ok`, record the week.
  - On a 4xx, record it too (do not retry a bad address) and log it once.
  - On a 5xx or network error, retry on the next scan, at most every 30 min.
  - The app URL comes from env `PANDAFIT_APP_URL`; without it there is no link line.
- **Compose** (`web-server/compose.yaml`):
  - the coach joins the external network `homeserver-mail` (declare it external like `homeserver-ai`);
  - env `MAIL_URL: http://homeserver-mail:8080`, `MAIL_TOKEN: ${PANDAFIT_MAIL_TOKEN:-}` and `PANDAFIT_APP_URL: ${PANDAFIT_APP_URL:-}`;
  - update `web-server/README.md` (one paragraph: how to enable mail, never commit the token).
- **Admin helper:** the CLI (`web-server/cli.ts`) gets `set-contact <profileName> <email|-> [weekly on|off]`. It writes the contact record for that profile into the store, stamped above the stored one, so it syncs to the devices. This lets Opus set the two addresses on the server without putting them in the repo.

### Tests

- `isEmail` cases.
- The contact record validation.
- The Profil sheet saves and removes, and the switch is disabled without an address.
- `weeklyMailOf`: the subject and lines, the no-plan case, the open proposal line.
- The schedule:
  - not before 18:00 on Sunday;
  - once per week;
  - no address → no send;
  - `weekly` off → no send;
  - a 4xx is recorded; a 5xx retries;
  - mail off without env.
- The CLI `set-contact` writes a record.

### Commits

- `feat(mail): email address in the profile`
- `feat(mail): the weekly overview goes out on Sunday evening`
