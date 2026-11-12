"""Metric endpoints (port of backend/metrics/*.ts from Postgres to SQLite)."""
from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from typing import Any

from .db import minutes_between, one, rows, since_date, since_ts, today, week_of
from .validate import clamp_days

Params = dict[str, Any]


def _div(a: float, b: float) -> float:
    return a / b if b else 0.0


def _percentile(values: list[float], p: float) -> float:
    """Postgres percentile_cont (linear interpolation)."""
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * p
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def _shared(conn: sqlite3.Connection, sd: str) -> dict:
    """Queries several pages share: per-operator paid hours / accepted / SOP / attendance."""
    return {
        r["id"]: r
        for r in rows(conn, """
            WITH ph AS (
              SELECT operator_id, sum(paid_minutes) / 60.0 AS paid_hours
              FROM operator_sessions WHERE day >= :sd GROUP BY operator_id
            ), sop AS (
              SELECT operator_id, count(*) FILTER (WHERE sop_audited) AS audited,
                     count(*) FILTER (WHERE sop_audited AND sop_passed) AS passed
              FROM operator_sessions WHERE day >= :sd GROUP BY operator_id
            ), ep AS (
              SELECT operator_id, count(*) FILTER (WHERE status = 'accepted') AS accepted,
                     count(*) FILTER (WHERE status <> 'pending') AS reviewed
              FROM episodes WHERE started_at >= :sd GROUP BY operator_id
            ), att AS (
              SELECT operator_id, count(*) FILTER (WHERE scheduled) AS scheduled,
                     count(*) FILTER (WHERE scheduled AND present) AS present
              FROM attendance WHERE day >= :sd GROUP BY operator_id
            )
            SELECT o.id, o.name, o.hire_date, o.exit_date, o.proficiency_days,
                   COALESCE(ph.paid_hours, 0) AS paid_hours, COALESCE(ep.accepted, 0) AS accepted,
                   COALESCE(ep.reviewed, 0) AS reviewed, COALESCE(sop.audited, 0) AS audited,
                   COALESCE(sop.passed, 0) AS passed, COALESCE(att.scheduled, 0) AS scheduled,
                   COALESCE(att.present, 0) AS present
            FROM operators o
            LEFT JOIN ph ON ph.operator_id = o.id LEFT JOIN sop ON sop.operator_id = o.id
            LEFT JOIN ep ON ep.operator_id = o.id LEFT JOIN att ON att.operator_id = o.id
            ORDER BY o.hire_date""", {"sd": sd})
    }


