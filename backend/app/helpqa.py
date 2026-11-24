"""Data-driven answers to open-ended questions, without an AI model.

Each handler recognises a kind of question by its wording, runs the same analysis the dashboard pages use
(drivers.py for "why did X change", the per-robot / per-shift / per-task / per-operator breakdowns for "which"
questions) and writes the result up in plain language. `answer()` returns None when no handler fits, so the
caller can fall back to the metric glossary.
"""
from __future__ import annotations

import re
import sqlite3
from datetime import timedelta
from typing import Any, Callable

from . import drivers, metrics, ops, tickets
from .db import today

# metric key -> (display name, keywords, unit for changes, higher is better)
M: dict[str, tuple[str, list[str], str, bool]] = {
    "passRate": ("QA pass rate", ["pass rate", "quality", "qa", "reject"], "pts", True),
    "accepted": ("usable episodes", ["usable episode", "accepted", "output", "episodes", "goal", "target", "throughput"], "count", True),
    "availability": ("fleet availability", ["availability", "uptime", "downtime", "failure", "broke", "mtbf", "mttr"], "pts", True),
    "robotUtilization": ("robot utilization", ["robot utilization", "robot utilisation", "idle robot"], "pts", True),
    "operatorUtilization": ("operator utilization", ["operator utilization", "operator utilisation", "utilization", "utilisation"], "pts", True),
    "costPerUsableEpisode": ("cost per usable episode", ["cost per usable episode", "cost per episode", "cost", "expensive", "spend", "money"], "money", False),
    "fillRate": ("shift fill rate", ["fill rate", "staffing", "staffed", "shift"], "pts", True),
    "incidentRate": ("incident rate", ["incident", "safety"], "perk", False),
}


def _which_metric(q: str) -> str | None:
    best, n = None, 0
    for key, (_, kws, *_r) in M.items():
        for kw in kws:
            if kw in q and len(kw) > n:
                best, n = key, len(kw)
    return best


def _period(q: str) -> tuple[int, str]:
    if re.search(r"\b(yesterday|today|last day|24 hours)\b", q):
        return 1, "the last day"
    if re.search(r"\b(quarter|90 days|3 months|three months)\b", q):
        return 90, "the last 90 days"
    if re.search(r"\b(month|30 days)\b", q):
        return 30, "the last 30 days"
    return 7, "the last 7 days"


def _nice(name: Any) -> str:
    return str(name).replace("_", " ")


def _fmt(unit: str, v: float) -> str:
    if unit == "pts":
        return f"{v * 100:.1f}%"
    if unit == "money":
        return f"${v:,.2f}"
    if unit == "perk":
        return f"{v:.1f} per 1,000 robot-hours"
    return f"{v:,.0f}"


def _delta(unit: str, d: float) -> str:
    sign = "+" if d >= 0 else "−"
    a = abs(d)
    if unit == "pts":
        return f"{sign}{a * 100:.1f} pts"
    if unit == "money":
        return f"{sign}${a:,.2f}"
    if unit == "perk":
        return f"{sign}{a:.1f}"
    return f"{sign}{a:,.0f}"


def _impact_unit(metric: str, kind: str | None) -> str:
    if kind == "rate":
        return "pts" if M[metric][2] == "pts" else M[metric][2]
    if kind == "count":
        return "count"
    return M[metric][2]


