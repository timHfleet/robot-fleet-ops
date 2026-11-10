"""Operations tools: predictive maintenance, shift handoff report, capacity planner."""
from __future__ import annotations

import sqlite3
from datetime import date as Date, datetime, time, timedelta, timezone
from typing import Any

from .db import iso, minutes_between, now_utc, one, rows, since_ts, week_of
from .tickets import sync_tickets
from .validate import ValidationError, date as valid_date, one_of

Params = dict[str, Any]

# ------------------------------------------------------------------ maintenance
RECENT_DAYS = 7      # window being judged
BASELINE_DAYS = 28   # the "normal" period just before it


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _mondays(weeks: int) -> list[str]:
    today = now_utc().date()
    this_monday = today - timedelta(days=today.weekday())
    return [(this_monday - timedelta(weeks=i)).isoformat() for i in range(weeks - 1, -1, -1)]


def maintenance(conn: sqlite3.Connection, _p: Params | None = None) -> dict:
    """Scores each robot's failure risk by comparing the last week with its own 4-week baseline."""
    t_recent = since_ts(RECENT_DAYS)
    t_base = since_ts(RECENT_DAYS + BASELINE_DAYS)
    t_mttr_recent = since_ts(14)
    t_mttr_base = since_ts(56)
    d_recent = (now_utc().date() - timedelta(days=RECENT_DAYS)).isoformat()
    d_base = (now_utc().date() - timedelta(days=RECENT_DAYS + BASELINE_DAYS)).isoformat()
    mins = minutes_between("recovered_at", "failed_at")

    data = rows(conn, f"""
        WITH f AS (
          SELECT robot_id,
                 count(*) FILTER (WHERE failed_at >= :tr) AS fail_recent,
                 count(*) FILTER (WHERE failed_at >= :tb AND failed_at < :tr) AS fail_base,
                 avg({mins}) FILTER (WHERE failed_at >= :tmr AND recovered_at IS NOT NULL) AS mttr_recent,
                 avg({mins}) FILTER (WHERE failed_at >= :tmb AND failed_at < :tmr AND recovered_at IS NOT NULL) AS mttr_base,
                 count(*) FILTER (WHERE recovered_at IS NULL) AS down_now
          FROM robot_failures GROUP BY robot_id
        ), h AS (
          SELECT robot_id,
                 sum(ready_hours) FILTER (WHERE day >= :dr) / NULLIF(sum(scheduled_hours) FILTER (WHERE day >= :dr), 0) AS avail_recent,
                 sum(ready_hours) FILTER (WHERE day >= :db AND day < :dr)
                   / NULLIF(sum(scheduled_hours) FILTER (WHERE day >= :db AND day < :dr), 0) AS avail_base
          FROM robot_hours GROUP BY robot_id
        )
        SELECT r.id, r.name,
               COALESCE(f.fail_recent, 0) AS fail_recent, COALESCE(f.fail_base, 0) AS fail_base,
               f.mttr_recent, f.mttr_base, COALESCE(f.down_now, 0) AS down_now,
               h.avail_recent, h.avail_base
        FROM robots r LEFT JOIN f ON f.robot_id = r.id LEFT JOIN h ON h.robot_id = r.id
        ORDER BY r.name""",
        {"tr": t_recent, "tb": t_base, "tmr": t_mttr_recent, "tmb": t_mttr_base, "dr": d_recent, "db": d_base})

    weeks = _mondays(8)
    weekly: dict[int, dict[str, int]] = {}
    for r in rows(conn, f"""SELECT robot_id, {week_of('failed_at')} AS wk, count(*) AS n FROM robot_failures
                            WHERE failed_at >= ? GROUP BY 1, 2""", (weeks[0],)):
        weekly.setdefault(r["robot_id"], {})[r["wk"]] = r["n"]
    top_fault = {r["robot_id"]: r["fault_code"] for r in rows(conn, """
        SELECT robot_id, fault_code FROM (
          SELECT robot_id, fault_code, count(*) AS n,
                 row_number() OVER (PARTITION BY robot_id ORDER BY count(*) DESC) AS rk
          FROM robot_failures WHERE failed_at >= ? GROUP BY 1, 2) WHERE rk = 1""", (since_ts(14),))}

    robots = []
    for r in data:
        base_weekly = r["fail_base"] / (BASELINE_DAYS / 7)
        fail_ratio = r["fail_recent"] / max(base_weekly, 0.5)
        mttr_ratio = (r["mttr_recent"] / r["mttr_base"]) if r["mttr_recent"] and r["mttr_base"] else 1.0
        avail_recent = r["avail_recent"] or 0.0
        avail_base = r["avail_base"] or avail_recent
        avail_drop = avail_base - avail_recent

        s_fail = 45 * _clamp01((fail_ratio - 1) / 2)       # 3x the usual failures = full marks
        s_mttr = 25 * _clamp01(mttr_ratio - 1)               # repairs taking 2x as long = full marks
        s_avail = 30 * _clamp01(avail_drop / 0.08)           # 8-point availability drop = full marks
        score = round(s_fail + s_mttr + s_avail)

        reasons = []
        if s_fail >= 8:
            reasons.append(f"{r['fail_recent']} failures this week vs {base_weekly:.1f}/week normally")
        if s_mttr >= 5:
            reasons.append(f"Repairs taking {mttr_ratio:.1f}x longer than usual")
        if s_avail >= 5:
            reasons.append(f"Availability down {avail_drop * 100:.1f} points to {avail_recent * 100:.1f}%")

        level = "high" if score >= 55 else "medium" if score >= 30 else "low"
        action = {
            "high": "Pull for preventive maintenance within 24 hours",
            "medium": "Schedule an inspection this week",
            "low": "No action needed",
        }[level]
        robots.append({
            "id": r["id"],
            "name": r["name"],
            "score": score,
            "level": level,
            "action": action,
            "reasons": reasons,
            "downNow": r["down_now"] > 0,
            "failuresRecent": r["fail_recent"],
            "failuresBaselineWeekly": base_weekly,
            "mttrRecent": r["mttr_recent"] or 0,
            "mttrBaseline": r["mttr_base"] or 0,
            "availabilityRecent": avail_recent,
            "availabilityBaseline": avail_base,
            "topFault": top_fault.get(r["id"]),
            "weeklyFailures": [{"weekStart": w, "failures": weekly.get(r["id"], {}).get(w, 0)} for w in weeks],
        })
    robots.sort(key=lambda x: -x["score"])
    return {
        "robots": robots,
        "counts": {lvl: sum(1 for r in robots if r["level"] == lvl) for lvl in ("high", "medium", "low")},
        "downNow": sum(1 for r in robots if r["downNow"]),
        "windowDays": RECENT_DAYS,
        "baselineDays": BASELINE_DAYS,
    }