# ---------------------------------------------------------------- overview
def _kpis(conn: sqlite3.Connection, start: date, end: date, target_days: int | None = None) -> dict:
    """Headline KPIs for the half-open day window [start, end), flattened for comparisons."""
    days = target_days if target_days is not None else (end - start).days
    sd, ed = start.isoformat(), end.isoformat()
    w = {"sd": sd, "ed": ed}
    q = one(conn, """SELECT count(*) FILTER (WHERE status <> 'pending') AS reviewed,
                            count(*) FILTER (WHERE status = 'accepted') AS accepted,
                            count(*) FILTER (WHERE status = 'pending') AS pending
                     FROM episodes WHERE started_at >= :sd AND started_at < :ed""", w)
    target = one(conn, "SELECT COALESCE(sum(weekly_target), 0) * (? / 7.0) AS t FROM task_targets", (days,))["t"]
    rh = one(conn, """SELECT COALESCE(sum(rh.scheduled_hours), 0) AS scheduled, COALESCE(sum(rh.ready_hours), 0) AS ready,
                             COALESCE(sum(rh.operating_hours), 0) AS operating,
                             COALESCE(sum(rh.collecting_hours), 0) AS collecting,
                             COALESCE(sum(rh.ready_hours * r.cost_per_hour), 0) AS robot_cost
                      FROM robot_hours rh JOIN robots r ON r.id = rh.robot_id
                      WHERE rh.day >= :sd AND rh.day < :ed""", w)
    f = one(conn, f"""SELECT count(*) AS failures,
                             COALESCE(avg({minutes_between('recovered_at', 'failed_at')}), 0) AS mttr
                      FROM robot_failures WHERE failed_at >= :sd AND failed_at < :ed""", w)
    op = one(conn, """SELECT COALESCE(sum(s.paid_minutes), 0) / 60.0 AS paid_hours,
                             COALESCE(sum(s.collecting_minutes), 0) / 60.0 AS collecting_hours,
                             COALESCE(sum(s.paid_minutes / 60.0 * o.hourly_cost), 0) AS labor_cost
                      FROM operator_sessions s JOIN operators o ON o.id = s.operator_id
                      WHERE s.day >= :sd AND s.day < :ed""", w)
    sh = one(conn, """SELECT COALESCE(sum(planned_operators), 0) AS planned, COALESCE(sum(filled_operators), 0) AS filled
                      FROM shifts WHERE day >= :sd AND day < :ed""", w)
    inc = one(conn, "SELECT count(*) AS n FROM incidents WHERE occurred_at >= :sd AND occurred_at < :ed", w)["n"]
    return {
        "start": sd, "end": (end - timedelta(days=1)).isoformat(), "days": days,
        "passRate": _div(q["accepted"], q["reviewed"]), "accepted": q["accepted"], "reviewed": q["reviewed"],
        "pending": q["pending"], "target": target, "goalAttainment": _div(q["accepted"], target),
        "availability": _div(rh["ready"], rh["scheduled"]),
        "scheduledHours": rh["scheduled"], "readyHours": rh["ready"], "operatingHours": rh["operating"],
        "robotCollectingHours": rh["collecting"], "failures": f["failures"], "mttrMinutes": f["mttr"],
        "mtbfHours": rh["operating"] / f["failures"] if f["failures"] else rh["operating"],
        "robotUtilization": _div(rh["collecting"], rh["ready"]),
        "operatorUtilization": _div(op["collecting_hours"], op["paid_hours"]),
        "paidHours": op["paid_hours"], "operatorCollectingHours": op["collecting_hours"],
        "laborCost": op["labor_cost"], "robotCost": rh["robot_cost"],
        "costPerUsableEpisode": _div(op["labor_cost"] + rh["robot_cost"], q["accepted"]),
        "fillRate": _div(sh["filled"], sh["planned"]), "plannedShifts": sh["planned"], "filledShifts": sh["filled"],
        "incidents": inc, "incidentRate": _div(inc, rh["operating"]) * 1000,
    }


HISTORY_WEEKS = 12


def period_comparison(conn: sqlite3.Connection, days: int) -> dict:
    """Current window vs. the same-length window just before it, plus a weekly history."""
    # Same window the headline cards use (since_date(days) through today), so the numbers match.
    end = today() + timedelta(days=1)
    start = today() - timedelta(days=days)
    prev_start = start - (end - start)
    first = one(conn, "SELECT min(day) AS d FROM robot_hours")["d"]
    has_prev = first is not None and first <= prev_start.isoformat()
    history = []
    for i in range(HISTORY_WEEKS, 0, -1):
        w_end = end - timedelta(days=7 * (i - 1))
        w_start = w_end - timedelta(days=7)
        if first is None or w_start.isoformat() < first:
            continue
        history.append(_kpis(conn, w_start, w_end))
    return {
        "current": _kpis(conn, start, end, days),
        "previous": _kpis(conn, prev_start, start, days) if has_prev else None,
        "history": history,
    }


