"""Help bot: answers questions about the dashboard and its data with Claude.

The system prompt (metric definitions, page guide, how the data is produced) is fixed and cached;
each question also gets a fresh snapshot of the live numbers so answers match what users see.
Needs ANTHROPIC_API_KEY in the environment; without it the bot replies that it isn't set up.
"""
from __future__ import annotations

import json
import os
import sqlite3
from typing import Any

from . import metrics, ops, tickets
from .db import iso, now_utc
from .validate import ValidationError

MODEL = os.environ.get("HELP_BOT_MODEL", "claude-opus-5-5")
MAX_TURNS = 12          # earlier turns are dropped from the request
MAX_QUESTION_CHARS = 2000

GUIDE = """You are the help assistant inside "Robot Fleet Ops", an operations dashboard for a fleet of
8 teleoperated robots collecting training-data episodes (household tasks such as folding towels or loading a
dishwasher) with 14 human operators across three shifts. People ask you what the numbers mean, why something
changed, and where to look in the app. Answer in plain language, short (usually 2-6 sentences or a few
bullets), and always tie the answer to the actual numbers in the live snapshot when they are relevant.
Never invent numbers that are not in the snapshot; if the snapshot doesn't cover something, say which page
of the dashboard shows it. If a question has nothing to do with the dashboard, fleet operations or its data,
say briefly that you can only help with this dashboard.

## About the data
The data is a realistic SIMULATION of a fleet, not a real one; say so if someone asks whether it is real.
It is live: new activity is added through the day as it "happens" (episodes, robot failures and repairs,
incidents) and every day adds a new day of history; the app keeps about 6 months. Episodes start as
"pending" and get a QA verdict 1.5-36 hours later, so the newest day or two always look low on accepted
counts and cost per usable episode until review catches up. Times are UTC. Shifts: morning 06:00,
evening 14:00, overnight 22:00. Robots: Atlas-01..03, Borealis-04/05, Cirrus-06/07, Delta-08. Some robots
go through wear cycles (rising failure rate, then servicing), which is what Maintenance Alerts detects.

## Headline metrics (definition | healthy level | what to check when it gets worse)
- QA pass rate = accepted / reviewed episodes. | >=85% healthy, 70-85% needs attention, <70% wasteful. |
  Quality page: top rejection reasons. Grasp failures / SOP deviations -> operator coaching or unclear SOP;
  robot faults -> maintenance.
- Usable episodes = episodes that passed QA; goal attainment = accepted / prorated weekly task targets. |
  >=90% of target on track, 70-90% behind, <70% puts research timelines at risk. | Is it fewer episodes
  collected (staffing, downtime) or more rejections (quality)? Throughput and Coverage show lagging tasks.
- Fleet availability = ready hours / scheduled robot hours (also failures, MTBF = mean time between
  failures, MTTR = mean time to repair). | >=90% healthy, 80-90% failures or slow repairs eat capacity,
  <80% fleet problem. | Uptime and Maintenance Alerts: falling MTBF = breaking more often, rising MTTR =
  slower repairs.
- Robot utilization = collecting hours / ready hours. | >=60% good for teleoperation. | Efficiency page:
  unfilled shifts, long resets, robots without an operator.
- Operator utilization = collecting hours / paid hours. | >=60% good, 50-60% typical with downtime or slow
  resets. | Efficiency: waiting time (robot downtime) vs reset time (scene setup / SOP).
- Cost per usable episode = (operator labor + robot time cost) / accepted episodes. | Lower is better; watch
  the trend (<= 12-week average). | Rises when pass rate or utilization falls; check those first.
- Shift fill rate = filled / planned operator slots. | >=90% healthy. | Coverage: which shift is short
  (often overnight).
- Incident rate = incidents per 1,000 robot operating hours. | <=5 on target, 5-8 watch, >8 off track. |
  Incidents page: root causes, severity; repeated causes -> safety review.

## Pages
Dashboard (headline KPIs, daily accepted vs rejected), Quality (pass rate, rejection reasons, inter-reviewer
agreement on double-reviewed episodes), Throughput (goal attainment, cycle time p50/p90, output per
operator-hour), Uptime and Downtime (availability, MTBF, MTTR, fault codes per robot), Efficiency
(utilization, reset overhead, cost breakdown), Coverage (shift fill, task targets, diversity of homes,
lighting and objects), Incidents (rate, response pipeline: detect -> respond -> resolve, root causes),
Tickets (downtime tickets opened automatically from robot failures), Ops / Leaderboard (operator roster and
weighted performance score), Maintenance Alerts (0-100 risk score per robot from last 7 days vs its own
previous 4 weeks: pull within 24h / inspect this week / no action), Shift Handoff (one-page summary for the
incoming shift lead), Capacity Planner (what-if: robots down for N days vs the weekly target), Management
Report. The "?" / explain buttons on metric cards show the formula with this period's inputs.
"""


