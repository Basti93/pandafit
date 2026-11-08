#!/usr/bin/env python3
"""Mirrors Garmin Connect data into a standalone SQLite database.

Runs on its own, knows no application and stores raw data. Every entry is committed immediately,
the position of each data stream is kept in sync_state: an abort loses at most the entry in
progress, and the next run continues there. Schema and usage: docs/garmin-data.md.
"""
import argparse
import datetime as dt
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

PAGE_SIZE = 100
RECENT_DAYS = 3
# New activities get their file at once, so the coach sees a fresh run in detail; older ones wait for the days.
RECENT_FILE_DAYS = 7
RETRY_PER_RUN = 50
MAX_ATTEMPTS = 3
PAUSE_S = 6 * 3600
PAGE_PAUSE_S = 2
ITEM_PAUSE_S = 1
EXIT_OK, EXIT_REAUTH, EXIT_RATE, EXIT_FAILED = 0, 10, 11, 12
STREAMS = ("activities", "daily", "files")

DAILY = {
    "stats": "get_stats",
    "sleep": "get_sleep_data",
    "hrv": "get_hrv_data",
    "max_metrics": "get_max_metrics",
    "training_status": "get_training_status",
    "training_readiness": "get_training_readiness",
}
SINGLETONS = {"profile": "get_user_profile", "ftp": "get_cycling_ftp", "devices": "get_devices"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS daily (date TEXT NOT NULL, endpoint TEXT NOT NULL, json TEXT NOT NULL, fetched_at TEXT NOT NULL, PRIMARY KEY (date, endpoint));
CREATE TABLE IF NOT EXISTS activities (activity_id TEXT PRIMARY KEY, start_time TEXT, sport TEXT, json TEXT NOT NULL, fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activity_files (activity_id TEXT PRIMARY KEY, format TEXT NOT NULL, data BLOB NOT NULL, fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS singletons (name TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_state (stream TEXT PRIMARY KEY, cursor TEXT, complete INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fetch_errors (key TEXT PRIMARY KEY, error TEXT NOT NULL, attempts INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, stats TEXT);
"""


class Stop(Exception):
    """Ends the run with an exit code; what has been saved stays."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def classify(error):
    """auth and rate end the run, abort does too without using up an attempt, item affects only this entry."""
    name = type(error).__name__
    status = getattr(getattr(error, "response", None), "status_code", None)
    if "TooManyRequests" in name or status in (427, 429):
        return "rate"
    if "Authentication" in name or status in (401, 403):
        return "auth"
    if "NotFound" in name or status in (400, 404):
        return "item"
    if "ConnectionError" in name or "Timeout" in name or (status is not None and status >= 500):
        return "abort"
    return "item"


def describe(error):
    """Only type and status; the text could contain login credentials."""
    status = getattr(getattr(error, "response", None), "status_code", None)
    return f"{type(error).__name__}:{status}" if status else type(error).__name__


def connect(db_path):
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    con = sqlite3.connect(path, timeout=30, isolation_level=None)
    con.execute("PRAGMA journal_mode = WAL")
    con.executescript(SCHEMA)
    os.chmod(path, 0o600)
    return con


def reset_stream(db_path, stream):
    """Rewinds a data stream. The data stays, a new run overwrites it."""
    if stream not in STREAMS:
        raise ValueError(f"Unbekannter Datenstrom: {stream}")
    con = connect(db_path)
    try:
        prefix = {"daily": "daily|", "files": "file|", "activities": "none|"}[stream]
        con.execute("DELETE FROM fetch_errors WHERE key LIKE ?", (f"{prefix}%",))
        con.execute("DELETE FROM sync_state WHERE stream = ?", (stream,))
        if stream == "daily":
            con.execute("DELETE FROM sync_state WHERE stream = 'forward'")
    finally:
        con.close()


class Sync:
    def __init__(self, client, con, today, options, sleep, emit, now):
        self.client, self.con, self.today, self.options = client, con, today, options
        self.sleep, self.emit, self.now = sleep, emit, now
        self.stats = {"activities": 0, "days": 0, "files": 0, "errors": 0}

    def stamp(self):
        return dt.datetime.fromtimestamp(self.now(), dt.timezone.utc).isoformat()

    def get_state(self, stream):
        row = self.con.execute("SELECT cursor, complete FROM sync_state WHERE stream = ?", (stream,)).fetchone()
        return row if row else (None, 0)

    def set_state(self, stream, cursor, complete):
        self.con.execute(
            "INSERT INTO sync_state VALUES (?, ?, ?, ?) ON CONFLICT(stream) DO UPDATE SET cursor = excluded.cursor, complete = excluded.complete, updated_at = excluded.updated_at",
            (stream, None if cursor is None else str(cursor), int(complete), self.stamp()),
        )

    def fetch(self, key, call):
        """Fetches one entry. Returns (True, value) or records a single-entry error."""
        try:
            value = call()
        except Exception as error:  # noqa: BLE001 - classify decides
            kind = classify(error)
            if kind == "rate":
                self.set_state("pause", self.now() + PAUSE_S, False)
                raise Stop(EXIT_RATE) from None
            if kind == "auth":
                raise Stop(EXIT_REAUTH) from None
            if kind == "abort":
                raise Stop(EXIT_FAILED) from None
            self.stats["errors"] += 1
            self.con.execute(
                "INSERT INTO fetch_errors VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET error = excluded.error, attempts = attempts + 1, at = excluded.at",
                (key, describe(error), self.stamp()),
            )
            return False, None
        self.con.execute("DELETE FROM fetch_errors WHERE key = ?", (key,))
        return True, value

    def store_activity(self, item):
        self.con.execute(
            "INSERT INTO activities VALUES (?, ?, ?, ?, ?) ON CONFLICT(activity_id) DO UPDATE SET start_time = excluded.start_time, sport = excluded.sport, json = excluded.json, fetched_at = excluded.fetched_at",
            (str(item["activityId"]), item.get("startTimeGMT"), (item.get("activityType") or {}).get("typeKey"), json.dumps(item), self.stamp()),
        )
        self.stats["activities"] += 1

    def singletons(self):
        for name, method in SINGLETONS.items():
            ok, value = self.fetch(f"single|{name}", getattr(self.client, method))
            if ok:
                self.con.execute(
                    "INSERT INTO singletons VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
                    (name, json.dumps(value), self.stamp()),
                )

    def page(self, offset):
        ok, items = self.fetch(f"page|{offset}", lambda: self.client.get_activities(offset, PAGE_SIZE))
        if not ok:
            raise Stop(EXIT_FAILED)
        return items or []

    def activities(self):
        cursor, complete = self.get_state("activities")
        if complete:
            self.catch_up()
            return
        offset = int(cursor or 0)
        while True:
            items = self.page(offset)
            for item in items:
                self.store_activity(item)
            offset += len(items)
            finished = len(items) < PAGE_SIZE
            self.set_state("activities", offset, finished)
            self.emit(stream="activities", stored=offset, complete=finished)
            if finished:
                return
            self.sleep(PAGE_PAUSE_S)

    def catch_up(self):
        """Collect everything new first, then save from old to new: this way an abort leaves no gap."""
        fresh, offset = [], 0
        while True:
            items = self.page(offset)
            known = {
                row[0] for row in self.con.execute(
                    f"SELECT activity_id FROM activities WHERE activity_id IN ({','.join('?' * len(items))})",
                    [str(i["activityId"]) for i in items],
                )
            } if items else set()
            fresh.extend(i for i in items if str(i["activityId"]) not in known)
            if known or len(items) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
            self.sleep(PAGE_PAUSE_S)
        for item in reversed(fresh):
            self.store_activity(item)

    def first_day(self):
        candidates = []
        row = self.con.execute("SELECT json FROM singletons WHERE name = 'profile'").fetchone()
        connect_date = (json.loads(row[0]) or {}).get("connectDate") if row else None
        parsed = parse_day(connect_date)
        if parsed:
            candidates.append(parsed)
        oldest = self.con.execute("SELECT MIN(start_time) FROM activities").fetchone()[0]
        parsed = parse_day(oldest)
        if parsed:
            candidates.append(parsed)
        return min(candidates) if candidates else None

    def fetch_day(self, day):
        date = day.isoformat()
        for endpoint, method in DAILY.items():
            ok, value = self.fetch(f"daily|{date}|{endpoint}", lambda m=method: getattr(self.client, m)(date))
            if ok:
                self.store_day(date, endpoint, value)
            self.sleep(ITEM_PAUSE_S)
        self.stats["days"] += 1

    def store_day(self, date, endpoint, value):
        self.con.execute(
            "INSERT INTO daily VALUES (?, ?, ?, ?) ON CONFLICT(date, endpoint) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
            (date, endpoint, json.dumps(value), self.stamp()),
        )

    def close_gap(self, floor):
        """Catches up on days between two runs, for example when the computer was off. Returns (used, closed)."""
        start = self.get_state("forward")[0] or self.con.execute("SELECT MAX(date) FROM daily").fetchone()[0]
        if not start:
            return 0, True
        day = dt.date.fromisoformat(start) + dt.timedelta(days=1)
        used = 0
        while day < floor and used < self.options["max_days"]:
            self.fetch_day(day)
            self.set_state("forward", day.isoformat(), False)
            day += dt.timedelta(days=1)
            used += 1
        return used, day >= floor

    def daily(self):
        floor = self.today - dt.timedelta(days=RECENT_DAYS - 1)
        used, closed = self.close_gap(floor)
        for back in range(RECENT_DAYS):
            self.fetch_day(self.today - dt.timedelta(days=back))
        if closed:
            self.set_state("forward", self.today.isoformat(), True)
        cursor_text = self.get_state("daily")[0]
        cursor = dt.date.fromisoformat(cursor_text) if cursor_text else floor
        first = self.first_day() or floor
        done = used
        while cursor > first and done < self.options["max_days"]:
            day = cursor - dt.timedelta(days=1)
            self.fetch_day(day)
            cursor = day
            done += 1
            self.set_state("daily", cursor.isoformat(), closed and cursor <= first)
            self.emit(stream="daily", cursor=cursor.isoformat())
        complete = closed and cursor <= first
        self.set_state("daily", cursor.isoformat(), complete)
        return complete

    def download(self, activity_id):
        kinds = getattr(self.client, "ActivityDownloadFormat", None)
        fmt = {"dl_fmt": kinds.ORIGINAL} if kinds else {}
        ok, data = self.fetch(f"file|{activity_id}", lambda: self.client.download_activity(activity_id, **fmt))
        if ok:
            self.con.execute(
                "INSERT INTO activity_files VALUES (?, 'original-zip', ?, ?) ON CONFLICT(activity_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at",
                (activity_id, data, self.stamp()),
            )
            self.stats["files"] += 1
        self.sleep(ITEM_PAUSE_S)

    MISSING_FILES = """SELECT activity_id FROM activities a WHERE NOT EXISTS (SELECT 1 FROM activity_files f WHERE f.activity_id = a.activity_id)
                       AND NOT EXISTS (SELECT 1 FROM fetch_errors e WHERE e.key = 'file|' || a.activity_id)"""

    def recent_files(self):
        since = (self.today - dt.timedelta(days=RECENT_FILE_DAYS - 1)).isoformat()
        rows = self.con.execute(f"{self.MISSING_FILES} AND start_time >= ? ORDER BY start_time DESC LIMIT ?", (since, self.options["max_files"])).fetchall()
        for (activity_id,) in rows:
            self.download(activity_id)

    def files(self):
        missing = f"{self.MISSING_FILES} ORDER BY start_time DESC"
        # One budget per run: what recent_files already took counts.
        budget = max(0, self.options["max_files"] - self.stats["files"])
        for (activity_id,) in self.con.execute(f"{missing} LIMIT ?", (budget,)).fetchall():
            self.download(activity_id)
        left = self.con.execute(f"SELECT COUNT(*) FROM ({missing})").fetchone()[0]
        self.set_state("files", None, left == 0)

    def retry_errors(self):
        rows = self.con.execute(
            "SELECT key FROM fetch_errors WHERE attempts < ? AND key NOT LIKE 'single|%' AND key NOT LIKE 'page|%' ORDER BY at LIMIT ?",
            (MAX_ATTEMPTS, RETRY_PER_RUN),
        ).fetchall()
        for (key,) in rows:
            parts = key.split("|")
            if parts[0] == "daily" and parts[2] in DAILY:
                _, date, endpoint = parts
                ok, value = self.fetch(key, lambda m=DAILY[endpoint], d=date: getattr(self.client, m)(d))
                if ok:
                    self.store_day(date, endpoint, value)
                self.sleep(ITEM_PAUSE_S)
            elif parts[0] == "file":
                self.download(parts[1])

    def run(self):
        if self.options.get("quick"):
            # Light hourly check: only new activities and their recent files, whatever the backfill state is.
            self.catch_up()
            self.recent_files()
            return
        self.singletons()
        self.activities()
        self.recent_files()
        self.retry_errors()
        if self.daily():
            self.files()


def parse_day(value):
    """Accepts a date with or without a time, as well as milliseconds."""
    if isinstance(value, (int, float)) and value > 0:
        return dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc).date()
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def run_sync(client, db_path, today, options, sleep=time.sleep, emit=lambda **_m: None, now=time.time):
    con = connect(db_path)
    try:
        sync = Sync(client, con, today, options, sleep, emit, now)
        until = sync.get_state("pause")[0]
        if until and float(until) > now() and not options.get("force"):
            emit(status="paused", until=float(until))
            return EXIT_RATE
        run_id = con.execute("INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')", (sync.stamp(),)).lastrowid
        code, status = EXIT_OK, "ok"
        try:
            sync.run()
        except Stop as stop:
            code = stop.code
            status = {EXIT_REAUTH: "reauth", EXIT_RATE: "rate-limit"}.get(code, "failed")
        con.execute("UPDATE sync_runs SET ended_at = ?, status = ?, stats = ? WHERE id = ?", (sync.stamp(), status, json.dumps(sync.stats), run_id))
        if options.get("quick"):
            emit(status=status, **sync.stats)  # no "complete": a quick run must not overwrite the stored state
        else:
            complete = all(sync.get_state(stream)[1] for stream in STREAMS)
            emit(status=status, complete=complete, **sync.stats)
        return code
    finally:
        con.close()


def main():
    parser = argparse.ArgumentParser(description="Spiegelt Garmin-Connect-Daten in eine SQLite-Datenbank.")
    parser.add_argument("--tokens", required=True, help="Ordner mit den Zugangstoken")
    parser.add_argument("--db", required=True, help="Pfad zur Datenbank")
    parser.add_argument("--max-days", type=int, default=30, help="Ältere Tage je Lauf")
    parser.add_argument("--max-files", type=int, default=20, help="Original-Dateien je Lauf")
    parser.add_argument("--force", action="store_true", help="Pause nach einer Sperre übergehen")
    parser.add_argument("--quick", action="store_true", help="Nur neue Aktivitäten abgleichen")
    parser.add_argument("--reset", choices=STREAMS, help="Datenstrom zurückspulen, Daten bleiben")
    args = parser.parse_args()

    out = sys.stdout
    sys.stdout = sys.stderr  # Output from the library must not interfere with the progress lines.

    def emit(**message):
        out.write(json.dumps(message) + "\n")
        out.flush()

    if args.reset:
        reset_stream(args.db, args.reset)
    from garminconnect import Garmin

    client = Garmin()
    try:
        client.login(args.tokens)
    except Exception as error:  # noqa: BLE001 - classify decides
        kind = classify(error)
        emit(status="login-failed", kind=kind)
        return {"rate": EXIT_RATE, "auth": EXIT_REAUTH}.get(kind, EXIT_FAILED)
    return run_sync(client, args.db, dt.date.today(), {"max_days": args.max_days, "max_files": args.max_files, "force": args.force, "quick": args.quick}, emit=emit)


if __name__ == "__main__":
    sys.exit(main())