def overview(conn: sqlite3.Connection, p: Params) -> dict:
    days = clamp_days(p.get("days"))
    sd, st = since_date(days), since_ts(days)

    q = one(conn, """SELECT count(*) FILTER (WHERE status <> 'pending') AS reviewed,
                            count(*) FILTER (WHERE status = 'accepted') AS accepted
                     FROM episodes WHERE started_at >= ?""", (sd,))
    target = one(conn, "SELECT COALESCE(sum(weekly_target), 0) * (? / 7.0) AS target FROM task_targets", (days,))["target"]
    rh = one(conn, """SELECT COALESCE(sum(scheduled_hours), 0) AS scheduled, COALESCE(sum(ready_hours), 0) AS ready,
                             COALESCE(sum(operating_hours), 0) AS operating, COALESCE(sum(collecting_hours), 0) AS collecting
                      FROM robot_hours WHERE day >= ?""", (sd,))
    f = one(conn, f"""SELECT count(*) AS failures,
                             COALESCE(avg({minutes_between('recovered_at', 'failed_at')}), 0) AS mttr
                      FROM robot_failures WHERE failed_at >= ?""", (st,))
    op = one(conn, """SELECT COALESCE(sum(s.paid_minutes), 0) / 60.0 AS paid_hours,
                             COALESCE(sum(s.collecting_minutes), 0) / 60.0 AS collecting_hours,
                             COALESCE(sum(s.paid_minutes / 60.0 * o.hourly_cost), 0) AS labor_cost
                      FROM operator_sessions s JOIN operators o ON o.id = s.operator_id WHERE s.day >= ?""", (sd,))
    rc = one(conn, """SELECT COALESCE(sum(rh.ready_hours * r.cost_per_hour), 0) AS robot_cost
                      FROM robot_hours rh JOIN robots r ON r.id = rh.robot_id WHERE rh.day >= ?""", (sd,))
    sh = one(conn, """SELECT COALESCE(sum(planned_operators), 0) AS planned, COALESCE(sum(filled_operators), 0) AS filled
                      FROM shifts WHERE day >= ?""", (sd,))
    inc = one(conn, "SELECT count(*) AS count FROM incidents WHERE occurred_at >= ?", (st,))
    daily = rows(conn, """SELECT substr(started_at, 1, 10) AS day,
                                 count(*) FILTER (WHERE status = 'accepted') AS accepted,
                                 count(*) FILTER (WHERE status = 'rejected') AS rejected
                          FROM episodes WHERE started_at >= ? GROUP BY 1 ORDER BY 1""", (sd,))

    return {
        "quality": {"passRate": _div(q["accepted"], q["reviewed"]), "reviewed": q["reviewed"], "accepted": q["accepted"]},
        "throughput": {
            "accepted": q["accepted"], "target": target, "goalAttainment": _div(q["accepted"], target),
            "perOperatorHour": _div(q["accepted"], op["paid_hours"]),
        },
        "uptime": {
            "availability": _div(rh["ready"], rh["scheduled"]),
            "mtbfHours": rh["operating"] / f["failures"] if f["failures"] else rh["operating"],
            "mttrMinutes": f["mttr"],
        },
        "efficiency": {
            "robotUtilization": _div(rh["collecting"], rh["ready"]),
            "operatorUtilization": _div(op["collecting_hours"], op["paid_hours"]),
            "costPerUsableEpisode": _div(op["labor_cost"] + rc["robot_cost"], q["accepted"]),
        },
        "coverage": {"fillRate": _div(sh["filled"], sh["planned"])},
        "incidents": {"ratePer1000RobotHours": _div(inc["count"], rh["operating"]) * 1000, "count": inc["count"]},
        "daily": daily,
        "comparison": period_comparison(conn, days),
    }


# ---------------------------------------------------------------- quality
def quality(conn: sqlite3.Connection, p: Params) -> dict:
    days = clamp_days(p.get("days"))
    sd = since_date(days)
    s = one(conn, """SELECT count(*) FILTER (WHERE status <> 'pending') AS reviewed,
                            count(*) FILTER (WHERE status = 'accepted') AS accepted
                     FROM episodes WHERE started_at >= ?""", (sd,))
    reasons = rows(conn, """SELECT rejection_reason AS reason, count(*) AS count FROM episodes
                            WHERE status = 'rejected' AND started_at >= ? GROUP BY 1 ORDER BY 2 DESC""", (sd,))

    verdicts: dict[int, list[str]] = {}
    for r in conn.execute("""SELECT r.episode_id, r.verdict FROM qa_reviews r JOIN episodes e ON e.id = r.episode_id
                             WHERE e.started_at >= ? ORDER BY r.id""", (sd,)):
        verdicts.setdefault(r[0], []).append(r[1])
    pairs = [v for v in verdicts.values() if len(v) >= 2]
    agree = sum(1 for v in pairs if v[0] == v[1])

    trend = rows(conn, f"""SELECT {week_of('started_at')} AS weekStart,
                                  count(*) FILTER (WHERE status <> 'pending') AS reviewed,
                                  count(*) FILTER (WHERE status = 'accepted') AS accepted
                           FROM episodes WHERE started_at >= ? GROUP BY 1 ORDER BY 1""", (sd,))
    for t in trend:
        t["passRate"] = _div(t["accepted"], t["reviewed"])

    return {
        "passRate": _div(s["accepted"], s["reviewed"]),
        "reviewed": s["reviewed"],
        "accepted": s["accepted"],
        "rejectReasons": reasons,
        "agreement": {
            "samples": len(pairs), "agree": agree, "rate": _div(agree, len(pairs)),
            "bothAccept": sum(1 for v in pairs if v[0] == v[1] == "accept"),
            "bothReject": sum(1 for v in pairs if v[0] == v[1] == "reject"),
        },
        "trend": trend,
    }


