# Garmin database

A standalone SQLite file per profile: `~/Library/Application Support/bike-coach/garmin/data/<profileId>/garmin.db`. It contains Garmin's raw data as JSON, so new analyses need no new fetch. The program `scripts/garmin/garmin_sync.py` knows nothing about the app, and the app only reads the file.

## Usage

```bash
V="$HOME/Library/Application Support/bike-coach/garmin"
"$V/venv/bin/python" scripts/garmin/garmin_sync.py --tokens "$V/tokens/<profileId>" --db "$V/data/<profileId>/garmin.db"
```

| Option | Effect |
|---|---|
| `--max-days 30` | Older days per run |
| `--max-files 20` | Original files per run |
| `--reset activities\|daily\|files` | Rewind a data stream; data is kept and gets overwritten |
| `--force` | Skip the pause after a block |

Exit codes: `0` done, `10` new login required, `11` block, `12` other error, e.g. no network. Tests: `npm run test:garmin`.

## Flow

A run fetches profile, FTP and devices, then the activities, then the last 3 days and older days, and finally original files. Days wait until all activities are in, files wait for all days. Each entry is saved immediately. The run can be repeated any number of times and resumes from the state in `sync_state`. Days that fall between two runs, for example because the computer was off, are caught up by the `forward` stream. A missing single value is recorded in `fetch_errors` and tried at most 3 times.

## Tables

| Table | Contents |
|---|---|
| `daily(date, endpoint, json, fetched_at)` | Daily values. Endpoints: `stats`, `sleep`, `hrv`, `max_metrics`, `training_status`, `training_readiness` |
| `activities(activity_id, start_time, sport, json, fetched_at)` | Activities, `start_time` in GMT. The JSON of the list holds, when the watch recorded them, `hrTimeInZone_1` to `_5` (seconds per heart rate zone) and `moderateIntensityMinutes` / `vigorousIntensityMinutes`; the intensity view reads them (`GarminActivity.hrZoneS`, `moderateMin`, `vigorousMin`). Without them it falls back to the average heart rate against the person's zones (`src/shared/hr-zones.ts`), and without heart rate to the whole duration as moderate. |
| `activity_files(activity_id, format, data, fetched_at)` | Original file as a ZIP containing the FIT file |
| `singletons(name, json, fetched_at)` | Current state of `profile`, `ftp`, `devices` |
| `sync_state(stream, cursor, complete, updated_at)` | State per stream, `pause` holds the end of a block |
| `fetch_errors(key, error, attempts, at)` | Individual errors |
| `sync_runs(id, started_at, ended_at, status, stats)` | Log of the runs |

## Examples

```sql
-- Hours per year and sport
SELECT substr(start_time, 1, 4) AS year, sport, ROUND(SUM(json_extract(json, '$.duration')) / 3600, 1) AS hours
FROM activities GROUP BY year, sport ORDER BY year, hours DESC;

-- Resting heart rate over the last 30 days
SELECT date, json_extract(json, '$.restingHeartRate') FROM daily
WHERE endpoint = 'stats' ORDER BY date DESC LIMIT 30;
```
