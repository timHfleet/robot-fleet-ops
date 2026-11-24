"""Live fleet simulator.

Every calendar day's activity is generated from a random generator seeded by that date, so a
given day always produces the same data (history is stable across restarts and redeploys),
and `advance()` only writes what has already "happened": episodes, failures and incidents
appear as their start time passes, QA verdicts land when the review is done, robots come back
when the repair is finished. Run it on startup and every few minutes and the dashboard gains a
new day of data every day on its own, with no external database or cron job.
"""
from __future__ import annotations

import random
import sqlite3
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from .db import iso, now_utc

HISTORY_DAYS = 182  # two full 90-day windows, so every range has a previous period to compare with
ANCHOR = date(2026, 11, 13)  # fixed reference for the roster and wear cycles (never move it)

ROBOTS = [("Atlas-01", 14), ("Atlas-02", 14), ("Atlas-03", 14), ("Borealis-04", 16),
          ("Borealis-05", 16), ("Cirrus-06", 12), ("Cirrus-07", 12), ("Delta-08", 18)]

OPERATORS = [
    # name, hired (days before ANCHOR), left (days before ANCHOR or None), hourly cost, proficiency days
    ("Maya Torres", 420, None, 30, 18), ("Jordan Lee", 390, None, 29, 22),
    ("Priya Nair", 360, None, 31, 14), ("Sam Okafor", 330, None, 28, 25),
    ("Lena Fischer", 300, None, 28, 20), ("Diego Alvarez", 280, 40, 27, 31),
    ("Hana Sato", 250, None, 29, 16), ("Chris Morgan", 220, None, 27, 27),
    ("Ava Brooks", 190, None, 28, 19), ("Noah Kim", 160, 12, 26, 35),
    ("Zara Ahmed", 130, None, 28, 21), ("Leo Rossi", 100, None, 27, 24),
    ("Iris Novak", 60, None, 27, 29), ("Theo Grant", 25, None, 26, None),
]

# Weekly targets sit just under full-fleet capacity, so losing a robot or two matters.
TASKS = [("fold_towel", 230), ("load_dishwasher", 190), ("wipe_table", 210),
         ("pick_and_place", 300), ("open_drawer", 170)]
HOMES = ["Maple St", "Harbor View", "Elm Court", "Cedar Loft", "Pine Ridge", "Oak Terrace"]
OBJECTS = ["cup", "towel", "plate", "utensil", "box", "bottle", "sponge"]
LIGHTING = [("daylight", 45), ("warm_indoor", 30), ("dim", 15), ("mixed", 10)]
REJECTIONS = [("grasp_failure", 30), ("occlusion", 20), ("sop_deviation", 18),
              ("robot_fault", 14), ("scene_drift", 10), ("drop", 8)]
FAULTS = [("gripper_jam", 30), ("network_drop", 25), ("camera_dropout", 20),
          ("motor_fault", 15), ("e_stop", 10)]
ROOT_CAUSES = ["Gripper wear", "Cable snag", "Floor obstacle", "Operator handoff",
               "Firmware bug", "Wi-Fi dead zone", "Calibration drift"]
SHIFTS = [("morning", time(6, 0)), ("evening", time(14, 0)), ("overnight", time(22, 0))]

# Repeating wear cycles (robot index -> cycle length, ramp length, peak extra failure factor, offset).
# A robot wears out over the ramp, then gets serviced; the maintenance page always has signals to find.
WEAR_CYCLES = {4: (40, 24, 2.6, 0), 6: (29, 12, 1.0, 11), 1: (53, 15, 1.4, 30)}

SIM_TABLES = ("shifts", "attendance", "operator_sessions", "robot_hours", "robot_failures",
              "incidents", "episodes", "qa_reviews")


def _rng(*parts: object) -> random.Random:
    return random.Random("|".join(str(p) for p in parts))  # str seeds are hashed deterministically


def _pick(rng: random.Random, weighted: list[tuple[str, int]]) -> str:
    return rng.choices([w[0] for w in weighted], weights=[w[1] for w in weighted])[0]


def _at(day: date, t: time, minutes: float) -> datetime:
    return datetime.combine(day, t, tzinfo=timezone.utc) + timedelta(minutes=minutes)


