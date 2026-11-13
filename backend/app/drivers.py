"""Root cause for a metric change: why did it go up or down between two windows?

Every metric is split into pieces whose impacts add up exactly to the total change,
so "grasp failures: -0.6 pts" means that piece alone moved the metric by -0.6 pts.

- Ratio metrics (sum n / sum d, e.g. pass rate by operator) use a shift-share split:
  impact_i = (n_i,cur - R_prev * d_i,cur) / D_cur - (n_i,prev - R_prev * d_i,prev) / D_prev
  which sums to R_cur - R_prev and captures both a segment's own rate and its weight.
- Count and cost metrics use additive factors (volume, pending QA, quality; labor, robot, output).
"""
from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from typing import Any

from .db import minutes_between, one, rows
from .validate import ValidationError, date as valid_date, one_of

Params = dict[str, Any]
Window = dict[str, str]

METRICS = ["passRate", "accepted", "availability", "robotUtilization", "operatorUtilization",
           "costPerUsableEpisode", "fillRate", "incidentRate"]


def _div(a: float, b: float) -> float:
    return a / b if b else 0.0


def _ratio_rows(cur: list[dict], prev: list[dict], scale: float = 1.0) -> list[dict]:
    """cur/prev rows have name, n, d. Returns rows with each segment's exact impact on the overall ratio."""
    c = {r["name"]: r for r in cur}
    p = {r["name"]: r for r in prev}
    nc, dc = sum(r["n"] for r in cur), sum(r["d"] for r in cur)
    np_, dp = sum(r["n"] for r in prev), sum(r["d"] for r in prev)
    rp = _div(np_, dp)
    out = []
    for name in sorted(set(c) | set(p)):
        a, b = c.get(name, {"n": 0, "d": 0}), p.get(name, {"n": 0, "d": 0})
        impact = _div(a["n"] - rp * a["d"], dc) - _div(b["n"] - rp * b["d"], dp)
        out.append({"name": name, "current": _div(a["n"], a["d"]) * scale, "previous": _div(b["n"], b["d"]) * scale,
                    "currentBase": a["d"], "previousBase": b["d"], "impact": impact * scale})
    return _sorted(out)


def _sorted(rs: list[dict]) -> list[dict]:
    return sorted(rs, key=lambda r: -abs(r["impact"]))


def _by(conn: sqlite3.Connection, sql: str, w: Window) -> list[dict]:
    return rows(conn, sql, w)


# --------------------------------------------------------------------------- per-window queries
def _episodes_by(conn, w: Window, col: str) -> list[dict]:
    return _by(conn, f"""SELECT {col} AS name, count(*) FILTER (WHERE status = 'accepted') AS n,
                                count(*) FILTER (WHERE status <> 'pending') AS d,
                                count(*) AS collected, count(*) FILTER (WHERE status = 'pending') AS pending
                         FROM episodes e JOIN operators o ON o.id = e.operator_id
                         WHERE e.started_at >= :sd AND e.started_at < :ed GROUP BY 1""", w)


def _episode_totals(conn, w: Window) -> dict:
    return one(conn, """SELECT count(*) AS collected, count(*) FILTER (WHERE status = 'pending') AS pending,
                               count(*) FILTER (WHERE status <> 'pending') AS reviewed,
                               count(*) FILTER (WHERE status = 'accepted') AS accepted
                        FROM episodes WHERE started_at >= :sd AND started_at < :ed""", w)


def _robot_hours_by_robot(conn, w: Window, n: str, d: str) -> list[dict]:
    return _by(conn, f"""SELECT r.name, COALESCE(sum(rh.{n}), 0) AS n, COALESCE(sum(rh.{d}), 0) AS d
                         FROM robot_hours rh JOIN robots r ON r.id = rh.robot_id
                         WHERE rh.day >= :sd AND rh.day < :ed GROUP BY r.name""", w)


def _operating_hours(conn, w: Window) -> float:
    return one(conn, "SELECT COALESCE(sum(operating_hours), 0) AS h FROM robot_hours WHERE day >= :sd AND day < :ed", w)["h"]


def _costs(conn, w: Window) -> dict:
    lab = one(conn, """SELECT COALESCE(sum(s.paid_minutes / 60.0 * o.hourly_cost), 0) AS labor,
                              COALESCE(sum(s.paid_minutes), 0) / 60.0 AS paid_hours
                       FROM operator_sessions s JOIN operators o ON o.id = s.operator_id
                       WHERE s.day >= :sd AND s.day < :ed""", w)
    rob = one(conn, """SELECT COALESCE(sum(rh.ready_hours * r.cost_per_hour), 0) AS robot, COALESCE(sum(rh.ready_hours), 0) AS ready
                       FROM robot_hours rh JOIN robots r ON r.id = rh.robot_id WHERE rh.day >= :sd AND rh.day < :ed""", w)
    return {**lab, **rob}


