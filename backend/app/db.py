"""SQLite connection helpers and schema for the robot fleet ops app."""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

DB_PATH = Path(os.environ.get("FLEET_DB_PATH", Path(__file__).resolve().parent.parent / "fleet.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS operators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  hire_date TEXT NOT NULL,
  exit_date TEXT,
  hourly_cost REAL NOT NULL DEFAULT 28,
  proficiency_days INTEGER
);
CREATE TABLE IF NOT EXISTS robots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cost_per_hour REAL NOT NULL DEFAULT 15
);
CREATE TABLE IF NOT EXISTS task_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task TEXT NOT NULL UNIQUE,
  weekly_target INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  shift TEXT NOT NULL,
  planned_operators INTEGER NOT NULL,
  filled_operators INTEGER NOT NULL,
  UNIQUE (day, shift)
);
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id INTEGER NOT NULL REFERENCES operators(id),
  robot_id INTEGER NOT NULL REFERENCES robots(id),
  task TEXT NOT NULL,
  environment_home TEXT NOT NULL,
  object_category TEXT NOT NULL,
  lighting TEXT NOT NULL,
  started_at TEXT NOT NULL,
  collect_minutes REAL NOT NULL,
  reset_minutes REAL NOT NULL,
  status TEXT NOT NULL,
  rejection_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_episodes_started ON episodes(started_at);
CREATE TABLE IF NOT EXISTS qa_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id),
  verdict TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operator_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id INTEGER NOT NULL REFERENCES operators(id),
  day TEXT NOT NULL,
  paid_minutes REAL NOT NULL,
  collecting_minutes REAL NOT NULL,
  reset_minutes REAL NOT NULL,
  waiting_minutes REAL NOT NULL,
  sop_audited INTEGER NOT NULL DEFAULT 0,
  sop_passed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id INTEGER NOT NULL REFERENCES operators(id),
  day TEXT NOT NULL,
  scheduled INTEGER NOT NULL,
  present INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS robot_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  robot_id INTEGER NOT NULL REFERENCES robots(id),
  day TEXT NOT NULL,
  scheduled_hours REAL NOT NULL,
  ready_hours REAL NOT NULL,
  operating_hours REAL NOT NULL,
  collecting_hours REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS robot_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  robot_id INTEGER NOT NULL REFERENCES robots(id),
  failed_at TEXT NOT NULL,
  recovered_at TEXT,
  fault_code TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  robot_id INTEGER NOT NULL REFERENCES robots(id),
  occurred_at TEXT NOT NULL,
  detected_at TEXT,
  responded_at TEXT,
  resolved_at TEXT,
  severity TEXT NOT NULL,
  is_near_miss INTEGER NOT NULL DEFAULT 0,
  root_cause TEXT,
  root_cause_known INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS robot_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  failure_id INTEGER NOT NULL UNIQUE REFERENCES robot_failures(id),
  robot_id INTEGER NOT NULL REFERENCES robots(id),
  title TEXT NOT NULL,
  fault_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  assignee TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def rows(conn: sqlite3.Connection, sql: str, params: tuple | list = ()) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def one(conn: sqlite3.Connection, sql: str, params: tuple | list = ()) -> dict[str, Any]:
    r = conn.execute(sql, params).fetchone()
    return dict(r) if r else {}


# ---- time helpers -------------------------------------------------------
# Timestamps are stored as UTC ISO strings: "YYYY-MM-DDTHH:MM:SSZ".
# Dates are stored as "YYYY-MM-DD".

def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def since_date(days: int) -> str:
    """Equivalent of Postgres `CURRENT_DATE - days`."""
    return (now_utc().date() - timedelta(days=days)).isoformat()


def since_ts(days: int) -> str:
    """Equivalent of Postgres `now() - days * interval '1 day'`."""
    return iso(now_utc() - timedelta(days=days))


def today() -> date:
    return now_utc().date()


# Monday of the week containing a date/timestamp column (Postgres date_trunc('week', x)::date).
def week_of(col: str) -> str:
    return f"date(substr({col}, 1, 10), '-6 days', 'weekday 1')"


# Minutes between two ISO timestamp columns.
def minutes_between(later: str, earlier: str) -> str:
    return f"((julianday({later}) - julianday({earlier})) * 1440.0)"


def init_db(reset: bool = False) -> None:
    from .seed import seed  # local import to avoid a cycle

    if reset and DB_PATH.exists():
        DB_PATH.unlink()
    fresh = not DB_PATH.exists()
    with connection() as conn:
        conn.executescript(SCHEMA)
        if fresh:
            seed(conn)