# ---------------------------------------------------------------- "why did X change?"
def why(conn: sqlite3.Connection, q: str, metric: str) -> str:
    days, label = _period(q)
    name, _, unit, higher_better = M[metric]
    cmp = metrics.period_comparison(conn, days)
    cur, prev = cmp["current"], cmp["previous"]
    if not prev:
        return f"There isn't enough history yet to compare {name} over {label} with the period before."
    d = cur[metric] - prev[metric]
    t = today()
    r = drivers.drivers(conn, {"metric": metric, "start": (t - timedelta(days=days)).isoformat(), "end": t.isoformat()})

    went = "barely moved" if abs(d) < 1e-9 or (unit == "pts" and abs(d) < 0.002) else ("rose" if d > 0 else "fell")
    good = (d > 0) == higher_better
    verdict = "" if went == "barely moved" else (" That's an improvement." if good else " That's a step in the wrong direction.")
    out = [f"**{name[0].upper() + name[1:]} {went}** over {label}: {_fmt(unit, cur[metric])}, compared with "
           f"{_fmt(unit, prev[metric])} in the {'day' if days == 1 else f'{days} days'} before "
           f"({_delta(unit, d)}).{verdict}"]

    prim = r.get("primary") or {}
    rows = [x for x in prim.get("rows", []) if abs(x.get("impact") or 0) > 1e-9][:3]
    if rows:
        u = _impact_unit(metric, prim.get("kind"))
        out.append(f"**Biggest drivers** ({prim.get('title', 'breakdown').lower()}):")
        out.append("\n".join(f"- {_nice(x['name'])}: {_delta(u, x['impact'])}" for x in rows))
    for b in (r.get("breakdowns") or [])[:2]:
        brs = [x for x in b.get("rows", []) if abs(x.get("impact") or 0) > 1e-9][:2]
        if brs:
            u = _impact_unit(metric, b.get("kind"))
            out.append(f"**{b['title']}:** " + "; ".join(f"{_nice(x['name'])} {_delta(u, x['impact'])}" for x in brs))
    pending = cur.get("pending") or 0
    if metric in ("accepted", "costPerUsableEpisode", "passRate") and pending:
        out.append(f"Note: {pending:,} recent episodes are still waiting for QA review, so the newest days will "
                   "move once they're reviewed.")
    out.append("Each driver's number is how much that piece alone moved the metric; they add up to the total change. "
               "Click the metric's card on the Dashboard for the full breakdown.")
    return "\n\n".join(out)


# ---------------------------------------------------------------- "which ...?" questions
def robots(conn: sqlite3.Connection, q: str) -> str:
    m = ops.maintenance(conn, {})
    rs = m.get("robots", []) if isinstance(m, dict) else m
    rs = sorted(rs, key=lambda r: -(r.get("score") or 0))
    up = metrics.uptime(conn, {"days": 30})
    worst = sorted(up.get("perRobot", []), key=lambda r: r["availability"])[:3]
    lines = ["**Robots most at risk right now** (Maintenance Alerts, last 7 days vs each robot's previous 4 weeks):"]
    for r in rs[:3]:
        why_ = "; ".join(r.get("reasons", [])[:2]) or "no notable change"
        down = " · **down now**" if r.get("downNow") else ""
        lines.append(f"- {r['name']}: risk {r.get('score', 0)}/100 ({r.get('level', '')}) → {r.get('action', '')}{down}. {why_}.")
    lines.append("\n**Lowest availability, last 30 days:** " + "; ".join(
        f"{r['name']} {r['availability'] * 100:.1f}% ({r['failures']} failures, MTTR {r['mttrMinutes']:.0f} min)" for r in worst))
    return "\n".join(lines)


def shifts(conn: sqlite3.Connection, q: str) -> str:
    days, label = _period(q)
    days = max(days, 7)
    c = metrics.coverage(conn, {"days": days})
    by = sorted(c.get("byShift", []), key=lambda s: s["fillRate"])
    if not by:
        return "There's no shift data for that period."
    w = by[0]
    rest = "; ".join(f"{s['shift']} {s['fillRate'] * 100:.1f}%" for s in by[1:])
    return (f"**The {w['shift']} shift is hardest to staff**: {w['fillRate'] * 100:.1f}% of planned operator slots "
            f"filled over the last {days} days ({w['filled']} of {w['planned']}). The others: {rest}. "
            "90%+ is healthy. See Coverage to plan hiring or move people between shifts.")


def tasks(conn: sqlite3.Connection, q: str) -> str:
    days = max(_period(q)[0], 7)
    c = metrics.coverage(conn, {"days": days})
    ts = sorted(c.get("taskCoverage", []), key=lambda t: t["attainment"])
    if not ts:
        return "There's no task data for that period."
    lines = [f"**Task targets, last {days} days** (accepted episodes vs prorated weekly target), weakest first:"]
    for t in ts:
        flag = " ← behind" if t["attainment"] < 0.9 else ""
        lines.append(f"- {_nice(t['task'])}: {t['accepted']:,} of {t['target']:,.0f} ({t['attainment'] * 100:.0f}%){flag}")
    behind = [t for t in ts if t["attainment"] < 0.9]
    if behind:
        lines.append(f"\nShift some collection time toward {_nice(behind[0]['task'])}; Throughput shows its cycle time.")
    return "\n".join(lines)