# ---------------------------------------------------------------- throughput
def throughput(conn: sqlite3.Connection, p: Params) -> dict:
    days = clamp_days(p.get("days"))
    sd = since_date(days)
    accepted = one(conn, "SELECT count(*) AS n FROM episodes WHERE status = 'accepted' AND started_at >= ?", (sd,))["n"]
    target = one(conn, "SELECT COALESCE(sum(weekly_target), 0) * (? / 7.0) AS t FROM task_targets", (days,))["t"]

    cycles = rows(conn, f"""SELECT {week_of('started_at')} AS week, collect_minutes AS c, reset_minutes AS r
                            FROM episodes WHERE started_at >= ? AND status <> 'pending'""", (sd,))
    totals = [c["c"] + c["r"] for c in cycles]
    by_week: dict[str, list[float]] = {}
    for c in cycles:
        by_week.setdefault(c["week"], []).append(c["c"] + c["r"])

    per_op = sorted(
        ({"name": r["name"], "paidHours": r["paid_hours"], "accepted": r["accepted"],
          "perHour": _div(r["accepted"], r["paid_hours"]), "_has": r["paid_hours"] > 0}
         for r in _shared(conn, sd).values()),
        key=lambda r: (not r["_has"], -r["perHour"]),
    )
    for r in per_op:
        r.pop("_has")

    daily = rows(conn, """SELECT substr(started_at, 1, 10) AS day, count(*) AS total,
                                 count(*) FILTER (WHERE status = 'accepted') AS accepted
                          FROM episodes WHERE started_at >= ? GROUP BY 1 ORDER BY 1""", (sd,))
    return {
        "accepted": accepted,
        "target": target,
        "goalAttainment": _div(accepted, target),
        "cycleTime": {
            "p50": _percentile(totals, 0.5), "p90": _percentile(totals, 0.9),
            "avgCollect": _div(sum(c["c"] for c in cycles), len(cycles)),
            "avgReset": _div(sum(c["r"] for c in cycles), len(cycles)),
        },
        "perOperator": per_op,
        "daily": daily,
        "cycleTrend": [{"weekStart": w, "p50": _percentile(v, 0.5)} for w, v in sorted(by_week.items())],
    }


# ---------------------------------------------------------------- uptime
def uptime(conn: sqlite3.Connection, p: Params) -> dict:
    days = clamp_days(p.get("days"))
    sd, st = since_date(days), since_ts(days)
    mttr = minutes_between("recovered_at", "failed_at")
    h = one(conn, """SELECT COALESCE(sum(scheduled_hours), 0) AS scheduled, COALESCE(sum(ready_hours), 0) AS ready,
                            COALESCE(sum(operating_hours), 0) AS operating FROM robot_hours WHERE day >= ?""", (sd,))
    f = one(conn, f"SELECT count(*) AS failures, COALESCE(avg({mttr}), 0) AS mttr FROM robot_failures WHERE failed_at >= ?", (st,))
    per_robot = rows(conn, f"""
        WITH rh AS (
          SELECT robot_id, sum(scheduled_hours) AS scheduled, sum(ready_hours) AS ready, sum(operating_hours) AS operating
          FROM robot_hours WHERE day >= ? GROUP BY robot_id
        ), fl AS (
          SELECT robot_id, count(*) AS failures, avg({mttr}) AS mttr
          FROM robot_failures WHERE failed_at >= ? GROUP BY robot_id
        )
        SELECT r.name, COALESCE(rh.scheduled, 0) AS scheduled, COALESCE(rh.ready, 0) AS ready,
               COALESCE(rh.operating, 0) AS operating, COALESCE(fl.failures, 0) AS failures, fl.mttr
        FROM robots r LEFT JOIN rh ON rh.robot_id = r.id LEFT JOIN fl ON fl.robot_id = r.id ORDER BY r.name""", (sd, st))
    faults = rows(conn, """SELECT fault_code AS faultCode, count(*) AS count FROM robot_failures
                           WHERE failed_at >= ? GROUP BY 1 ORDER BY 2 DESC""", (st,))
    trend = rows(conn, f"""SELECT {week_of('day')} AS weekStart,
                                  COALESCE(sum(ready_hours) / NULLIF(sum(scheduled_hours), 0), 0) AS availability
                           FROM robot_hours WHERE day >= ? GROUP BY 1 ORDER BY 1""", (sd,))
    return {
        "availability": _div(h["ready"], h["scheduled"]),
        "scheduledHours": h["scheduled"],
        "readyHours": h["ready"],
        "operatingHours": h["operating"],
        "failures": f["failures"],
        "mtbfHours": h["operating"] / f["failures"] if f["failures"] else h["operating"],
        "mttrMinutes": f["mttr"],
        "perRobot": [{
            "name": r["name"], "scheduled": r["scheduled"], "ready": r["ready"], "operating": r["operating"],
            "availability": _div(r["ready"], r["scheduled"]), "failures": r["failures"],
            "mtbfHours": r["operating"] / r["failures"] if r["failures"] else r["operating"],
            "mttrMinutes": r["mttr"] or 0,
        } for r in per_robot],
        "faults": faults,
        "trend": trend,
    }