def _time_split(conn, w: Window) -> dict:
    return one(conn, """SELECT COALESCE(sum(paid_minutes), 0) AS paid, COALESCE(sum(collecting_minutes), 0) AS collecting,
                               COALESCE(sum(reset_minutes), 0) AS reset, COALESCE(sum(waiting_minutes), 0) AS waiting
                        FROM operator_sessions WHERE day >= :sd AND day < :ed""", w)


def _context(label: str, cur: float, prev: float, kind: str) -> dict:
    return {"label": label, "current": cur, "previous": prev, "kind": kind}


# --------------------------------------------------------------------------- explanations
def _pass_rate(conn, c: Window, p: Window) -> dict:
    tc, tp = _episode_totals(conn, c), _episode_totals(conn, p)
    rej_sql = """SELECT rejection_reason AS name, count(*) AS n FROM episodes
                 WHERE status = 'rejected' AND started_at >= :sd AND started_at < :ed GROUP BY 1"""
    rc = {r["name"]: r["n"] for r in _by(conn, rej_sql, c)}
    rp = {r["name"]: r["n"] for r in _by(conn, rej_sql, p)}
    reasons = _sorted([{
        "name": name, "current": _div(rc.get(name, 0), tc["reviewed"]), "previous": _div(rp.get(name, 0), tp["reviewed"]),
        "currentBase": rc.get(name, 0), "previousBase": rp.get(name, 0),
        # More rejections for a reason lowers the pass rate by exactly that share.
        "impact": -(_div(rc.get(name, 0), tc["reviewed"]) - _div(rp.get(name, 0), tp["reviewed"])),
    } for name in set(rc) | set(rp)])
    return {
        "primary": {"title": "Rejection reasons", "subject": "rejections", "kind": "rate",
                    "valueLabel": "Share of reviewed episodes", "rows": reasons},
        "breakdowns": [
            {"title": "By operator", "subject": "pass rate", "kind": "rate", "valueLabel": "Pass rate",
             "rows": _ratio_rows(_episodes_by(conn, c, "o.name"), _episodes_by(conn, p, "o.name"))},
            {"title": "By task", "subject": "pass rate", "kind": "rate", "valueLabel": "Pass rate",
             "rows": _ratio_rows(_episodes_by(conn, c, "e.task"), _episodes_by(conn, p, "e.task"))},
        ],
        "context": [_context("Episodes reviewed", tc["reviewed"], tp["reviewed"], "count")],
    }


def _accepted(conn, c: Window, p: Window) -> dict:
    tc, tp = _episode_totals(conn, c), _episode_totals(conn, p)
    pr_p, pr_c = _div(tp["accepted"], tp["reviewed"]), _div(tc["accepted"], tc["reviewed"])
    # accepted = (collected - pending) * passRate  →  exact three-way split
    factors = [
        {"name": "Episodes collected", "current": tc["collected"], "previous": tp["collected"], "kind": "count",
         "impact": (tc["collected"] - tp["collected"]) * pr_p},
        {"name": "Still waiting for QA review", "current": tc["pending"], "previous": tp["pending"], "kind": "count",
         "impact": -(tc["pending"] - tp["pending"]) * pr_p},
        {"name": "QA pass rate", "current": pr_c, "previous": pr_p, "kind": "rate",
         "impact": tc["reviewed"] * (pr_c - pr_p)},
    ]

    def counts(col: str) -> list[dict]:
        cur = {r["name"]: r["n"] for r in _episodes_by(conn, c, col)}
        prev = {r["name"]: r["n"] for r in _episodes_by(conn, p, col)}
        return _sorted([{"name": k, "current": cur.get(k, 0), "previous": prev.get(k, 0),
                         "impact": cur.get(k, 0) - prev.get(k, 0)} for k in set(cur) | set(prev)])

    staff = one(conn, "SELECT COALESCE(sum(filled_operators),0) AS f FROM shifts WHERE day >= :sd AND day < :ed", c)["f"]
    staff_p = one(conn, "SELECT COALESCE(sum(filled_operators),0) AS f FROM shifts WHERE day >= :sd AND day < :ed", p)["f"]
    return {
        "primary": {"title": "What drove the change", "subject": "", "kind": "mixed", "valueLabel": "Value", "rows": _sorted(factors)},
        "breakdowns": [
            {"title": "By task", "subject": "usable episodes", "kind": "count", "valueLabel": "Usable", "rows": counts("e.task")},
            {"title": "By operator", "subject": "usable episodes", "kind": "count", "valueLabel": "Usable", "rows": counts("o.name")},
        ],
        "context": [_context("Operator shifts filled", staff, staff_p, "count")],
    }