def operators(conn: sqlite3.Connection, q: str) -> str:
    days = max(_period(q)[0], 7)
    lb = metrics.operator_leaderboard(conn, {"days": days}).get("entries", [])
    if not lb:
        return "There's no operator data for that period."
    worst = bool(re.search(r"\b(worst|lowest|bottom|struggl|weakest|coach|help|support|training|improve)", q))
    pick = lb[-3:][::-1] if worst else lb[:3]
    head = "Operators who could use support" if worst else "Top operators"
    lines = [f"**{head}, last {days} days** (weighted score of output per hour, pass rate, SOP compliance, attendance):"]
    for e in pick:
        lines.append(f"- #{e['rank']} {e['name']}: score {e['score']}, {e['accepted']} usable episodes, "
                     f"{e['perHour']:.2f}/hour, pass rate {e['passRate'] * 100:.0f}%")
    lines.append("\nThe full table is on Ops / Leaderboard.")
    return "\n".join(lines)


def rejections(conn: sqlite3.Connection, q: str) -> str:
    days = max(_period(q)[0], 7)
    ql = metrics.quality(conn, {"days": days})
    rs = ql.get("rejectReasons", [])
    total = sum(r["count"] for r in rs) or 1
    advice = {"grasp_failure": "operator technique or gripper wear", "occlusion": "camera placement or scene setup",
              "sop_deviation": "operator coaching or an unclear SOP", "robot_fault": "maintenance",
              "scene_drift": "resetting the scene between episodes", "drop": "grasp technique or gripper wear"}
    lines = [f"**Why episodes get rejected, last {days} days** (pass rate {ql['passRate'] * 100:.1f}%):"]
    for r in rs[:4]:
        lines.append(f"- {_nice(r['reason'])}: {r['count']} ({r['count'] / total * 100:.0f}% of rejections), usually "
                     f"points to {advice.get(r['reason'], 'a process issue')}")
    a = ql.get("agreement") or {}
    if a.get("samples"):
        lines.append(f"\nReviewers agree on {a['rate'] * 100:.0f}% of double-reviewed episodes.")
    return "\n".join(lines)


def incident_causes(conn: sqlite3.Connection, q: str) -> str:
    days = max(_period(q)[0], 30)
    i = metrics.incidents(conn, {"days": days})
    causes = [c for c in i.get("byRootCause", []) if c["cause"] != "Unknown"][:3]
    t = i.get("timing") or {}
    s = (f"**{i['count']} incidents in the last {days} days** ({i['ratePer1000RobotHours']:.1f} per 1,000 robot-hours; "
         f"target ≤ 5), {i.get('nearMiss', 0)} of them near misses.")
    if causes:
        s += " Most common known causes: " + "; ".join(f"{c['cause']} ({c['count']})" for c in causes) + "."
    if t:
        s += (f" On average it takes {t.get('detectMin', 0):.0f} min to detect, {t.get('respondMin', 0):.0f} min to "
              f"respond and {t.get('resolveMin', 0):.0f} min to resolve.")
    return s + " Details are on the Incidents page."


def down_now(conn: sqlite3.Connection, q: str) -> str:
    tickets.sync_tickets(conn, 7)
    t = tickets.query_tickets(conn, 7)
    open_ = [x for x in t["tickets"] if not x["recovered"]]
    if not open_:
        return (f"**No robots are down right now.** In the last 7 days there were "
                f"{t['counts']['resolved']} downtime tickets, all resolved. See Tickets for details.")
    lines = [f"**{len(open_)} robot{'s' if len(open_) > 1 else ''} down right now:**"]
    for x in open_:
        lines.append(f"- {x['robotName']}: {_nice(x['faultCode'])}, down {x['downtimeMinutes']} min so far "
                     f"(ticket {x['status'].replace('_', ' ')}{', ' + x['assignee'] if x.get('assignee') else ''})")
    return "\n".join(lines)


