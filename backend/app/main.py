"""FastAPI server: JSON API under /api plus the built React front end."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import data, drivers, help, metrics, ops, report, sim, tickets
from .db import connection, init_db
from .validate import ValidationError

Handler = Callable[[Any, dict], Any]

ROUTES: dict[str, Handler] = {
    # metrics (read-only)
    "metrics/overview": metrics.overview,
    "metrics/drivers": drivers.drivers,
    "metrics/quality": metrics.quality,
    "metrics/throughput": metrics.throughput,
    "metrics/uptime": metrics.uptime,
    "metrics/efficiency": metrics.efficiency,
    "metrics/coverage": metrics.coverage,
    "metrics/incidents": metrics.incidents,
    "metrics/operators": metrics.operators,
    "metrics/operatorLeaderboard": metrics.operator_leaderboard,
    # ops tools
    "ops/maintenance": ops.maintenance,
    "ops/shiftHandoff": ops.shift_handoff,
    "ops/capacity": ops.capacity,
    "ops/managementReport": report.management_report,
    # tickets
    "tickets/getTickets": tickets.get_tickets,
    "tickets/updateTicket": tickets.update_ticket,
    # data
    "data/getFormOptions": data.get_form_options,
    "data/searchRecords": data.search_records,
    "data/createOperator": data.create_operator,
    "data/createRobot": data.create_robot,
    "data/createShift": data.create_shift,
    "data/createTask": data.create_task,
    "data/logEpisode": data.log_episode,
    "data/logIncident": data.log_incident,
}

app = FastAPI(title="Robot Fleet Ops Metrics")


SIM_INTERVAL_S = int(os.environ.get("SIM_INTERVAL_SECONDS", "300"))
_sim_state: dict = {"through": None}


def _advance_sim() -> None:
    with connection() as conn:
        _sim_state.update(sim.advance(conn))


async def _sim_loop() -> None:
    # Keep the simulated fleet moving: new episodes, failures, QA verdicts and a new day every day.
    while True:
        await asyncio.sleep(SIM_INTERVAL_S)
        try:
            await asyncio.to_thread(_advance_sim)
        except Exception as e:  # never let the loop die
            print(f"simulator tick failed: {e}", flush=True)


@app.on_event("startup")
async def _startup() -> None:
    # RESET_DB_ON_START=1 rebuilds the database on each boot. The simulator is deterministic per
    # day, so the rebuilt history is identical; only hand-entered records are lost.
    init_db(reset=os.environ.get("RESET_DB_ON_START") == "1")
    _advance_sim()
    asyncio.get_running_loop().create_task(_sim_loop())


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "dataThrough": _sim_state.get("through")}


@app.post("/api/help/ask")
async def help_ask(request: Request) -> JSONResponse:
    # Separate from the generic router: the Claude call can take a few seconds, so run it in a thread.
    try:
        body = await request.json()
    except Exception:
        body = {}

    def run() -> dict:
        with connection() as conn:
            return help.ask(conn, body if isinstance(body, dict) else {})

    try:
        return JSONResponse(await asyncio.to_thread(run))
    except ValidationError as e:
        return JSONResponse({"error": str(e)}, status_code=400)


@app.post("/api/{group}/{name}")
async def call(group: str, name: str, request: Request) -> JSONResponse:
    handler = ROUTES.get(f"{group}/{name}")
    if handler is None:
        return JSONResponse({"error": "Not found"}, status_code=404)
    try:
        body = await request.json()
    except Exception:
        body = {}
    params = body if isinstance(body, dict) else {}
    try:
        with connection() as conn:
            return JSONResponse(handler(conn, params))
    except ValidationError as e:
        return JSONResponse({"error": str(e)}, status_code=400)


# ---- static front end (built by `npm run build` into frontend/dist) ----
DIST = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str) -> FileResponse:
        file = DIST / path
        if path and file.is_file() and DIST in file.resolve().parents:
            return FileResponse(file)
        # Always revalidate the HTML shell so browsers pick up a new deploy right away.
        # (Built JS/CSS under /assets have content hashes in their names, so they can cache.)
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
