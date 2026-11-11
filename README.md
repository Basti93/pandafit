<p align="center"><img src="src/web/public/icons/icon-512.png" alt="Pandafit icon: a panda with a headband" width="128"></p>

# Pandafit

Training for two people across cycling, strength, running and mobility. A Mac app rides the smart trainer, a phone web app tracks strength workouts and runs, and an AI coach plans the week across all sports and can be talked to in a chat.

- **Mac app:** only for the bike: controls the smart trainer over Bluetooth, records every ride crash-safe and shows the next ride and a short summary. Everything else (strength, running, meals, statistics, history, settings) is in the web app.
- **Phone web app (PWA):** strength workouts in the gym, the week plan with the coach chat, runs, meals and stats. Works offline and syncs when it can.
- **Home server (optional):** the sync API for the phone, plus the coach in its own container, so the coach answers while the Mac is off.

The code and docs are in English. The app's interface and coach texts are in German.

Top rule: A ride is never lost. A ride depends neither on the internet, the home server or the AI, nor on the interface.

## Screenshots

With made-up demo data.

| Start page with coach | During a ride | Shared overview |
|---|---|---|
| ![Start page with the next session and the coach](docs/images/coach.png) | ![Ride screen with power target, power and heart rate](docs/images/ride.png) | ![Shared overview of two riders](docs/images/together.png) |

## What it does

**Coach for the whole week**

- **Week plan and chat:** One coach knows all sports. Tell it "Freitag bin ich sicher im Studio" or "mein Knie zwickt", and it proposes a week plan that you accept or decline. It keeps at most two hard days, no hard day right after legs, and remembers complaints until you say they are gone.
- **Long-term progress:** fitter, faster, stronger, more muscle. The coach keeps the direction in mind but stays flexible when a week or two does not go to plan.
- **Monthly review:** on the last Sunday of the month, the coach looks back over three months in the chat: encouraging, at most three observations, a question about open complaints and a suggestion for the next weeks. After a long break or a change of sports it comes early. On by default, can be switched off per person.
- **How hard:** each person chooses "Vorsichtig", "Normal" or "Fordere mich". Careful means no sets to failure; an open complaint makes training careful by itself.
- **Fixed section (optional):** the review can propose 4 to 6 weeks with fixed templates, core exercises and a lighter last week. You take it with one tap or "machen wir" and can undo it. If the weeks drift from the plan, the coach asks whether to plan loosely again. You can end it in the chat at any time. Without a section, planning stays flexible from session to session.
- **Only when you want it:** a weekly conversation on Sunday evening and a note the evening before a session. Both are off by default and can be switched on per person.

**On the phone**

- **Strength:** plan of the day with a preview, routines, sets with last values, rest timer, an optional "how much was left?" question that drives the progression, exercise pictures and descriptions. The plan counts sets per muscle, takes the order of exercises into account (a muscle that is already tired gets a lower load) and never repeats the same execution twice. Sets stay editable in the overview, and "+" adds a set right there. During a workout you can ask the coach ("Gerät belegt", "nur noch 30 Minuten"); its change only applies after you confirm it.
- **Running (optional):** a calm run plan with heart-rate caps, runs from Garmin or entered by hand, easy pace over 4 and 12 weeks, a weekly look back.
- **Meals (optional):** a weekly meal plan per person.
- **Stats:** a progress card (FTP and W/kg, easy pace, estimated maxima, muscle groups within their target), this week's minutes and hard days, sets per muscle over the last four weeks.
- **Push notifications** for a new version, a new meal or run week, and a coach message.

**On the Mac**

- **Riding:** Power targets on the trainer, climb segments with a gentle start, live heart rate and cadence, an overview with charts after the ride, FIT export.
- **Bike coach:** Plans the next session within fixed guardrails, follows the week plan, responds to notes, remembers complaints and motivations. Without AI, a rule set takes over.
- **Heart rate:** Five zones from maximum heart rate, display during the ride and power reduction in segments with a set zone. In a session that holds a heart rate, the power follows it slowly within narrow limits.
- **Progress:** Best power per duration, training load, and a comparison only with your own similar rides: same power, fewer beats.
- **Garmin (optional):** Recovery, other sports and profile values from Garmin Connect. The access is unofficial and can break at any time. Nothing is uploaded to Garmin without asking first.
- **Hevy (optional):** Each person can add their own Hevy API key in the app to import strength workouts. Without it, everything works with the app's own tracking.
- **Troubleshooting:** A local log of the last three days and a problem report that stays on your Mac.
- **Mountains:** Climb a real pass such as Alpe d'Huez across your rides, as a large profile on the ride screen. Your power moves you up, the trainer keeps following the session. Can be switched off.
- **More:** Dutch vocabulary in quiet phases, multiple profiles, a shared overview, movie mode, mobility sessions after rides and strength days.