# ---------------------------------------------------------------- efficiency
def efficiency(conn: sqlite3.Connection, p: Params) -> dict:
    days = clamp_days(p.get("days"))
    sd = since_date(days)
    op = one(conn, """SELECT COALESCE(sum(s.paid_minutes), 0) / 60.0 AS paid_hours,
                             COALESCE(sum(s.collecting_minutes), 0) / 60.0 AS collecting_hours,
                             COALESCE(sum(s.reset_minutes), 0) / 60.0 AS reset_hours,
                             COALESCE(sum(s.waiting_minutes), 0) / 60.0 AS waiting_hours,
                             COALESCE(sum(s.paid_minutes / 60.0 * o.hourly_cost), 0) AS labor_cost
                      FROM operator_sessions s JOIN operators o ON o.id = s.operator_id WHERE s.day >= ?""", (sd,))
    rb = one(conn, """SELECT COALESCE(sum(rh.ready_hours * r.cost_per_hour), 0) AS robot_cost,
                             COALESCE(sum(rh.collecting_hours), 0) AS collecting, COALESCE(sum(rh.ready_hours), 0) AS ready
                      FROM robot_hours rh JOIN robots r ON r.id = rh.robot_id WHERE rh.day >= ?""", (sd,))
    accepted = one(conn, "SELECT count(*) AS n FROM episodes WHERE status = 'accepted' AND started_at >= ?", (sd,))["n"]
    per_robot = rows(conn, """SELECT r.name, sum(rh.collecting_hours) AS collectingHours, sum(rh.ready_hours) AS readyHours,
                                     COALESCE(sum(rh.collecting_hours) / NULLIF(sum(rh.ready_hours), 0), 0) AS utilization
                              FROM robot_hours rh JOIN robots r ON r.id = rh.robot_id WHERE rh.day >= ?
                              GROUP BY r.name ORDER BY utilization DESC""", (sd,))
    util_trend = rows(conn, f"""SELECT {week_of('day')} AS weekStart,
                                       COALESCE(sum(collecting_hours) / NULLIF(sum(ready_hours), 0), 0) AS utilization
                                FROM robot_hours WHERE day >= ? GROUP BY 1 ORDER BY 1""", (sd,))
    reset_trend = rows(conn, f"""SELECT {week_of('day')} AS weekStart,
                                        COALESCE(sum(reset_minutes) / NULLIF(sum(collecting_minutes) + sum(reset_minutes), 0), 0) AS resetShare
                                 FROM operator_sessions WHERE day >= ? GROUP BY 1 ORDER BY 1""", (sd,))
    return {
        "robotUtilization": _div(rb["collecting"], rb["ready"]),
        "operatorUtilization": _div(op["collecting_hours"], op["paid_hours"]),
        "resetOverhead": _div(op["reset_hours"], op["collecting_hours"] + op["reset_hours"]),
        "costPerUsableEpisode": _div(op["labor_cost"] + rb["robot_cost"], accepted),
        "laborCost": op["labor_cost"],
        "robotCost": rb["robot_cost"],
        "accepted": accepted,
        "paidHours": op["paid_hours"],
        "collectingHours": op["collecting_hours"],
        "waitingHours": op["waiting_hours"],
        "perRobot": per_robot,
        "robotUtilTrend": util_trend,
        "resetTrend": reset_trend,
    }