def _availability(conn, c: Window, p: Window) -> dict:
    mttr = minutes_between("recovered_at", "failed_at")
    f_sql = f"SELECT count(*) AS n, COALESCE(avg({mttr}), 0) AS mttr FROM robot_failures WHERE failed_at >= :sd AND failed_at < :ed"
    fc, fp = one(conn, f_sql, c), one(conn, f_sql, p)
    faults_sql = "SELECT fault_code AS name, count(*) AS n FROM robot_failures WHERE failed_at >= :sd AND failed_at < :ed GROUP BY 1"
    kc = {r["name"]: r["n"] for r in _by(conn, faults_sql, c)}
    kp = {r["name"]: r["n"] for r in _by(conn, faults_sql, p)}
    return {
        "primary": {"title": "By robot", "subject": "availability", "kind": "rate", "valueLabel": "Availability",
                    "rows": _ratio_rows(_robot_hours_by_robot(conn, c, "ready_hours", "scheduled_hours"),
                                        _robot_hours_by_robot(conn, p, "ready_hours", "scheduled_hours"))},
        "breakdowns": [],
        "context": [
            _context("Failures", fc["n"], fp["n"], "count"),
            _context("Average repair time (min)", fc["mttr"], fp["mttr"], "decimal"),
            *[_context(f"{k.replace('_', ' ').capitalize()} failures", kc.get(k, 0), kp.get(k, 0), "count")
              for k in sorted(set(kc) | set(kp), key=lambda k: -abs(kc.get(k, 0) - kp.get(k, 0)))[:4]],
        ],
    }


def _robot_util(conn, c: Window, p: Window) -> dict:
    fill = "SELECT COALESCE(sum(filled_operators),0) AS f, COALESCE(sum(planned_operators),0) AS pl FROM shifts WHERE day >= :sd AND day < :ed"
    sc, sp = one(conn, fill, c), one(conn, fill, p)
    tc, tp = _time_split(conn, c), _time_split(conn, p)
    return {
        "primary": {"title": "By robot", "subject": "utilization", "kind": "rate", "valueLabel": "Utilization",
                    "rows": _ratio_rows(_robot_hours_by_robot(conn, c, "collecting_hours", "ready_hours"),
                                        _robot_hours_by_robot(conn, p, "collecting_hours", "ready_hours"))},
        "breakdowns": [],
        "context": [
            _context("Shift fill rate", _div(sc["f"], sc["pl"]), _div(sp["f"], sp["pl"]), "rate"),
            _context("Operator hours collecting", tc["collecting"] / 60, tp["collecting"] / 60, "decimal"),
            _context("Operator reset share of time", _div(tc["reset"], tc["paid"]), _div(tp["reset"], tp["paid"]), "rate"),
        ],
    }


def _operator_util(conn, c: Window, p: Window) -> dict:
    tc, tp = _time_split(conn, c), _time_split(conn, p)

    def share(t: dict, k: str) -> float:
        return _div(t[k], t["paid"])

    other_c = 1 - share(tc, "collecting") - share(tc, "reset") - share(tc, "waiting")
    other_p = 1 - share(tp, "collecting") - share(tp, "reset") - share(tp, "waiting")
    # collecting share = 1 - reset - waiting - other  →  more time on any of these lowers utilization
    factors = [
        {"name": "Time spent on resets", "current": share(tc, "reset"), "previous": share(tp, "reset"), "kind": "rate",
         "impact": -(share(tc, "reset") - share(tp, "reset"))},
        {"name": "Time waiting (robot down or not ready)", "current": share(tc, "waiting"), "previous": share(tp, "waiting"),
         "kind": "rate", "impact": -(share(tc, "waiting") - share(tp, "waiting"))},
        {"name": "Breaks, setup and other time", "current": other_c, "previous": other_p, "kind": "rate",
         "impact": -(other_c - other_p)},
    ]
    op_sql = """SELECT o.name, sum(s.collecting_minutes) AS n, sum(s.paid_minutes) AS d
                FROM operator_sessions s JOIN operators o ON o.id = s.operator_id
                WHERE s.day >= :sd AND s.day < :ed GROUP BY o.name"""
    return {
        "primary": {"title": "Where operator time went", "subject": "", "kind": "rate", "valueLabel": "Share of paid time",
                    "rows": _sorted(factors)},
        "breakdowns": [{"title": "By operator", "subject": "utilization", "kind": "rate", "valueLabel": "Utilization",
                        "rows": _ratio_rows(_by(conn, op_sql, c), _by(conn, op_sql, p))}],
        "context": [_context("Paid operator hours", tc["paid"] / 60, tp["paid"] / 60, "decimal")],
    }