# ------------------------------------------------------------------ shift handoff
SHIFT_STARTS = {"morning": time(6, 0), "evening": time(14, 0), "overnight": time(22, 0)}
SHIFT_ORDER = ["morning", "evening", "overnight"]


def _last_completed_shift(now: datetime) -> tuple[Date, str]:
    """The shift that most recently ended (the one being handed off)."""
    day = now.date()
    candidates = []
    for offset in (0, -1):
        d = day + timedelta(days=offset)
        for s in SHIFT_ORDER:
            start = datetime.combine(d, SHIFT_STARTS[s], tzinfo=timezone.utc)
            if start + timedelta(hours=8) <= now:
                candidates.append((start, d, s))
    _, d, s = max(candidates)
    return d, s


def shift_handoff(conn: sqlite3.Connection, p: Params) -> dict:
    now = now_utc()
    if p.get("day") or p.get("shift"):
        day = Date.fromisoformat(valid_date(p.get("day"), "Day"))
        shift = one_of(p.get("shift"), SHIFT_ORDER, "Shift")
    else:
        day, shift = _last_completed_shift(now)
    start = datetime.combine(day, SHIFT_STARTS[shift], tzinfo=timezone.utc)
    end = start + timedelta(hours=8)
    if start > now:
        raise ValidationError("That shift hasn't started yet")
    s, e = iso(start), iso(min(end, now))

    staffing = one(conn, "SELECT planned_operators AS planned, filled_operators AS filled FROM shifts WHERE day = ? AND shift = ?",
                   (day.isoformat(), shift)) or {"planned": 0, "filled": 0}
    ep = one(conn, """SELECT count(*) AS collected,
                             count(*) FILTER (WHERE status = 'accepted') AS accepted,
                             count(*) FILTER (WHERE status = 'rejected') AS rejected,
                             count(*) FILTER (WHERE status = 'pending') AS pending
                      FROM episodes WHERE started_at >= ? AND started_at < ?""", (s, e))
    weekly_target = one(conn, "SELECT COALESCE(sum(weekly_target), 0) AS t FROM task_targets")["t"]
    target = round(weekly_target / 7 / 3)  # three shifts a day

    by_task = rows(conn, """SELECT task, count(*) AS collected, count(*) FILTER (WHERE status = 'accepted') AS accepted
                            FROM episodes WHERE started_at >= ? AND started_at < ? GROUP BY 1 ORDER BY 2 DESC""", (s, e))
    rejects = rows(conn, """SELECT rejection_reason AS reason, count(*) AS count FROM episodes
                            WHERE status = 'rejected' AND started_at >= ? AND started_at < ?
                            GROUP BY 1 ORDER BY 2 DESC LIMIT 3""", (s, e))
    operators = rows(conn, """SELECT o.name, count(*) AS collected,
                                     count(*) FILTER (WHERE e.status = 'accepted') AS accepted,
                                     count(*) FILTER (WHERE e.status <> 'pending') AS reviewed
                              FROM episodes e JOIN operators o ON o.id = e.operator_id
                              WHERE e.started_at >= ? AND e.started_at < ? GROUP BY o.name ORDER BY 2 DESC""", (s, e))
    for o in operators:
        o["passRate"] = o["accepted"] / o["reviewed"] if o["reviewed"] else None
        del o["reviewed"]

    failures = rows(conn, f"""SELECT r.name AS robot, f.fault_code AS faultCode, f.failed_at AS failedAt,
                                     f.recovered_at IS NOT NULL AS recovered,
                                     abs({minutes_between("COALESCE(f.recovered_at, :now)", "f.failed_at")}) AS downtimeMinutes
                              FROM robot_failures f JOIN robots r ON r.id = f.robot_id
                              WHERE f.failed_at >= :s AND f.failed_at < :e ORDER BY f.failed_at""",
                    {"s": s, "e": e, "now": iso(now)})
    for f in failures:
        f["recovered"] = bool(f["recovered"])
    robots_down = rows(conn, f"""SELECT r.name AS robot, f.fault_code AS faultCode, f.failed_at AS since,
                                        {minutes_between(":now", "f.failed_at")} AS minutesDown
                                 FROM robot_failures f JOIN robots r ON r.id = f.robot_id
                                 WHERE f.recovered_at IS NULL ORDER BY f.failed_at""", {"now": iso(now)})
    incidents = rows(conn, """SELECT r.name AS robot, i.severity, i.is_near_miss AS nearMiss, i.root_cause AS rootCause,
                                     i.occurred_at AS occurredAt, i.resolved_at IS NOT NULL AS resolved
                              FROM incidents i JOIN robots r ON r.id = i.robot_id
                              WHERE i.occurred_at >= ? AND i.occurred_at < ? ORDER BY i.occurred_at""", (s, e))
    for i in incidents:
        i["nearMiss"], i["resolved"] = bool(i["nearMiss"]), bool(i["resolved"])
    sync_tickets(conn, 30)  # make sure every downtime event has a ticket before counting
    open_tickets = one(conn, "SELECT count(*) AS n FROM robot_tickets WHERE status <> 'resolved'")["n"]
    watchlist = [{"name": r["name"], "level": r["level"], "action": r["action"], "reasons": r["reasons"]}
                 for r in maintenance(conn)["robots"] if r["level"] != "low"]

    attainment = ep["accepted"] / target if target else 0
    reviewed = ep["accepted"] + ep["rejected"]
    pass_rate = ep["accepted"] / reviewed if reviewed else None

    # Plain-language headline for the incoming lead.
    highlights = []
    highlights.append(f"Collected {ep['collected']} episodes; {ep['accepted']} accepted "
                      f"({attainment * 100:.0f}% of the {target}-episode shift target).")
    if staffing["planned"]:
        gap = staffing["planned"] - staffing["filled"]
        highlights.append(f"Staffing {staffing['filled']}/{staffing['planned']}" + (f" ({gap} short)." if gap else " (fully staffed)."))
    if robots_down:
        highlights.append(f"{len(robots_down)} robot(s) still down: " + ", ".join(r["robot"] for r in robots_down) + ".")
    if incidents:
        highlights.append(f"{len(incidents)} incident(s) this shift — review before starting.")
    if watchlist:
        highlights.append("Maintenance watchlist: " + ", ".join(f"{w['name']} ({w['level']})" for w in watchlist) + ".")

    return {
        "day": day.isoformat(),
        "shift": shift,
        "start": iso(start),
        "end": iso(end),
        "inProgress": end > now,
        "staffing": staffing,
        "episodes": {**ep, "target": target, "attainment": attainment, "passRate": pass_rate},
        "byTask": by_task,
        "topRejects": rejects,
        "operators": operators,
        "failures": failures,
        "robotsDown": robots_down,
        "incidents": incidents,
        "openTickets": open_tickets,
        "watchlist": watchlist,
        "highlights": highlights,
    }