def last_shift(conn: sqlite3.Connection, q: str) -> str:
    h = ops.shift_handoff(conn, {})
    e = h.get("episodes", {})
    st = h.get("staffing", {})
    rej = ", ".join(f"{_nice(r['reason'])} ({r['count']})" for r in h.get("topRejects", [])[:3])
    state = "in progress" if h.get("inProgress") else "finished"
    return (f"**{h.get('shift', '').capitalize()} shift on {h.get('day')}** ({state}): {st.get('filled')} of "
            f"{st.get('planned')} operators, {e.get('collected', 0)} episodes collected, {e.get('accepted', 0)} accepted "
            f"({e.get('attainment', 0) * 100:.0f}% of the shift target), pass rate {e.get('passRate', 0) * 100:.0f}%"
            + (f". Top rejections: {rej}" if rej else "") + ". The full report is on Shift Handoff.")


def focus(conn: sqlite3.Connection, q: str) -> str:
    cmp = metrics.period_comparison(conn, 30)["current"]
    checks = [("passRate", cmp["passRate"] < 0.85), ("accepted", cmp["goalAttainment"] < 0.9),
              ("availability", cmp["availability"] < 0.9), ("robotUtilization", cmp["robotUtilization"] < 0.6),
              ("operatorUtilization", cmp["operatorUtilization"] < 0.6), ("fillRate", cmp["fillRate"] < 0.9),
              ("incidentRate", cmp["incidentRate"] > 5)]
    weak = [k for k, bad in checks if bad]
    lines = ["**Where to focus (last 30 days)**"]
    if not weak:
        lines.append("Every headline metric is in its healthy range. Keep an eye on Maintenance Alerts for robots "
                     "wearing out, and on the task with the lowest target attainment.")
    for k in weak:
        name, _, unit, _ = M[k]
        val = cmp["goalAttainment"] if k == "accepted" else cmp[k]
        lines.append(f"- **{name[0].upper() + name[1:]}** is below target at {_fmt('pts' if k == 'accepted' else unit, val)}"
                     + (" of goal" if k == "accepted" else "") + ".")
    top = robots(conn, q).split("\n")[1]
    if "(high)" in top or "(medium)" in top:
        lines.append("- **Robot to watch:** " + top[2:])
    lines.append("\nAsk me \"why did <metric> drop?\" for the drivers behind any of these.")
    return "\n".join(x for x in lines if x)


# ---------------------------------------------------------------- routing
RULES: list[tuple[str, Callable[[sqlite3.Connection, str], str]]] = [
    (r"\b(down now|down right now|currently down|robots? (are |is )?down|open tickets?|broken now)\b", down_now),
    (r"\b(last shift|this shift|previous shift|handoff|hand-off|shift report)\b", last_shift),
    (r"\b(focus|prioriti[sz]e|biggest (problem|issue|risk)|what should (we|i)|improve|worry about|concern)\b", focus),
    (r"\b(which|what) (robot|machine)|least reliable|most reliable|worst robot|robots? (need|needs|to) (service|maintenance|repair)|service first|riskiest robot\b", robots),
    (r"\b(which|what) shift|hardest to staff|short[- ]staffed|understaffed|staffing (problem|issue)\b", shifts),
    (r"\b(which|what) task|tasks? (behind|lagging)|behind (on|target)|lagging\b", tasks),
    (r"\b(best|top|worst|lowest|weakest|strongest) operators?|who is the best|who are the best|leaderboard|which operators?|operators? (need|needs|to) (coaching|help|support|training)|\bcoach", operators),
    (r"\b(why|reasons?).{0,40}reject|rejection reasons?|most common reject|why (do|are) episodes (fail|rejected)\b", rejections),
    (r"\b(root causes?|what causes? incidents|incident causes?|why (do|are there) incidents)\b", incident_causes),
]
WHY = re.compile(r"\b(why|what caused|what drove|explain the (drop|rise|change)|how come|went (up|down)|dropped|drop|"
                 r"fell|fall|rose|increase|decrease|declin|worse|better|change[ds]?|compared|vs|versus)\b")


def answer(conn: sqlite3.Connection, question: str) -> str | None:
    q = re.sub(r"\s+", " ", question.lower())
    for pattern, fn in RULES:
        if re.search(pattern, q):
            return fn(conn, q)
    if WHY.search(q) and not re.search(r"\b(what (is|does|are)|meaning|mean|define|definition)\b", q):
        metric = _which_metric(q)
        if metric:
            return why(conn, q, metric)
    return None