def wear_factor(robot_index: int, day: date) -> float:
    cyc = WEAR_CYCLES.get(robot_index)
    if not cyc:
        return 1.0
    length, ramp, peak, offset = cyc
    phase = ((day - ANCHOR).days + offset) % length
    start = length - ramp
    return 1.0 if phase < start else 1.0 + peak * (phase - start + 1) / ramp


# ---- schema additions ------------------------------------------------------------------------

def ensure_schema(conn: sqlite3.Connection) -> bool:
    """Add sim_key columns/indexes. Returns False if the DB holds legacy (pre-simulator) demo data."""
    legacy = False
    for t in SIM_TABLES:
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({t})")}
        if "sim_key" not in cols:
            if conn.execute(f"SELECT 1 FROM {t} LIMIT 1").fetchone():
                legacy = True
            conn.execute(f"ALTER TABLE {t} ADD COLUMN sim_key TEXT")
        conn.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS ux_{t}_sim_key ON {t}(sim_key)")
    conn.execute("""CREATE TABLE IF NOT EXISTS sim_days (
                      day TEXT PRIMARY KEY, complete INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)""")
    return not legacy


def ensure_roster(conn: sqlite3.Connection) -> tuple[list[int], list[dict]]:
    for name, cost in ROBOTS:
        if not conn.execute("SELECT 1 FROM robots WHERE name = ?", (name,)).fetchone():
            conn.execute("INSERT INTO robots (name, cost_per_hour) VALUES (?, ?)", (name, cost))
    for task, target in TASKS:
        conn.execute("INSERT OR IGNORE INTO task_targets (task, weekly_target) VALUES (?, ?)", (task, target))
    for name, hire, exit_, cost, prof in OPERATORS:
        if not conn.execute("SELECT 1 FROM operators WHERE name = ?", (name,)).fetchone():
            conn.execute(
                "INSERT INTO operators (name, hire_date, exit_date, hourly_cost, proficiency_days) VALUES (?, ?, ?, ?, ?)",
                (name, (ANCHOR - timedelta(days=hire)).isoformat(),
                 (ANCHOR - timedelta(days=exit_)).isoformat() if exit_ else None, cost, prof))
    robot_ids = [conn.execute("SELECT id FROM robots WHERE name = ?", (n,)).fetchone()[0] for n, _ in ROBOTS]
    ops = []
    for name, *_ in OPERATORS:
        r = conn.execute("SELECT id, name, hire_date, exit_date FROM operators WHERE name = ?", (name,)).fetchone()
        ops.append(dict(r))
    return robot_ids, ops


# ---- one day's plan --------------------------------------------------------------------------

@dataclass
class DayPlan:
    shifts: list = field(default_factory=list)
    attendance: list = field(default_factory=list)
    sessions: list = field(default_factory=list)
    robot_hours: list = field(default_factory=list)
    failures: list = field(default_factory=list)
    incidents: list = field(default_factory=list)
    episodes: list = field(default_factory=list)
    settles_at: datetime | None = None  # when the last outcome of this day is known