def _compact(v: Any) -> Any:
    """Round floats, keep only the latest 7 entries of lists and drop per-week histories, to keep requests small."""
    if isinstance(v, float):
        return round(v, 3)
    if isinstance(v, list):
        return [_compact(x) for x in v[-7:]]
    if isinstance(v, dict):
        return {k: _compact(x) for k, x in v.items() if k != "weeklyFailures"}
    return v


def _snapshot(conn: sqlite3.Connection) -> dict[str, Any]:
    return _compact(_raw_snapshot(conn))


def _raw_snapshot(conn: sqlite3.Connection) -> dict[str, Any]:
    maint = ops.maintenance(conn, {})
    robots = maint.get("robots", maint) if isinstance(maint, dict) else maint
    if isinstance(robots, list):
        robots = sorted(robots, key=lambda r: -(r.get("score") or 0) if isinstance(r, dict) else 0)[:4]
    return {
        "generatedAt": iso(now_utc()),
        "last7Days": metrics.overview(conn, {"days": 7}),
        "last30Days": metrics.overview(conn, {"days": 30}),
        "maintenanceTopRisks": robots,
        "tickets": tickets.query_tickets(conn, 7)["counts"],
    }


def _clean_history(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list) or not raw:
        raise ValidationError("messages must be a non-empty list")
    out = []
    for m in raw[-MAX_TURNS:]:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant") or not isinstance(m.get("content"), str):
            raise ValidationError("each message needs role 'user' or 'assistant' and text content")
        text = m["content"].strip()[:MAX_QUESTION_CHARS]
        if text:
            out.append({"role": m["role"], "content": text})
    while out and out[0]["role"] != "user":
        out.pop(0)
    if not out or out[-1]["role"] != "user":
        raise ValidationError("the last message must be the user's question")
    return out


def ask(conn: sqlite3.Connection, p: dict) -> dict:
    history = _clean_history(p.get("messages"))
    page = str(p.get("page") or "")[:60]
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return {"answer": "The help bot isn't set up yet: an ANTHROPIC_API_KEY needs to be added to this "
                          "app's environment (Render → Environment). Meanwhile, the ⓘ buttons on each metric "
                          "card explain how it is calculated.", "configured": False}

    import anthropic  # imported lazily so the dashboard runs without the SDK configured

    snap = json.dumps(_snapshot(conn), default=str, separators=(",", ":"))
    # Volatile context goes in the newest user turn, after the cached system prompt.
    last = history[-1]["content"]
    history[-1] = {"role": "user", "content": (
        f"<live_snapshot>{snap}</live_snapshot>\n"
        + (f"<current_page>{page}</current_page>\n" if page else "")
        + f"Question: {last}")}

    client = anthropic.Anthropic()
    try:
        resp = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low"},
            system=[{"type": "text", "text": GUIDE, "cache_control": {"type": "ephemeral"}}],
            messages=history,
        )
    except anthropic.AuthenticationError:
        return {"answer": "The help bot's API key was rejected. Check ANTHROPIC_API_KEY in the app settings.",
                "configured": False}
    except anthropic.RateLimitError:
        return {"answer": "The help bot is busy right now. Please try again in a minute.", "configured": True}
    except anthropic.APIStatusError as e:
        return {"answer": f"The help bot hit an error ({e.status_code}). Please try again.", "configured": True}
    except anthropic.APIConnectionError:
        return {"answer": "The help bot couldn't reach the AI service. Please try again.", "configured": True}

    if resp.stop_reason == "refusal":
        return {"answer": "I can't help with that one. Try asking about the dashboard's metrics or pages.",
                "configured": True}
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    return {"answer": text or "Sorry, I couldn't come up with an answer. Try rephrasing.", "configured": True}
