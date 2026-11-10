# Robot Fleet Ops Metrics

An operations dashboard for a robot data-collection fleet: QA pass rate, throughput against targets, uptime (MTBF / MTTR), robot and operator utilization, cost per usable episode, shift coverage, incidents, downtime tickets and an operator leaderboard.

**Stack:** Python (FastAPI + SQLite) API · React + TypeScript (TSX) front end with Tailwind, Radix UI and Recharts.

The app seeds about 95 days of realistic demo data ending today, so every chart has something to show.

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

## Deploy

The `Dockerfile` builds the front end and serves it from the Python server as a single web service.
On [Render](https://render.com): push this folder to a GitHub repository, then **New → Blueprint** and pick the repo (`render.yaml` is included).

## Project layout

```
backend/app/
  main.py        API routes (POST /api/<group>/<name>) + static front end
  db.py          SQLite schema and helpers
  seed.py        demo data generator
  metrics.py     dashboard metrics
  tickets.py     downtime tickets
  data.py        add / search records
  validate.py    input validation
frontend/src/
  App.tsx, pages/            dashboard pages (TSX)
  hooks/backend/             typed hooks that call the Python API
  lib/shadcn/                UI components
```
