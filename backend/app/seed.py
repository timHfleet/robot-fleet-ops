"""Generates ~6 months of realistic demo data ending today, so the dashboard always looks live."""
from __future__ import annotations

import random
import sqlite3
from datetime import datetime, time, timedelta, timezone

from .db import iso, today

DAYS = 182  # two full 90-day windows, so every range has a previous period to compare with

ROBOTS = [("Atlas-01", 14), ("Atlas-02", 14), ("Atlas-03", 14), ("Borealis-04", 16),
          ("Borealis-05", 16), ("Cirrus-06", 12), ("Cirrus-07", 12), ("Delta-08", 18)]

OPERATORS = [
    # name, hire offset (days ago), exit offset (days ago or None), hourly cost, proficiency days
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
LIGHTING = ["daylight", "warm_indoor", "dim", "mixed"]
REJECTIONS = [("grasp_failure", 30), ("occlusion", 20), ("sop_deviation", 18),
              ("robot_fault", 14), ("scene_drift", 10), ("drop", 8)]
FAULTS = [("gripper_jam", 30), ("network_drop", 25), ("camera_dropout", 20),
          ("motor_fault", 15), ("e_stop", 10)]
ROOT_CAUSES = ["Gripper wear", "Cable snag", "Floor obstacle", "Operator handoff",
               "Firmware bug", "Wi-Fi dead zone", "Calibration drift"]
SHIFTS = [("morning", time(6, 0)), ("evening", time(14, 0)), ("overnight", time(22, 0))]


def _pick(rng: random.Random, weighted: list[tuple[str, int]]) -> str:
    return rng.choices([w[0] for w in weighted], weights=[w[1] for w in weighted])[0]


def _at(day, t: time, minutes: float) -> datetime:
    return datetime.combine(day, t, tzinfo=timezone.utc) + timedelta(minutes=minutes)


def seed(conn: sqlite3.Connection) -> None:
    rng = random.Random(42)
    end = today()
    start = end - timedelta(days=DAYS - 1)
    now = datetime.now(timezone.utc)

    conn.executemany("INSERT INTO robots (name, cost_per_hour) VALUES (?, ?)", ROBOTS)
    conn.executemany("INSERT INTO task_targets (task, weekly_target) VALUES (?, ?)", TASKS)
    for name, hire, exit_, cost, prof in OPERATORS:
        conn.execute(
            "INSERT INTO operators (name, hire_date, exit_date, hourly_cost, proficiency_days) VALUES (?, ?, ?, ?, ?)",
            (name, (end - timedelta(days=hire)).isoformat(),
             (end - timedelta(days=exit_)).isoformat() if exit_ else None, cost, prof),
        )
    robot_ids = [r[0] for r in conn.execute("SELECT id FROM robots ORDER BY id")]
    ops = [dict(r) for r in conn.execute("SELECT id, hire_date, exit_date FROM operators ORDER BY id")]
    # Per-operator skill so the leaderboard has real spread.
    skill = {o["id"]: rng.uniform(0.8, 1.2) for o in ops}
    quality = {o["id"]: rng.uniform(0.78, 0.95) for o in ops}

    shifts, sessions, attendance, robot_hours, failures, incidents, episodes = [], [], [], [], [], [], []

    for i in range(DAYS):
        day = start + timedelta(days=i)
        ds = day.isoformat()
        weekend = day.weekday() >= 5

        for shift, _ in SHIFTS:
            planned = rng.randint(3, 4) if weekend else rng.randint(4, 6)
            filled = max(0, planned - rng.choices([0, 1, 2], weights=[70, 24, 6])[0])
            shifts.append((ds, shift, planned, filled))

        # Robot hours + failures. Two robots wear out over recent weeks so the
        # predictive-maintenance page has a real signal to detect.
        days_ago = (end - day).days
        for idx, rid in enumerate(robot_ids):
            wear = 1.0
            if idx == 4 and days_ago < 24:      # Borealis-05: steadily worsening
                wear = 1.0 + 2.6 * (24 - days_ago) / 24
            elif idx == 6 and days_ago < 12:    # Cirrus-07: newer, milder trend
                wear = 1.0 + 1.0 * (12 - days_ago) / 12
            scheduled = 16.0
            ready = round(scheduled - max(0.0, rng.gauss(1.2 * wear, 1.0)), 2)
            operating = round(ready * rng.uniform(0.85, 0.95), 2)
            collecting = round(operating * rng.uniform(0.55, 0.8), 2)
            robot_hours.append((rid, ds, scheduled, ready, operating, collecting))
            if rng.random() < 0.16 * wear:
                failed = _at(day, time(6, 0), rng.uniform(0, 16 * 60))
                if failed > now:
                    continue
                recovered = failed + timedelta(minutes=rng.uniform(8, 150) * wear ** 0.6)
                # A few recent failures are still unrecovered, so open tickets show up.
                still_down = recovered > now or ((now - failed) < timedelta(days=2) and rng.random() < 0.35)
                rec = None if still_down else iso(recovered)
                failures.append((rid, iso(failed), rec, _pick(rng, FAULTS)))

        # Incidents (~1 every 3 days)
        if rng.random() < 0.33:
            occurred = _at(day, time(6, 0), rng.uniform(0, 16 * 60))
            if occurred < now:
                detected = occurred + timedelta(minutes=rng.uniform(1, 12))
                responded = detected + timedelta(minutes=rng.uniform(4, 30))
                resolved = responded + timedelta(minutes=rng.uniform(15, 160))
                known = rng.random() < 0.8
                incidents.append((
                    rng.choice(robot_ids), iso(occurred), iso(detected), iso(responded),
                    iso(resolved) if resolved < now else None,
                    _pick(rng, [("minor", 65), ("major", 28), ("critical", 7)]),
                    1 if rng.random() < 0.3 else 0,
                    rng.choice(ROOT_CAUSES) if known else None, 1 if known else 0,
                ))

        # Operators: attendance, sessions, episodes
        for o in ops:
            if o["hire_date"] > ds or (o["exit_date"] and o["exit_date"] < ds):
                continue
            scheduled = 1 if (not weekend or rng.random() < 0.3) else 0
            present = 1 if scheduled and rng.random() < 0.93 else 0
            attendance.append((o["id"], ds, scheduled, present))
            if not present:
                continue
            paid = 480.0
            collecting = rng.uniform(250, 330) * min(skill[o["id"]], 1.1)
            reset = rng.uniform(50, 95)
            waiting = max(0.0, paid - collecting - reset - 30)
            audited = 1 if rng.random() < 0.25 else 0
            passed = 1 if audited and rng.random() < 0.85 else 0
            sessions.append((o["id"], ds, paid, round(collecting, 1), round(reset, 1), round(waiting, 1), audited, passed))

            shift_start = SHIFTS[o["id"] % 3][1]
            robot = robot_ids[o["id"] % len(robot_ids)]
            n = int(rng.gauss(22, 3) * skill[o["id"]])
            t = 0.0
            for _ in range(max(n, 0)):
                c = round(rng.uniform(6, 14), 1)
                r = round(rng.uniform(1.5, 4.0), 1)
                started = _at(day, shift_start, t)
                t += c + r
                if started > now:
                    break
                age_h = (now - started).total_seconds() / 3600
                if age_h < 30 and rng.random() < 0.6:
                    status, reason = "pending", None
                elif rng.random() < quality[o["id"]]:
                    status, reason = "accepted", None
                else:
                    status, reason = "rejected", _pick(rng, REJECTIONS)
                task = rng.choice(TASKS)[0]
                episodes.append((o["id"], robot, task, rng.choice(HOMES), rng.choice(OBJECTS),
                                 _pick(rng, [(l, w) for l, w in zip(LIGHTING, [45, 30, 15, 10])]),
                                 iso(started), c, r, status, reason))

    conn.executemany("INSERT INTO shifts (day, shift, planned_operators, filled_operators) VALUES (?, ?, ?, ?)", shifts)
    conn.executemany("INSERT INTO attendance (operator_id, day, scheduled, present) VALUES (?, ?, ?, ?)", attendance)
    conn.executemany(
        """INSERT INTO operator_sessions (operator_id, day, paid_minutes, collecting_minutes, reset_minutes,
           waiting_minutes, sop_audited, sop_passed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", sessions)
    conn.executemany(
        """INSERT INTO robot_hours (robot_id, day, scheduled_hours, ready_hours, operating_hours, collecting_hours)
           VALUES (?, ?, ?, ?, ?, ?)""", robot_hours)
    # The worn robot is down right now, so tickets and the handoff report show a live outage.
    failures.append((robot_ids[4], iso(now - timedelta(minutes=50)), None, "gripper_jam"))
    conn.executemany("INSERT INTO robot_failures (robot_id, failed_at, recovered_at, fault_code) VALUES (?, ?, ?, ?)", failures)
    conn.executemany(
        """INSERT INTO incidents (robot_id, occurred_at, detected_at, responded_at, resolved_at, severity,
           is_near_miss, root_cause, root_cause_known) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", incidents)
    conn.executemany(
        """INSERT INTO episodes (operator_id, robot_id, task, environment_home, object_category, lighting,
           started_at, collect_minutes, reset_minutes, status, rejection_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", episodes)

    # Double-review ~8% of reviewed episodes to measure inter-reviewer agreement.
    reviews = []
    for eid, status in conn.execute("SELECT id, status FROM episodes WHERE status <> 'pending'"):
        first = "accept" if status == "accepted" else "reject"
        reviews.append((eid, first))
        if rng.random() < 0.08:
            second = first if rng.random() < 0.9 else ("reject" if first == "accept" else "accept")
            reviews.append((eid, second))
    conn.executemany("INSERT INTO qa_reviews (episode_id, verdict) VALUES (?, ?)", reviews)