# ---------------------------------------------------------------- coverage
def coverage(conn: sqlite3.Connection, p: Params) -> dict:
    days = clamp_days(p.get("days"))
    sd = since_date(days)
    shift_rows = {r["shift"]: r for r in rows(conn, """SELECT shift, sum(planned_operators) AS planned,
                                                              sum(filled_operators) AS filled
                                                       FROM shifts WHERE day >= ? GROUP BY 1""", (sd,))}
    by_shift = []
    for s in ["morning", "evening", "overnight"]:
        r = shift_rows.get(s, {"planned": 0, "filled": 0})
        by_shift.append({"shift": s, "planned": r["planned"], "filled": r["filled"], "fillRate": _div(r["filled"], r["planned"])})
    planned = sum(s["planned"] for s in by_shift)
    filled = sum(s["filled"] for s in by_shift)

    tasks = rows(conn, """WITH actual AS (
                            SELECT task, count(*) FILTER (WHERE status = 'accepted') AS accepted
                            FROM episodes WHERE started_at >= ? GROUP BY task)
                          SELECT t.task, t.weekly_target, COALESCE(a.accepted, 0) AS accepted,
                                 CAST(round(t.weekly_target * (? / 7.0)) AS INTEGER) AS target
                          FROM task_targets t LEFT JOIN actual a ON a.task = t.task ORDER BY t.task""", (sd, days))
    div = one(conn, """SELECT count(DISTINCT environment_home) AS homes, count(DISTINCT object_category) AS objects,
                              count(DISTINCT lighting) AS lighting, count(*) FILTER (WHERE status = 'accepted') AS accepted
                       FROM episodes WHERE started_at >= ?""", (sd,))

    def dist(col: str) -> list[dict]:
        return rows(conn, f"""SELECT {col} AS label, count(*) FILTER (WHERE status = 'accepted') AS accepted
                              FROM episodes WHERE started_at >= ? GROUP BY 1 ORDER BY 2 DESC""", (sd,))

    return {
        "fillRate": _div(filled, planned),
        "plannedShifts": planned,
        "filledShifts": filled,
        "byShift": by_shift,
        "taskCoverage": [{"task": t["task"], "weeklyTarget": t["weekly_target"], "target": t["target"],
                          "accepted": t["accepted"], "attainment": _div(t["accepted"], t["target"])} for t in tasks],
        "diversity": div,
        "byHome": dist("environment_home"),
        "byLighting": dist("lighting"),
        "byObject": dist("object_category"),
    }


# ---------------------------------------------------------------- incidents
def incidents(conn: sqlite3.Connection, p: Params) -> dict:
    days = clamp_days(p.get("days"))
    sd, st = since_date(days), since_ts(days)
    s = one(conn, f"""SELECT count(*) AS count, count(*) FILTER (WHERE is_near_miss) AS near_miss,
                             count(*) FILTER (WHERE root_cause_known) AS root_cause_known,
                             COALESCE(avg({minutes_between('detected_at', 'occurred_at')}), 0) AS detect_min,
                             COALESCE(avg({minutes_between('responded_at', 'detected_at')}), 0) AS respond_min,
                             COALESCE(avg({minutes_between('resolved_at', 'responded_at')}), 0) AS resolve_min,
                             COALESCE(avg({minutes_between('resolved_at', 'occurred_at')}), 0) AS total_min
                      FROM incidents WHERE occurred_at >= ?""", (st,))
    operating = one(conn, "SELECT COALESCE(sum(operating_hours), 0) AS h FROM robot_hours WHERE day >= ?", (sd,))["h"]
    return {
        "count": s["count"],
        "nearMiss": s["near_miss"],
        "rootCauseKnown": s["root_cause_known"],
        "repeatRate": _div(s["root_cause_known"], s["count"]),
        "ratePer1000RobotHours": _div(s["count"], operating) * 1000,
        "timing": {"detectMin": s["detect_min"], "respondMin": s["respond_min"],
                   "resolveMin": s["resolve_min"], "totalMin": s["total_min"]},
        "bySeverity": rows(conn, """SELECT severity, count(*) AS count FROM incidents WHERE occurred_at >= ?
                                    GROUP BY 1 ORDER BY 2 DESC""", (st,)),
        "byRootCause": rows(conn, """SELECT COALESCE(root_cause, 'Unknown') AS cause, count(*) AS count FROM incidents
                                     WHERE occurred_at >= ? GROUP BY 1 ORDER BY 2 DESC""", (st,)),
        "trend": rows(conn, f"""SELECT {week_of('occurred_at')} AS weekStart, count(*) AS count,
                                       count(*) FILTER (WHERE is_near_miss) AS nearMiss
                                FROM incidents WHERE occurred_at >= ? GROUP BY 1 ORDER BY 1""", (st,)),
    }


