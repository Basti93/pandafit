"""Tests the sync program against a fake Garmin client, with no network at all."""
import datetime as dt
import pathlib
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import garmin_sync as gs  # noqa: E402

TODAY = dt.date(2026, 11, 1)
ENDPOINTS = ["stats", "sleep", "hrv", "max_metrics", "training_status", "training_readiness"]


class GarminConnectTooManyRequestsError(Exception):
    pass


class GarminConnectAuthenticationError(Exception):
    pass


class GarminConnectNotFoundError(Exception):
    pass


class GarminConnectConnectionError(Exception):
    pass


class Fake:
    def __init__(self, activities=5, first="2026-10-20"):
        self.items = [
            {"activityId": 1000 + i, "startTimeGMT": f"2026-10-{20 + i % 10:02d} 08:00:00", "activityType": {"typeKey": "running"}}
            for i in range(activities)
        ]
        self.first = first
        self.calls = []
        self.fail = {}

    def _call(self, key, value):
        self.calls.append(key)
        error = self.fail.get(key)
        if error:
            raise error
        return value

    def get_user_profile(self):
        return self._call("profile", {"connectDate": self.first, "userData": {}})

    def get_cycling_ftp(self):
        return self._call("ftp", {"functionalThresholdPower": 200})

    def get_devices(self):
        return self._call("devices", [])

    def get_activities(self, start, limit):
        return self._call(f"page:{start}", self.items[start:start + limit])

    def download_activity(self, activity_id, dl_fmt=None):
        return self._call(f"file:{activity_id}", b"zipdaten")

    def __getattr__(self, name):
        names = {"get_stats": "stats", "get_sleep_data": "sleep", "get_hrv_data": "hrv", "get_max_metrics": "max_metrics",
                 "get_training_status": "training_status", "get_training_readiness": "training_readiness"}
        if name in names:
            return lambda day: self._call(f"{names[name]}:{day}", {"day": day})
        raise AttributeError(name)


class SyncTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.db = str(pathlib.Path(self.dir.name) / "garmin.db")
        self.now = 1_000_000.0

    def run_sync(self, client, **limits):
        options = {"max_days": 30, "max_files": 20, "force": False, **limits}
        return gs.run_sync(client, self.db, TODAY, options, sleep=lambda _s: None, emit=lambda **_m: None, now=lambda: self.now)

    def rows(self, sql, *args):
        con = sqlite3.connect(self.db)
        try:
            return con.execute(sql, args).fetchall()
        finally:
            con.close()

    def count(self, table):
        return self.rows(f"SELECT COUNT(*) FROM {table}")[0][0]

    def state(self, stream):
        return self.rows("SELECT cursor, complete FROM sync_state WHERE stream = ?", stream)[0]

    def test_all_pages_of_activities_are_stored(self):
        fake = Fake(activities=250)
        self.assertEqual(self.run_sync(fake), 0)
        self.assertEqual(self.count("activities"), 250)
        self.assertEqual(self.state("activities")[1], 1)
        self.assertEqual(self.rows("SELECT sport FROM activities LIMIT 1")[0][0], "running")

    def test_abort_mid_history_resumes_without_gaps_or_duplicates(self):
        fake = Fake(activities=250)
        fake.fail["page:100"] = GarminConnectConnectionError("Netz weg")
        self.assertEqual(self.run_sync(fake), 12)
        self.assertEqual(self.count("activities"), 100)
        fake.fail.clear()
        fake.calls.clear()
        self.assertEqual(self.run_sync(fake), 0)
        self.assertNotIn("page:0", fake.calls)
        self.assertIn("page:100", fake.calls)
        self.assertEqual(self.count("activities"), 250)

    def test_a_second_full_run_adds_no_rows(self):
        fake = Fake()
        self.run_sync(fake)
        before = (self.count("activities"), self.count("daily"), self.count("activity_files"))
        self.run_sync(fake)
        self.assertEqual(before, (self.count("activities"), self.count("daily"), self.count("activity_files")))

    def test_after_completion_only_the_newest_page_is_read(self):
        fake = Fake(activities=250)
        self.run_sync(fake)
        fake.items.insert(0, {"activityId": 9, "startTimeGMT": "2026-11-01 08:00:00", "activityType": {"typeKey": "cycling"}})
        fake.calls.clear()
        self.run_sync(fake)
        self.assertEqual([c for c in fake.calls if c.startswith("page:")], ["page:0"])
        self.assertEqual(self.count("activities"), 251)

    def test_newest_activities_are_followed_over_several_new_pages(self):
        fake = Fake(activities=100)
        self.run_sync(fake)
        fresh = [{"activityId": 5000 + i, "startTimeGMT": "2026-11-01 08:00:00", "activityType": {"typeKey": "cycling"}} for i in range(150)]
        fake.items[:0] = fresh
        self.run_sync(fake)
        self.assertEqual(self.count("activities"), 250)

    def test_abort_while_catching_up_leaves_no_gap(self):
        fake = Fake(activities=100)
        self.run_sync(fake)
        fake.items[:0] = [{"activityId": 5000 + i, "startTimeGMT": "2026-11-01 08:00:00", "activityType": {"typeKey": "cycling"}} for i in range(150)]
        fake.fail["page:100"] = GarminConnectConnectionError("Netz weg")
        self.assertEqual(self.run_sync(fake), 12)
        fake.fail.clear()
        self.assertEqual(self.run_sync(fake), 0)
        self.assertEqual(self.count("activities"), 250)

    def test_days_wait_for_activities_and_files_wait_for_days(self):
        fake = Fake(first="2026-01-01")
        fake.fail["page:0"] = GarminConnectConnectionError("Netz weg")
        self.assertEqual(self.run_sync(fake), 12)
        self.assertEqual(self.count("daily"), 0)
        fake.fail.clear()
        self.run_sync(fake)
        self.assertEqual(self.state("daily")[1], 0)
        self.assertEqual(self.count("activity_files"), 0)

    def test_history_goes_back_to_the_first_day_in_batches(self):
        fake = Fake(activities=0, first="2020-01-01")
        self.run_sync(fake, max_days=30)
        dates = [r[0] for r in self.rows("SELECT DISTINCT date FROM daily ORDER BY date")]
        self.assertEqual(len(dates), 33)
        self.assertEqual(dates[-1], "2026-11-01")
        self.assertEqual(dates[0], "2026-09-30")
        for _ in range(100):
            self.run_sync(fake, max_days=30)
        dates = [r[0] for r in self.rows("SELECT DISTINCT date FROM daily ORDER BY date")]
        self.assertEqual(dates[0], "2020-01-01")
        self.assertEqual(len(dates), (TODAY - dt.date(2020, 1, 1)).days + 1)
        self.assertEqual(self.state("daily")[1], 1)

    def test_an_activity_older_than_the_connect_date_extends_the_history(self):
        fake = Fake(activities=1, first="2026-10-30")
        fake.items[0]["startTimeGMT"] = "2026-10-25 08:00:00"
        self.run_sync(fake)
        self.assertEqual(self.rows("SELECT MIN(date) FROM daily")[0][0], "2026-10-25")

    def test_recent_days_are_fetched_again_each_run(self):
        fake = Fake()
        self.run_sync(fake)
        fake.calls.clear()
        self.run_sync(fake)
        self.assertIn("stats:2026-11-01", fake.calls)
        self.assertIn("stats:2026-10-30", fake.calls)
        self.assertNotIn("stats:2026-10-29", fake.calls)

    def test_a_missing_item_is_noted_retried_and_cleared(self):
        fake = Fake()
        fake.fail["hrv:2026-10-25"] = GarminConnectNotFoundError("404")
        self.assertEqual(self.run_sync(fake), 0)
        self.assertEqual(self.count("fetch_errors"), 1)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM daily WHERE date = '2026-10-25'")[0][0], len(ENDPOINTS) - 1)
        fake.fail.clear()
        self.run_sync(fake)
        self.assertEqual(self.count("fetch_errors"), 0)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM daily WHERE date = '2026-10-25'")[0][0], len(ENDPOINTS))

    def test_a_permanently_missing_item_stops_being_retried(self):
        fake = Fake()
        fake.fail["hrv:2026-10-25"] = GarminConnectNotFoundError("404")
        for _ in range(6):
            self.run_sync(fake)
        self.assertEqual(fake.calls.count("hrv:2026-10-25"), gs.MAX_ATTEMPTS)

    def test_network_failure_does_not_burn_retries_on_items(self):
        fake = Fake()
        fake.fail["stats:2026-10-25"] = GarminConnectConnectionError("Netz weg")
        self.assertEqual(self.run_sync(fake), 12)
        self.assertEqual(self.count("fetch_errors"), 0)
        fake.fail.clear()
        self.assertEqual(self.run_sync(fake), 0)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM daily WHERE date = '2026-10-25'")[0][0], len(ENDPOINTS))

    def test_expired_login_stops_and_keeps_what_was_stored(self):
        fake = Fake(activities=250)
        fake.fail["page:100"] = GarminConnectAuthenticationError("401")
        self.assertEqual(self.run_sync(fake), 10)
        self.assertEqual(self.count("activities"), 100)

    def test_rate_limit_pauses_six_hours_unless_forced(self):
        fake = Fake()
        fake.fail["page:0"] = GarminConnectTooManyRequestsError("429")
        self.assertEqual(self.run_sync(fake), 11)
        fake.fail.clear()
        fake.calls.clear()
        self.assertEqual(self.run_sync(fake), 11)
        self.assertEqual(fake.calls, [])
        self.now += 6 * 3600 + 1
        self.assertEqual(self.run_sync(fake), 0)

    def test_force_ignores_the_pause(self):
        fake = Fake()
        fake.fail["page:0"] = GarminConnectTooManyRequestsError("429")
        self.run_sync(fake)
        fake.fail.clear()
        self.assertEqual(self.run_sync(fake, force=True), 0)

    def test_files_are_stored_in_batches_after_the_days(self):
        fake = Fake(activities=45)
        self.run_sync(fake, max_files=20)
        self.assertEqual(self.count("activity_files"), 20)
        self.assertEqual(self.state("files")[1], 0)
        self.run_sync(fake, max_files=20)
        self.run_sync(fake, max_files=20)
        self.assertEqual(self.count("activity_files"), 45)
        self.assertEqual(self.state("files")[1], 1)
        self.assertEqual(self.rows("SELECT data FROM activity_files LIMIT 1")[0][0], b"zipdaten")

    def test_a_new_activity_gets_its_file_after_completion(self):
        fake = Fake(activities=1)
        self.run_sync(fake)
        fake.items.insert(0, {"activityId": 9, "startTimeGMT": "2026-11-01 08:00:00", "activityType": {"typeKey": "cycling"}})
        self.run_sync(fake)
        self.assertEqual(self.count("activity_files"), 2)

    def test_recent_activities_get_their_files_while_the_days_still_load(self):
        fake = Fake(first="2026-01-01")
        fake.items.insert(0, {"activityId": 9, "startTimeGMT": "2026-10-31 16:52:39", "activityType": {"typeKey": "running"}})
        self.run_sync(fake)
        self.assertEqual(self.state("daily")[1], 0)
        self.assertEqual([r[0] for r in self.rows("SELECT activity_id FROM activity_files")], ["9"])
        fake.calls.clear()
        self.run_sync(fake)
        self.assertNotIn("file:9", fake.calls)

    def test_reset_only_rewinds_one_stream_and_keeps_data(self):
        fake = Fake()
        self.run_sync(fake)
        rows = self.count("daily")
        gs.reset_stream(self.db, "daily")
        self.assertEqual(self.count("daily"), rows)
        self.assertEqual(self.state("activities")[1], 1)
        fake.calls.clear()
        self.run_sync(fake)
        self.assertIn("stats:2026-10-25", fake.calls)
        self.assertEqual(self.count("daily"), rows)

    def test_every_run_is_recorded(self):
        fake = Fake()
        self.run_sync(fake)
        status, ended = self.rows("SELECT status, ended_at FROM sync_runs")[0]
        self.assertEqual(status, "ok")
        self.assertIsNotNone(ended)

    def test_the_final_line_reports_whether_the_history_is_complete(self):
        lines = []
        options = {"max_days": 30, "max_files": 20, "force": False}
        gs.run_sync(Fake(), self.db, TODAY, options, sleep=lambda _s: None, emit=lambda **m: lines.append(m), now=lambda: self.now)
        self.assertEqual(lines[-1]["status"], "ok")
        self.assertTrue(lines[-1]["complete"])
        fresh = str(pathlib.Path(self.dir.name) / "b.db")
        lines.clear()
        gs.run_sync(Fake(first="2020-01-01"), fresh, TODAY, options, sleep=lambda _s: None, emit=lambda **m: lines.append(m), now=lambda: self.now)
        self.assertFalse(lines[-1]["complete"])

    def quick_sync(self, client, lines=None):
        options = {"max_days": 30, "max_files": 20, "force": False, "quick": True}
        emit = (lambda **m: lines.append(m)) if lines is not None else (lambda **_m: None)
        return gs.run_sync(client, self.db, TODAY, options, sleep=lambda _s: None, emit=emit, now=lambda: self.now)

    def test_quick_stores_only_new_activities(self):
        fake = Fake(activities=3)
        self.run_sync(fake)
        daily = self.count("daily")
        fake.items[:0] = [{"activityId": 7000 + i, "startTimeGMT": "2026-11-01 08:00:00", "activityType": {"typeKey": "cycling"}} for i in range(2)]
        fake.calls.clear()
        lines = []
        self.assertEqual(self.quick_sync(fake, lines), 0)
        self.assertEqual(self.count("activities"), 5)
        self.assertEqual(self.count("daily"), daily)
        self.assertEqual([c for c in fake.calls if c.split(":")[0] in ("stats", "sleep", "hrv", "profile", "ftp", "devices")], [])
        self.assertNotIn("complete", lines[-1])

    def test_quick_runs_before_backfill_complete(self):
        fake = Fake(activities=250)
        fake.fail["page:100"] = GarminConnectConnectionError("Netz weg")
        self.run_sync(fake)
        fake.fail.clear()
        before = self.state("activities")
        self.assertEqual(before[1], 0)
        fake.items.insert(0, {"activityId": 9, "startTimeGMT": "2026-11-01 08:00:00", "activityType": {"typeKey": "cycling"}})
        self.assertEqual(self.quick_sync(fake), 0)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM activities WHERE activity_id = '9'")[0][0], 1)
        self.assertEqual(self.state("activities"), before)

    def later_run(self, client, days, **limits):
        options = {"max_days": 30, "max_files": 20, "force": False, **limits}
        return gs.run_sync(client, self.db, TODAY + dt.timedelta(days=days), options, sleep=lambda _s: None, emit=lambda **_m: None, now=lambda: self.now)

    def test_days_missed_while_the_mac_was_off_are_fetched(self):
        fake = Fake()
        self.run_sync(fake)
        self.later_run(fake, 10)
        dates = {r[0] for r in self.rows("SELECT DISTINCT date FROM daily")}
        expected = {(TODAY + dt.timedelta(days=i)).isoformat() for i in range(0, 11)}
        self.assertEqual(expected - dates, set())
        self.assertEqual(self.state("daily")[1], 1)

    def test_a_long_absence_is_closed_in_batches_and_not_complete_before(self):
        fake = Fake()
        self.run_sync(fake)
        self.later_run(fake, 60, max_days=20)
        self.assertEqual(self.state("daily")[1], 0)
        self.later_run(fake, 60, max_days=20)
        self.later_run(fake, 60, max_days=20)
        dates = {r[0] for r in self.rows("SELECT DISTINCT date FROM daily")}
        expected = {(TODAY + dt.timedelta(days=i)).isoformat() for i in range(0, 61)}
        self.assertEqual(expected - dates, set())
        self.assertEqual(self.state("daily")[1], 1)

    def test_an_abort_while_closing_the_gap_resumes_there(self):
        fake = Fake()
        self.run_sync(fake)
        fake.fail["stats:2026-11-05"] = GarminConnectConnectionError("Netz weg")
        self.assertEqual(self.later_run(fake, 10), 12)
        fake.fail.clear()
        self.assertEqual(self.later_run(fake, 10), 0)
        dates = {r[0] for r in self.rows("SELECT DISTINCT date FROM daily")}
        self.assertIn("2026-11-05", dates)
        self.assertIn("2026-11-07", dates)

    def test_a_singleton_is_stored_as_raw_json(self):
        self.run_sync(Fake())
        names = {r[0] for r in self.rows("SELECT name FROM singletons")}
        self.assertEqual(names, {"profile", "ftp", "devices"})

    def test_the_tool_does_not_import_the_app(self):
        source = pathlib.Path(gs.__file__).read_text(encoding="utf-8")
        self.assertNotIn("src/", source)
        self.assertNotIn("bike-coach", source)


if __name__ == "__main__":
    unittest.main()