def plan_day(day: date, robot_ids: list[int], ops: list[dict]) -> DayPlan:
    ds = day.isoformat()
    weekend = day.weekday() >= 5
    p = DayPlan()
    last = _at(day, time(0, 0), 24 * 60)

    for shift, _ in SHIFTS:
        r = _rng("shift", ds, shift)
        planned = r.randint(3, 4) if weekend else r.randint(4, 6)
        filled = max(0, planned - r.choices([0, 1, 2], weights=[70, 24, 6])[0])
        p.shifts.append((f"s|{ds}|{shift}", ds, shift, planned, filled))

    for idx, rid in enumerate(robot_ids):
        r = _rng("robot", ds, idx)
        wear = wear_factor(idx, day)
        scheduled = 16.0
        ready = round(scheduled - max(0.0, r.gauss(1.2 * wear, 1.0)), 2)
        operating = round(ready * r.uniform(0.85, 0.95), 2)
        collecting = round(operating * r.uniform(0.55, 0.8), 2)
        p.robot_hours.append((f"rh|{ds}|{idx}", rid, ds, scheduled, ready, operating, collecting))
        for k in range(2):  # up to two failures a day on a badly worn robot
            if r.random() < (0.16 * wear if k == 0 else 0.03 * wear):
                failed = _at(day, time(6, 0), r.uniform(0, 16 * 60))
                repair = r.uniform(8, 150) * wear ** 0.6
                if r.random() < 0.06:  # occasional long outage waiting on parts
                    repair = r.uniform(4, 20) * 60
                recovered = failed + timedelta(minutes=repair)
                p.failures.append(dict(key=f"f|{ds}|{idx}|{k}", robot_id=rid, failed=failed,
                                       recovered=recovered, fault=_pick(r, FAULTS)))
                last = max(last, recovered)

    r = _rng("incident", ds)
    if r.random() < 0.33:
        occurred = _at(day, time(6, 0), r.uniform(0, 16 * 60))
        detected = occurred + timedelta(minutes=r.uniform(1, 12))
        responded = detected + timedelta(minutes=r.uniform(4, 30))
        resolved = responded + timedelta(minutes=r.uniform(15, 160))
        known = r.random() < 0.8
        p.incidents.append(dict(
            key=f"i|{ds}", robot_id=r.choice(robot_ids), occurred=occurred, detected=detected,
            responded=responded, resolved=resolved,
            severity=_pick(r, [("minor", 65), ("major", 28), ("critical", 7)]),
            near_miss=1 if r.random() < 0.3 else 0, root_cause=r.choice(ROOT_CAUSES) if known else None,
            known=1 if known else 0))
        last = max(last, resolved)

    for oi, o in enumerate(ops):
        if o["hire_date"] > ds or (o["exit_date"] and o["exit_date"] < ds):
            continue
        prof = _rng("operator", o["name"])
        skill, quality = prof.uniform(0.8, 1.2), prof.uniform(0.78, 0.95)
        r = _rng("op", ds, o["name"])
        scheduled = 1 if (not weekend or r.random() < 0.3) else 0
        present = 1 if scheduled and r.random() < 0.93 else 0
        p.attendance.append((f"a|{ds}|{oi}", o["id"], ds, scheduled, present))
        if not present:
            continue
        paid = 480.0
        collecting = r.uniform(250, 330) * min(skill, 1.1)
        reset = r.uniform(50, 95)
        waiting = max(0.0, paid - collecting - reset - 30)
        audited = 1 if r.random() < 0.25 else 0
        passed = 1 if audited and r.random() < 0.85 else 0
        p.sessions.append((f"o|{ds}|{oi}", o["id"], ds, paid, round(collecting, 1), round(reset, 1),
                           round(waiting, 1), audited, passed))

        shift_start = SHIFTS[o["id"] % 3][1]
        robot = robot_ids[o["id"] % len(robot_ids)]
        n = max(int(r.gauss(22, 3) * skill), 0)
        t = 0.0
        for e in range(n):
            c = round(r.uniform(6, 14), 1)
            rs = round(r.uniform(1.5, 4.0), 1)
            started = _at(day, shift_start, t)
            t += c + rs
            review_delay = timedelta(hours=r.uniform(1.5, 36))
            accepted = r.random() < quality
            reason = None if accepted else _pick(r, REJECTIONS)
            double = r.random() < 0.08
            agree = r.random() < 0.9
            p.episodes.append(dict(
                key=f"e|{ds}|{oi}|{e}", op=o["id"], robot=robot, task=r.choice(TASKS)[0], home=r.choice(HOMES),
                obj=r.choice(OBJECTS), lighting=_pick(r, LIGHTING), started=started, collect=c, reset=rs,
                reviewed=started + review_delay, status="accepted" if accepted else "rejected", reason=reason,
                double=double, agree=agree))
            last = max(last, started + review_delay)
    p.settles_at = last
    return p


# ---- writing what has happened so far --------------------------------------------------------