# ---------------------------------------------------------------- operators
def operators(conn: sqlite3.Connection, p: Params) -> dict:
    days = clamp_days(p.get("days"))
    sd = since_date(days)
    prof = one(conn, "SELECT COALESCE(avg(proficiency_days), 0) AS d FROM operators WHERE proficiency_days IS NOT NULL")["d"]
    sop = one(conn, """SELECT count(*) FILTER (WHERE sop_audited) AS audited,
                              count(*) FILTER (WHERE sop_audited AND sop_passed) AS passed
                       FROM operator_sessions WHERE day >= ?""", (sd,))
    att = one(conn, """SELECT count(*) FILTER (WHERE scheduled) AS scheduled,
                              count(*) FILTER (WHERE scheduled AND present) AS present
                       FROM attendance WHERE day >= ?""", (sd,))
    attr = one(conn, """SELECT count(*) FILTER (WHERE exit_date IS NOT NULL AND exit_date >= ?) AS exits,
                               count(*) AS headcount FROM operators""", (sd,))
    return {
        "avgProficiencyDays": prof,
        "sopAdherence": _div(sop["passed"], sop["audited"]),
        "audited": sop["audited"],
        "passed": sop["passed"],
        "attrition": _div(attr["exits"], attr["headcount"]),
        "exits": attr["exits"],
        "headcount": attr["headcount"],
        "absenceRate": 1 - att["present"] / att["scheduled"] if att["scheduled"] else 0,
        "roster": [{
            "name": r["name"], "hireDate": r["hire_date"], "exitDate": r["exit_date"],
            "proficiencyDays": r["proficiency_days"], "paidHours": r["paid_hours"], "accepted": r["accepted"],
            "passRate": _div(r["accepted"], r["reviewed"]), "sopAudited": r["audited"], "sopPassed": r["passed"],
            "absenceRate": 1 - r["present"] / r["scheduled"] if r["scheduled"] else 0,
        } for r in _shared(conn, sd).values()],
    }


# ---------------------------------------------------------------- leaderboard
WEIGHTS = {"output": 0.4, "quality": 0.25, "sop": 0.2, "attendance": 0.15}
MIN_HOURS = 8


def operator_leaderboard(conn: sqlite3.Connection, p: Params) -> dict:
    days = clamp_days(p.get("days"))
    eligible = []
    for r in _shared(conn, since_date(days)).values():
        if r["paid_hours"] < MIN_HOURS or r["accepted"] <= 0:
            continue
        eligible.append({
            "name": r["name"], "accepted": r["accepted"], "paidHours": r["paid_hours"],
            "perHour": _div(r["accepted"], r["paid_hours"]), "passRate": _div(r["accepted"], r["reviewed"]),
            "sopRate": r["passed"] / r["audited"] if r["audited"] else None,
            "attendance": r["present"] / r["scheduled"] if r["scheduled"] else 1,
        })
    best = max([e["perHour"] for e in eligible] + [0])
    for e in eligible:
        output = _div(e["perHour"], best)
        sop = e["sopRate"] if e["sopRate"] is not None else 0.8  # unaudited operators count at fleet average
        score = 100 * (WEIGHTS["output"] * output + WEIGHTS["quality"] * e["passRate"]
                       + WEIGHTS["sop"] * sop + WEIGHTS["attendance"] * e["attendance"])
        e["score"] = round(score, 1)
    top = sorted(eligible, key=lambda e: -e["score"])[:10]
    return {"entries": [{"rank": i + 1, **e} for i, e in enumerate(top)], "weights": WEIGHTS, "minHours": MIN_HOURS}