def _cost(conn, c: Window, p: Window) -> dict:
    kc, kp = _costs(conn, c), _costs(conn, p)
    ac, ap = _episode_totals(conn, c)["accepted"], _episode_totals(conn, p)["accepted"]
    tc, tp = _episode_totals(conn, c), _episode_totals(conn, p)
    # cost = (labor + robot) / accepted  →  exact split into labor, robot and output effects
    factors = [
        {"name": "Operator labor cost", "current": kc["labor"], "previous": kp["labor"], "kind": "money",
         "impact": _div(kc["labor"] - kp["labor"], ac)},
        {"name": "Robot running cost", "current": kc["robot"], "previous": kp["robot"], "kind": "money",
         "impact": _div(kc["robot"] - kp["robot"], ac)},
        {"name": "Usable episodes produced", "current": ac, "previous": ap, "kind": "count",
         "impact": (kp["labor"] + kp["robot"]) * (_div(1, ac) - _div(1, ap)) if ac and ap else 0.0},
    ]
    return {
        "primary": {"title": "What drove the change", "subject": "", "kind": "mixed", "valueLabel": "Value", "rows": _sorted(factors)},
        "breakdowns": [],
        "context": [
            _context("QA pass rate", _div(tc["accepted"], tc["reviewed"]), _div(tp["accepted"], tp["reviewed"]), "rate"),
            _context("Still waiting for QA review", tc["pending"], tp["pending"], "count"),
            _context("Paid operator hours", kc["paid_hours"], kp["paid_hours"], "decimal"),
        ],
    }


def _fill_rate(conn, c: Window, p: Window) -> dict:
    sql = """SELECT shift AS name, sum(filled_operators) AS n, sum(planned_operators) AS d
             FROM shifts WHERE day >= :sd AND day < :ed GROUP BY shift"""
    return {
        "primary": {"title": "By shift", "subject": "fill rate", "kind": "rate", "valueLabel": "Fill rate",
                    "rows": _ratio_rows(_by(conn, sql, c), _by(conn, sql, p))},
        "breakdowns": [], "context": [],
    }


def _incident_rate(conn, c: Window, p: Window) -> dict:
    hc, hp = _operating_hours(conn, c), _operating_hours(conn, p)

    def split(col: str) -> list[dict]:
        sql = f"SELECT COALESCE({col}, 'Unknown') AS name, count(*) AS n FROM incidents WHERE occurred_at >= :sd AND occurred_at < :ed GROUP BY 1"
        cur = {r["name"]: r["n"] for r in _by(conn, sql, c)}
        prev = {r["name"]: r["n"] for r in _by(conn, sql, p)}
        return _sorted([{"name": k, "current": cur.get(k, 0), "previous": prev.get(k, 0),
                         "impact": (_div(cur.get(k, 0), hc) - _div(prev.get(k, 0), hp)) * 1000}
                        for k in set(cur) | set(prev)])

    cnt = "SELECT count(*) AS n FROM incidents WHERE occurred_at >= :sd AND occurred_at < :ed"
    return {
        "primary": {"title": "By root cause", "subject": "incidents", "kind": "count", "valueLabel": "Incidents", "rows": split("root_cause")},
        "breakdowns": [{"title": "By severity", "subject": "incidents", "kind": "count", "valueLabel": "Incidents", "rows": split("severity")}],
        "context": [
            _context("Incidents", one(conn, cnt, c)["n"], one(conn, cnt, p)["n"], "count"),
            _context("Robot operating hours", hc, hp, "decimal"),
        ],
    }


EXPLAIN = {
    "passRate": _pass_rate, "accepted": _accepted, "availability": _availability, "robotUtilization": _robot_util,
    "operatorUtilization": _operator_util, "costPerUsableEpisode": _cost, "fillRate": _fill_rate, "incidentRate": _incident_rate,
}


def drivers(conn: sqlite3.Connection, p: Params) -> dict:
    """Params: metric, start, end (inclusive dates). Compares with the same-length window just before."""
    metric = one_of(p.get("metric"), METRICS, "metric")
    start = date.fromisoformat(valid_date(p.get("start"), "start"))
    end = date.fromisoformat(valid_date(p.get("end"), "end")) + timedelta(days=1)
    if end <= start or (end - start).days > 120:
        raise ValidationError("end must be after start, at most 120 days apart")
    length = end - start
    cur = {"sd": start.isoformat(), "ed": end.isoformat()}
    prev = {"sd": (start - length).isoformat(), "ed": start.isoformat()}
    result = EXPLAIN[metric](conn, cur, prev)
    return {
        "metric": metric,
        "current": {"start": cur["sd"], "end": (end - timedelta(days=1)).isoformat()},
        "previous": {"start": prev["sd"], "end": (start - timedelta(days=1)).isoformat()},
        **result,
    }
