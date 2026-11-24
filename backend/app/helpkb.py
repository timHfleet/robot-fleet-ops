"""Built-in answers for the help bot, used when no ANTHROPIC_API_KEY is configured (or the API is down).

Covers what most people ask: what a metric means (with today's value and whether it is healthy),
what a page shows, and how the data is produced. Matching is by keywords; anything it can't match gets
a list of what it can answer.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any, Callable

from . import helpqa, metrics

Ov = dict[str, Any]


def _pct(v: float) -> str:
    return f"{v * 100:.1f}%"


def _status(v: float, on: float, watch: float, higher_is_better: bool = True) -> str:
    if higher_is_better:
        return "healthy" if v >= on else "needs attention" if v >= watch else "off track"
    return "on target" if v <= on else "worth watching" if v <= watch else "off track"


# key: (keywords, title, what it means, formula, healthy, what to check, current-value function)
METRICS: dict[str, tuple[list[str], str, str, str, str, str, Callable[[Ov], str]]] = {
    "costPerUsableEpisode": (
        ["cost per usable", "cost per episode", "cost", "expensive", "spend", "money"],
        "Cost per usable episode",
        "What one QA-approved episode costs once operator labor and robot time are both counted. It's the "
        "clearest single number for how efficiently the fleet turns money into usable training data.",
        "(operator labor cost + robot time cost) ÷ accepted episodes",
        "Lower is better; watch the trend more than the level (the dashboard compares it with its 12-week average).",
        "It rises when the QA pass rate falls (you pay for rejected episodes) or utilization falls (you pay for "
        "idle time). Check the Quality and Efficiency pages first. The newest day or two always look high until "
        "QA review catches up.",
        lambda o: f"${o['efficiency']['costPerUsableEpisode']:.2f} per usable episode",
    ),
    "passRate": (
        ["pass rate", "qa", "quality", "reject", "rejection", "accepted rate"],
        "QA pass rate",
        "The share of reviewed episodes that QA accepted as usable training data, i.e. how much collection "
        "effort turns into data researchers can use.",
        "accepted ÷ reviewed episodes",
        "85% or higher is healthy; 70–85% needs attention; under 70% wastes a lot of collection time.",
        "Open Quality and look at the top rejection reasons: grasp failures and SOP deviations point to operator "
        "coaching or an unclear SOP; robot faults point to maintenance.",
        lambda o: f"{_pct(o['quality']['passRate'])} ({o['quality']['accepted']:,} of {o['quality']['reviewed']:,} "
                  f"reviewed), {_status(o['quality']['passRate'], 0.85, 0.7)}",
    ),
    "goalAttainment": (
        ["goal attainment", "usable episodes", "target", "goal", "output", "accepted episodes", "throughput"],
        "Usable episodes and goal attainment",
        "Usable episodes are the episodes that passed QA, the fleet's real output. Goal attainment compares "
        "them with the weekly task targets, prorated to the selected period.",
        "accepted episodes ÷ prorated weekly targets",
        "90%+ of target is on track; 70–90% is behind; under 70% puts research timelines at risk.",
        "Work out whether fewer episodes were collected (staffing, robot downtime) or more were rejected "
        "(quality). Throughput and Coverage show which tasks are lagging.",
        lambda o: f"{o['throughput']['accepted']:,} usable episodes = {_pct(o['throughput']['goalAttainment'])} of "
                  f"target, {_status(o['throughput']['goalAttainment'], 0.9, 0.7)}",
    ),
    "availability": (
        ["availability", "uptime", "downtime", "mtbf", "mttr", "breakdown", "failure", "repair"],
        "Fleet availability (with MTBF and MTTR)",
        "The share of scheduled robot hours when robots were ready to work, not down for faults or repairs. "
        "MTBF (mean time between failures) is how long robots run between breakdowns; MTTR (mean time to "
        "repair) is how long a fix takes.",
        "ready hours ÷ scheduled hours",
        "90%+ is healthy; 80–90% means failures or slow repairs are eating capacity; under 80% is a fleet problem.",
        "See Uptime and Downtime and Maintenance Alerts. Falling MTBF means things break more often; rising "
        "MTTR means repairs take longer.",
        lambda o: f"{_pct(o['uptime']['availability'])} availability, MTBF {o['uptime']['mtbfHours']:.1f} h, "
                  f"MTTR {o['uptime']['mttrMinutes']:.0f} min, {_status(o['uptime']['availability'], 0.9, 0.8)}",
    ),
    "robotUtilization": (
        ["robot utilization", "robot utilisation", "idle robot", "robots idle"],
        "Robot utilization",
        "Of the hours robots were ready, the share spent actually collecting episodes. The rest is idle time: "
        "waiting for an operator, resets, setup.",
        "collecting hours ÷ ready hours",
        "60%+ is good for teleoperated collection.",
        "Check Efficiency for the least-used robots. Low utilization usually means unfilled shifts, long resets, "
        "or robots without an operator.",
        lambda o: f"{_pct(o['efficiency']['robotUtilization'])}, {_status(o['efficiency']['robotUtilization'], 0.6, 0.5)}",
    ),
    "operatorUtilization": (
        ["operator utilization", "operator utilisation", "utilization", "utilisation", "waiting", "reset time"],
        "Operator utilization",
        "Of the hours operators were paid for, the share spent actually collecting. The rest goes to resets, "
        "waiting on robots, breaks and admin.",
        "collecting hours ÷ paid hours",
        "60%+ is good; 50–60% is typical when robots are often down or resets are slow.",
        "Compare waiting time with reset time on Efficiency: waiting points to robot downtime, long resets "
        "point to scene setup or the SOP.",
        lambda o: f"{_pct(o['efficiency']['operatorUtilization'])}, "
                  f"{_status(o['efficiency']['operatorUtilization'], 0.6, 0.5)}",
    ),
    "fillRate": (
        ["fill rate", "shift", "staffing", "understaffed", "coverage"],
        "Shift fill rate",
        "The share of planned operator slots that were actually staffed.",
        "filled operator slots ÷ planned slots",
        "90%+ is healthy; below that, robots sit idle for lack of operators.",
        "See Coverage for which shift is short (often overnight), then adjust hiring or scheduling.",
        lambda o: f"{_pct(o['coverage']['fillRate'])}, {_status(o['coverage']['fillRate'], 0.9, 0.8)}",
    ),
    "incidentRate": (
        ["incident", "safety", "near miss", "root cause"],
        "Incident rate",
        "Safety and operational incidents per 1,000 robot operating hours, so busy and quiet periods compare fairly.",
        "incidents ÷ operating hours × 1,000",
        "5 or fewer per 1,000 hours is the target; 5–8 is worth watching; above 8 is off track.",
        "Open Incidents for root causes and severity. Repeated causes should trigger a safety review.",
        lambda o: f"{o['incidents']['ratePer1000RobotHours']:.1f} per 1,000 robot-hours "
                  f"({o['incidents']['count']} incidents), "
                  f"{_status(o['incidents']['ratePer1000RobotHours'], 5, 8, higher_is_better=False)}",
    ),
}

PAGES: dict[str, tuple[str, str]] = {
    "/": ("Dashboard", "the headline KPIs for the selected period (7, 30 or 90 days) compared with the previous "
                       "period, and daily accepted vs rejected episodes. Click any card to see its formula and trend."),
    "/quality": ("Quality", "the QA pass rate, why episodes get rejected, and how often two reviewers agree on "
                            "double-reviewed episodes."),
    "/throughput": ("Throughput", "goal attainment per task, cycle time (p50/p90) and output per operator-hour."),
    "/uptime": ("Uptime and Downtime", "availability, MTBF, MTTR and fault codes for each robot."),
    "/efficiency": ("Efficiency", "robot and operator utilization, reset overhead and the cost breakdown."),
    "/coverage": ("Coverage", "shift fill rate, progress on task targets, and diversity of homes, lighting and objects."),
    "/incidents": ("Incidents", "incident rate, the detect → respond → resolve pipeline and root causes."),
    "/tickets": ("Tickets", "downtime tickets opened automatically when a robot fails; assign them and add notes."),
    "/operators": ("Ops / Leaderboard", "the operator roster and a weighted performance score."),
    "/maintenance": ("Maintenance Alerts", "a 0–100 risk score per robot from its last 7 days compared with its own "
                                           "previous 4 weeks, with an action: pull within 24h, inspect this week, or none."),
    "/handoff": ("Shift Handoff", "a one-page summary for the incoming shift lead that you can copy or print."),
    "/capacity": ("Capacity Planner", "a what-if: if these robots are down for N days, do we still hit the weekly target?"),
    "/report": ("Management Report", "a printable scorecard of every headline metric against its target."),
}

DATA_NOTE = ("The data is a realistic simulation of a robot fleet, not a real one. It is live: new episodes, QA "
             "verdicts, robot failures and repairs, and incidents are added through the day as they \"happen\", "
             "and every day adds a new day of history (about 6 months is kept). Episodes get their QA verdict "
             "1.5–36 hours after they're recorded, so the newest day or two look low until review catches up. "
             "Times are UTC.")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower())


def _metric_answer(key: str, ov: Ov, days: int) -> str:
    _, title, what, formula, healthy, check, value = METRICS[key]
    try:
        now = value(ov)
    except Exception:
        now = None
    parts = [f"**{title}**: {what}", f"**How it's calculated:** {formula}."]
    if now:
        parts.append(f"**Last {days} days:** {now}.")
    parts.append(f"**What good looks like:** {healthy}")
    parts.append(f"**If it gets worse:** {check}")
    return "\n\n".join(parts)


def _summary(ov: Ov, days: int) -> str:
    lines = []
    for key in ("passRate", "goalAttainment", "availability", "operatorUtilization", "costPerUsableEpisode",
                "fillRate", "incidentRate"):
        try:
            lines.append(f"- {METRICS[key][1].split(' (')[0]}: {METRICS[key][6](ov)}")
        except Exception:
            pass
    return f"Here's the last {days} days:\n" + "\n".join(lines)


def answer(conn: sqlite3.Connection, question: str, page: str) -> str:
    q = _norm(question)
    analysed = helpqa.answer(conn, question)  # open-ended "why / which / what should" questions
    if analysed:
        return analysed
    days = 7 if re.search(r"\b(week|7 days|seven days|lately|recent)", q) else (
        90 if re.search(r"\b(quarter|90 days|3 months|three months)", q) else 30)
    ov = metrics.overview(conn, {"days": days})

    if re.search(r"\b(real|fake|simulat\w*|made up|where does the data|data come from|how often|update|live)\b", q):
        return DATA_NOTE
    if re.search(r"\b(this page|page show|what am i looking at|what is this)\b", q) and page in PAGES:
        name, desc = PAGES[page]
        return f"**{name}** shows {desc}"
    if re.search(r"\b(how is|how's|how are|doing|overview|summary|status|healthy|health)\b", q) and not any(
            k in q for kws, *_ in METRICS.values() for k in kws if len(k) > 8):
        return _summary(ov, days)

    # best metric match: longest keyword found wins (so "robot utilization" beats "utilization")
    best, best_len = None, 0
    for key, (kws, *_rest) in METRICS.items():
        for kw in kws:
            if kw in q and len(kw) > best_len:
                best, best_len = key, len(kw)
    if best:
        return _metric_answer(best, ov, days)
    for path, (name, desc) in PAGES.items():
        if name.lower().split(" ")[0] in q:
            return f"**{name}** shows {desc}"

    topics = ", ".join(t[1].split(" (")[0] for t in METRICS.values())
    return ("I can explain any metric on this dashboard with today's numbers, what each page shows, and where "
            f"the data comes from, and dig into questions like \"why did the pass rate drop this week?\", \"which robot "
            "should we service first?\", \"which shift is hardest to staff?\", \"what should we focus on?\" or "
            f"\"are any robots down right now?\". Metrics I know: {topics}.")