# ------------------------------------------------------------------ capacity planner
def capacity(conn: sqlite3.Connection, _p: Params) -> dict:
    """Per-robot weekly output, so the front end can model 'what if these robots go down?'."""
    d28 = (now_utc().date() - timedelta(days=28)).isoformat()
    per_robot = rows(conn, """
        WITH ep AS (
          SELECT robot_id, count(*) FILTER (WHERE status = 'accepted') AS accepted
          FROM episodes WHERE started_at >= :d GROUP BY robot_id
        ), h AS (
          SELECT robot_id, sum(ready_hours) / NULLIF(sum(scheduled_hours), 0) AS availability
          FROM robot_hours WHERE day >= :d GROUP BY robot_id
        )
        SELECT r.id, r.name, COALESCE(ep.accepted, 0) / 4.0 AS weeklyAccepted, COALESCE(h.availability, 0) AS availability
        FROM robots r LEFT JOIN ep ON ep.robot_id = r.id LEFT JOIN h ON h.robot_id = r.id
        ORDER BY weeklyAccepted DESC""", {"d": d28})
    risk = {r["id"]: (r["level"], r["downNow"]) for r in maintenance(conn)["robots"]}
    for r in per_robot:
        r["risk"], r["downNow"] = risk.get(r["id"], ("low", False))
    weekly_target = one(conn, "SELECT COALESCE(sum(weekly_target), 0) AS t FROM task_targets")["t"]
    return {
        "robots": per_robot,
        "weeklyTarget": weekly_target,
        "weeklyCapacity": sum(r["weeklyAccepted"] for r in per_robot),
        "basisDays": 28,
    }
