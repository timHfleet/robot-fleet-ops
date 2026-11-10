"""Downtime tickets (port of backend/tickets/*.ts)."""
from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from .db import iso, now_utc, rows, since_ts
from .validate import ValidationError, clamp_days

Params = dict[str, Any]
STATUSES = ("open", "in_progress", "resolved")


def query_tickets(conn: sqlite3.Connection, days: int, status: str | None = None) -> dict:
    st = since_ts(days)
    now = iso(now_utc())
    where = "AND t.status = ?" if status else ""
    params: list[Any] = [now, st] + ([status] if status else [])
    data = rows(conn, f"""
        SELECT t.id, t.title, t.fault_code, t.severity, t.status, t.assignee, t.notes, t.created_at, t.updated_at,
               rf.recovered_at,
               abs(julianday(COALESCE(rf.recovered_at, ?)) - julianday(rf.failed_at)) * 1440.0 AS downtime_minutes,
               r.name AS robot_name
        FROM robot_tickets t
        JOIN robot_failures rf ON rf.id = t.failure_id
        JOIN robots r ON r.id = t.robot_id
        WHERE rf.failed_at >= ? {where}
        ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, rf.failed_at DESC
        LIMIT 200""", params)
    tickets = [{
        "id": r["id"], "title": r["title"], "robotName": r["robot_name"], "faultCode": r["fault_code"],
        "severity": r["severity"], "status": r["status"], "assignee": r["assignee"], "notes": r["notes"],
        "createdAt": r["created_at"], "updatedAt": r["updated_at"], "recovered": r["recovered_at"] is not None,
        "downtimeMinutes": round(r["downtime_minutes"] or 0),
    } for r in data]
    counts = {r["status"]: r["n"] for r in rows(conn, """
        SELECT status, count(*) AS n FROM robot_tickets
        WHERE failure_id IN (SELECT id FROM robot_failures WHERE failed_at >= ?) GROUP BY 1""", (st,))}
    return {"tickets": tickets, "counts": {"open": counts.get("open", 0), "inProgress": counts.get("in_progress", 0),
                                           "resolved": counts.get("resolved", 0)}}


def sync_tickets(conn: sqlite3.Connection, days: int) -> None:
    """Open tickets for downtime events without one; auto-resolve tickets whose robot recovered. Idempotent."""
    conn.execute("""
        INSERT INTO robot_tickets (failure_id, robot_id, title, fault_code, severity, status, created_at, updated_at)
        SELECT rf.id, rf.robot_id, 'Downtime: ' || rf.fault_code || ' on ' || r.name, rf.fault_code,
               CASE WHEN rf.fault_code IN ('e_stop', 'motor_fault') THEN 'high'
                    WHEN rf.fault_code = 'network_drop' THEN 'medium' ELSE 'low' END,
               CASE WHEN rf.recovered_at IS NOT NULL THEN 'resolved' ELSE 'open' END,
               rf.failed_at, COALESCE(rf.recovered_at, rf.failed_at)
        FROM robot_failures rf JOIN robots r ON r.id = rf.robot_id
        WHERE rf.failed_at >= ?
        ON CONFLICT (failure_id) DO NOTHING""", (since_ts(days),))
    conn.execute("""
        UPDATE robot_tickets SET status = 'resolved', updated_at = ?
        WHERE status <> 'resolved'
          AND failure_id IN (SELECT id FROM robot_failures WHERE recovered_at IS NOT NULL)""", (iso(now_utc()),))


def get_tickets(conn: sqlite3.Connection, p: Params) -> dict:
    days = clamp_days(p.get("days"))
    sync_tickets(conn, days)
    status = p.get("status")
    return query_tickets(conn, days, status if status in STATUSES else None)


def update_ticket(conn: sqlite3.Connection, p: Params) -> dict:
    tid = p.get("id")
    if not isinstance(tid, int) or isinstance(tid, bool):
        raise ValidationError("id must be an integer")
    sets, vals = [], []
    status = p.get("status")
    if status:
        if status not in STATUSES:
            raise ValidationError(f"status must be one of: {', '.join(STATUSES)}")
        sets.append("status = ?"); vals.append(status)
    if "assignee" in p and p["assignee"] is not None:
        sets.append("assignee = ?"); vals.append(str(p["assignee"])[:80])
    if "notes" in p and p["notes"] is not None:
        sets.append("notes = ?"); vals.append(str(p["notes"])[:2000])
    if not sets:
        raise ValidationError("nothing to update")
    cur = conn.execute(f"UPDATE robot_tickets SET {', '.join(sets)}, updated_at = ? WHERE id = ?",
                       [*vals, iso(now_utc()), tid])
    if cur.rowcount == 0:
        raise ValidationError(f"ticket {tid} not found")
    failed_at = conn.execute("""SELECT rf.failed_at FROM robot_tickets t JOIN robot_failures rf ON rf.id = t.failure_id
                                WHERE t.id = ?""", (tid,)).fetchone()
    age = 90
    if failed_at:
        age = round((now_utc() - datetime.fromisoformat(failed_at[0].replace("Z", "+00:00"))).total_seconds() / 86400)
    return query_tickets(conn, min(max(age, 1), 90))