The training recommendations are not medical advice. Limits and own settings are described in [`docs/hr-zones.md`](docs/hr-zones.md), [`docs/motivation.md`](docs/motivation.md) and [`docs/ftp-estimate.md`](docs/ftp-estimate.md).

## Setup

Ask your AI LOL

The rest of this section is what it will need.

### Requirements

- macOS on Apple silicon and Node.js. Developed with Node 26.
- A Bluetooth FTMS trainer. Built for Zwift Hub One, Polar chest strap and Zwift Click.
- For the AI: [Claude Code](https://claude.com/claude-code) as `claude` on the path (on the Mac, or in the coach container on the server).
- For the phone app: a server with Docker. [`web-server/README.md`](web-server/README.md) describes the setup with a Tailscale node and Funnel; the deploy files contain no host names or secrets.
- For Garmin, optional:

  ```bash
  V="$HOME/Library/Application Support/bike-coach/garmin"
  python3 -m venv "$V/venv" && "$V/venv/bin/pip" install "garminconnect[workout]==0.3.20"
  ```

### Getting started

```bash
npm install
npm run dev       # with real devices
npm run dev:sim   # without a bike: simulates trainer and strap
npm run dev:web   # the phone web app locally
```

To build the finished app and install it to `/Applications`, never during an open ride:

```bash
npm run app
```

The app is only ad hoc signed and is therefore meant for your own Mac. There are deliberately no prebuilt downloads, see [`NOTICE.md`](NOTICE.md).

## Checks

```bash
npm test            # main tests
npm run test:chaos  # crash and failure tests
npm run test:garmin # Garmin fetch (Python)
npm run test:web-smoke # the phone app in a real browser against a real server
npm run typecheck
```

## Data

On the Mac, everything is stored locally in `~/Library/Application Support/bike-coach/` (the project's old name, kept so existing data stays where it is): rides under `rides/`, FIT files under `rides/exports/`, the device log under `rides/diagnostics/`, problem reports under `rides/reports/`, coach state under `coach/`, Garmin data under `garmin/`. With an account link, finished rides also go to your home server after the ride, and a Mac without rides gets them back from there. Without a link, everything runs locally.

The phone keeps its entries on the device (IndexedDB) and sends them to the home server when there is a connection. On the server, the Hevy key and Garmin tokens are stored encrypted (AES-256-GCM) with a key from the server's `.env`; this protects backups, not a running server.

The app does not back up the Mac's local data. The scripts under `web-server/mac/` only fetch the server's backups.

## Structure

| Folder | Contents |
|---|---|
| `src/main` | Electron main process, monitors the services and restarts them |
| `src/service` | Ride service: Bluetooth, recording, ride logic |
| `src/coach` | Coaches (bike, strength, run, mobility, meals, week chat), Garmin and Hevy, analysis |
| `src/ui` | Mac interface (React): pairing, ride, summary, profile |
| `src/tracking` | Screens shared by the Mac and the phone: strength, week, running, stats |
| `src/web` | Phone web app (PWA, service worker, offline storage) |
| `src/shared` | Shared types and rules |
| `scripts/garmin` | Garmin fetch in Python |
| `web-server` | Home server: sync API for the phone and the coach container (Docker, SQLite) |

Rules for changes during a running ride are in [`CLAUDE.md`](CLAUDE.md).

## Contributing

This is a personal project shared as is. Contributions are not being accepted: issues are off and pull requests are limited to collaborators. Forks are welcome under the licence.

To get in touch, write to the owner through their GitHub profile: https://github.com/Basti93. Please report security issues as described in [`SECURITY.md`](SECURITY.md).

## Licence

The project's own code is under the [MIT licence](LICENSE). The word list, the exercise descriptions (partly from [wger](https://wger.de), CC BY-SA) and dependencies are excepted, see [`NOTICE.md`](NOTICE.md).

This project is independent and not affiliated with Garmin, Zwift, Polar or Anthropic. The trademarks belong to their owners.