def _apply(conn: sqlite3.Connection, p: DayPlan, now: datetime) -> None:
    conn.executemany("INSERT OR IGNORE INTO shifts (sim_key, day, shift, planned_operators, filled_operators) "
                     "VALUES (?, ?, ?, ?, ?)", p.shifts)
    conn.executemany("INSERT OR IGNORE INTO attendance (sim_key, operator_id, day, scheduled, present) "
                     "VALUES (?, ?, ?, ?, ?)", p.attendance)
    conn.executemany("""INSERT OR IGNORE INTO operator_sessions (sim_key, operator_id, day, paid_minutes,
                        collecting_minutes, reset_minutes, waiting_minutes, sop_audited, sop_passed)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", p.sessions)
    conn.executemany("""INSERT OR IGNORE INTO robot_hours (sim_key, robot_id, day, scheduled_hours, ready_hours,
                        operating_hours, collecting_hours) VALUES (?, ?, ?, ?, ?, ?, ?)""", p.robot_hours)

    def seen(t: datetime | None) -> str | None:
        return iso(t) if t is not None and t <= now else None

    for f in p.failures:
        if f["failed"] > now:
            continue
        conn.execute("INSERT OR IGNORE INTO robot_failures (sim_key, robot_id, failed_at, recovered_at, fault_code) "
                     "VALUES (?, ?, ?, ?, ?)", (f["key"], f["robot_id"], iso(f["failed"]), seen(f["recovered"]), f["fault"]))
        if f["recovered"] <= now:
            conn.execute("UPDATE robot_failures SET recovered_at = ? WHERE sim_key = ? AND recovered_at IS NULL",
                         (iso(f["recovered"]), f["key"]))

    for i in p.incidents:
        if i["occurred"] > now:
            continue
        conn.execute("""INSERT OR IGNORE INTO incidents (sim_key, robot_id, occurred_at, detected_at, responded_at,
                        resolved_at, severity, is_near_miss, root_cause, root_cause_known)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                     (i["key"], i["robot_id"], iso(i["occurred"]), seen(i["detected"]), seen(i["responded"]),
                      seen(i["resolved"]), i["severity"], i["near_miss"], i["root_cause"], i["known"]))
        conn.execute("""UPDATE incidents SET detected_at = COALESCE(detected_at, ?), responded_at = COALESCE(responded_at, ?),
                        resolved_at = COALESCE(resolved_at, ?) WHERE sim_key = ?""",
                     (seen(i["detected"]), seen(i["responded"]), seen(i["resolved"]), i["key"]))

    new_eps = [e for e in p.episodes if e["started"] <= now]
    conn.executemany("""INSERT OR IGNORE INTO episodes (sim_key, operator_id, robot_id, task, environment_home,
                        object_category, lighting, started_at, collect_minutes, reset_minutes, status, rejection_reason)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL)""",
                     [(e["key"], e["op"], e["robot"], e["task"], e["home"], e["obj"], e["lighting"], iso(e["started"]),
                       e["collect"], e["reset"]) for e in new_eps])
    reviewed = [e for e in new_eps if e["reviewed"] <= now]
    conn.executemany("UPDATE episodes SET status = ?, rejection_reason = ? WHERE sim_key = ? AND status = 'pending'",
                     [(e["status"], e["reason"], e["key"]) for e in reviewed])
    reviews = []
    for e in reviewed:
        first = "accept" if e["status"] == "accepted" else "reject"
        reviews.append((f"q|{e['key']}|1", e["key"], first))
        if e["double"]:  # ~8% double-reviewed to measure inter-reviewer agreement
            second = first if e["agree"] else ("reject" if first == "accept" else "accept")
            reviews.append((f"q|{e['key']}|2", e["key"], second))
    conn.executemany("""INSERT OR IGNORE INTO qa_reviews (sim_key, episode_id, verdict)
                        SELECT ?, id, ? FROM episodes WHERE sim_key = ?""",
                     [(k, v, ek) for k, ek, v in reviews])


def advance(conn: sqlite3.Connection, now: datetime | None = None) -> dict:
    """Bring the simulated fleet up to `now`. Idempotent and cheap once history is written."""
    now = now or now_utc()
    robot_ids, ops = ensure_roster(conn)
    end = now.date()
    done = {r[0] for r in conn.execute("SELECT day FROM sim_days WHERE complete = 1")}
    written = 0
    for i in range(HISTORY_DAYS - 1, -1, -1):
        day = end - timedelta(days=i)
        ds = day.isoformat()
        if ds in done:
            continue
        p = plan_day(day, robot_ids, ops)
        _apply(conn, p, now)
        complete = 1 if p.settles_at and p.settles_at <= now else 0
        conn.execute("""INSERT INTO sim_days (day, complete, updated_at) VALUES (?, ?, ?)
                        ON CONFLICT (day) DO UPDATE SET complete = excluded.complete, updated_at = excluded.updated_at""",
                     (ds, complete, iso(now)))
        written += 1
    return {"through": iso(now), "daysTouched": written}
