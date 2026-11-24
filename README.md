# Robot Fleet Ops Metrics

An operations dashboard for a robot data-collection fleet: QA pass rate, throughput against targets, uptime (MTBF / MTTR), robot and operator utilization, cost per usable episode, shift coverage, incidents, downtime tickets and an operator leaderboard.

**Stack:** Python (FastAPI + SQLite) API · React + TypeScript (TSX) front end with Tailwind, Radix UI and Recharts.

The data comes from a built-in fleet simulator that runs live: about 6 months of history, and new activity
added as it "happens" (episodes, QA verdicts, robot failures and repairs, incidents), so a new day of data
appears every day without anyone touching it. See [Live data](#live-data).

A **help bot** ("Ask about this data", bottom-right) answers questions about the metrics and today's numbers
using Claude. See [Help bot](#help-bot).

## Pages

| Page | What it answers |
| --- | --- |
| Dashboard | Headline KPIs and daily accepted vs. rejected episodes |
| Quality | Pass rate, rejection reasons, inter-reviewer agreement |
| Throughput | Goal attainment, cycle time (p50 / p90), output per operator-hour |
| Uptime and Downtime | Availability, MTBF, MTTR, fault codes per robot |
| Efficiency | Robot / operator utilization, reset overhead, cost breakdown |
| Coverage | Shift fill rate, task targets, home / lighting / object diversity |
| Incidents | Rate per 1,000 robot-hours, response pipeline, root causes |
| Tickets | Downtime tickets auto-opened from robot failures |
| Ops / Leaderboard | Operator roster and a weighted performance score |

### Ops tools

| Tool | What it does |
| --- | --- |
| **Maintenance Alerts** | Scores every robot 0–100 by comparing its last 7 days with its own previous 4 weeks (failure rate, repair time, availability) and says what to do: pull within 24h, inspect this week, or no action. |
| **Shift Handoff** | One-page report for the incoming shift lead: 30-second summary, output vs. target, robots down, failures and incidents, operator output, maintenance watchlist. Copy as text for Slack/Teams or print / save as PDF. |
| **Capacity Planner** | "If these robots are down for N days, do we still hit the weekly target?" Tick robots and drag the days slider to see projected output, the shortfall in robot-days, and how many robots the fleet can lose and stay at or above 90% of target. |

## Run locally

Requires Python 3.11+ and Node 20+.

```bash
# API on http://127.0.0.1:8000
cd backend
python -m venv .venv
.venv\Scripts\activate        # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

```bash
# Front end on http://localhost:5173 (proxies /api to the Python server)
cd frontend
npm install
npm run dev
```

## Live data

`backend/app/sim.py` generates each calendar day from a random generator seeded by that date, so a day's
numbers never change once written and a rebuilt database has identical history. The server calls
`sim.advance()` on startup and every 5 minutes (`SIM_INTERVAL_SECONDS`); it writes only what has already
happened by then: episodes as they start, QA verdicts 1.5–36 h later, repairs when they finish. Robot wear
follows fixed cycles, so Maintenance Alerts always has something real to find. `GET /api/health` reports
`dataThrough`. Records added by hand through **Add data** are kept until the database is rebuilt
(on Render's free plan that is every restart, because `RESET_DB_ON_START=1`).

## Help bot

`POST /api/help/ask` sends the conversation, the page the user is on and a compact snapshot of the live KPIs
(last 7 and 30 days, top maintenance risks, open tickets) to Claude (`claude-haiku-5-5` at low effort). The metric definitions and page guide live in the cached system prompt in
`backend/app/help.py`. Set `ANTHROPIC_API_KEY` in the environment to turn it on (`HELP_BOT_MODEL` overrides the
model, e.g. `claude-opus-5-5` for deeper answers at ~2¢ a question, with server-side refusal fallback). With Haiku 5.5 each question costs about 0.1¢, so $5 of API credit covers thousands of questions.

Without a key (or if the API is down) the bot still works, from built-in analysis: `helpqa.py` answers open-ended questions by running the dashboard's own analyses ("why did the pass rate drop this week?" uses the drivers breakdown; "which robot should we service first?", "which shift is hardest to staff?", "which task is behind?", "which operators need coaching?", "why do episodes get rejected?", "are any robots down?", "how did the last shift go?", "what should we focus on?"), and `helpkb.py` explains every metric and page with live values. Questions outside those patterns get a list of what it can answer.

## Deploy

The `Dockerfile` builds the front end and serves it from the Python server as a single web service.
On [Render](https://render.com): push this folder to a GitHub repository, then **New → Blueprint** and pick the repo (`render.yaml` is included).
Add `ANTHROPIC_API_KEY` under the service's **Environment** tab to enable the help bot.

## Project layout

```
backend/app/
  main.py        API routes (POST /api/<group>/<name>) + static front end
  db.py          SQLite schema and helpers
  sim.py         live fleet simulator (deterministic per day)
  help.py        help bot (Claude)
  metrics.py     dashboard metrics
  tickets.py     downtime tickets
  data.py        add / search records
  ops.py         maintenance scoring, shift handoff, capacity planner
  validate.py    input validation
frontend/src/
  App.tsx, pages/            dashboard pages (TSX)
  hooks/backend/             typed hooks that call the Python API
  lib/shadcn/                UI components
```
