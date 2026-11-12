"""Management report: one payload with everything a weekly / monthly / quarterly ops report needs."""
from __future__ import annotations

import sqlite3
from typing import Any

from . import metrics, ops
from .db import now_utc
from .validate import clamp_days

Params = dict[str, Any]


def management_report(conn: sqlite3.Connection, p: Params) -> dict:
    days = clamp_days(p.get("days"))
    q = {"days": days}

    quality = metrics.quality(conn, q)
    uptime = metrics.uptime(conn, q)
    incidents = metrics.incidents(conn, q)
    coverage = metrics.coverage(conn, q)
    operators = metrics.operators(conn, q)
    board = metrics.operator_leaderboard(conn, q)
    maint = ops.maintenance(conn)

    rejected = sum(r["count"] for r in quality["rejectReasons"])
    robots = sorted(
        ({"name": r["name"], "availability": r["availability"], "failures": r["failures"],
          "downHours": max(0.0, r["scheduled"] - r["ready"]), "mttrMinutes": r["mttrMinutes"]}
         for r in uptime["perRobot"]),
        key=lambda r: -r["downHours"],
    )

    return {
        "generatedAt": now_utc().isoformat(),
        "days": days,
        "comparison": metrics.period_comparison(conn, days),
        "rejectReasons": [{**r, "share": r["count"] / rejected if rejected else 0} for r in quality["rejectReasons"][:5]],
        "qaAgreement": quality["agreement"]["rate"],
        "robots": robots,
        "faults": uptime["faults"][:5],
        "incidents": {
            "count": incidents["count"], "nearMiss": incidents["nearMiss"],
            "bySeverity": incidents["bySeverity"], "byRootCause": incidents["byRootCause"][:3],
            "avgResolveMinutes": incidents["timing"]["totalMin"],
        },
        "tasks": coverage["taskCoverage"],
        "byShift": coverage["byShift"],
        "team": {
            "headcount": operators["headcount"], "exits": operators["exits"], "attrition": operators["attrition"],
            "sopAdherence": operators["sopAdherence"], "absenceRate": operators["absenceRate"],
            "topOperators": board["entries"][:3],
        },
        "maintenance": [{"name": r["name"], "level": r["level"], "action": r["action"]}
                        for r in maint["robots"] if r["level"] != "low"],
    }
