"""Add-data and search endpoints (port of backend/data/*.ts)."""
from __future__ import annotations

import re
import sqlite3
from typing import Any

from .db import rows
from .validate import ValidationError, date, num, one_of, opt_date, opt_num, opt_str, str_, timestamp

Params = dict[str, Any]


def _slug(s: str) -> str:
    return re.sub(r"\s+", "_", s.lower())


def _exists(conn: sqlite3.Connection, sql: str, params: tuple) -> bool:
    return conn.execute(sql, params).fetchone() is not None


def create_operator(conn: sqlite3.Connection, p: Params) -> dict:
    name = str_(p.get("name"), "Name", 80)
    hire_date = date(p.get("hireDate"), "Hire date")
    exit_date = opt_date(p.get("exitDate"), "Exit date")
    hourly_cost = 28 if p.get("hourlyCost") is None else num(p.get("hourlyCost"), "Hourly cost", min=1, max=500)
    proficiency = opt_num(p.get("proficiencyDays"), "Proficiency days", min=0, max=365, integer=True)
    if exit_date and exit_date < hire_date:
        raise ValidationError("Exit date cannot be before the hire date")
    if _exists(conn, "SELECT 1 FROM operators WHERE lower(name) = lower(?)", (name,)):
        raise ValidationError(f'An operator named "{name}" already exists')
    cur = conn.execute(
        "INSERT INTO operators (name, hire_date, exit_date, hourly_cost, proficiency_days) VALUES (?, ?, ?, ?, ?)",
        (name, hire_date, exit_date, hourly_cost, proficiency),
    )
    return {"id": cur.lastrowid, "name": name, "message": f'Operator "{name}" added to the roster'}


def create_robot(conn: sqlite3.Connection, p: Params) -> dict:
    name = str_(p.get("name"), "Robot name", 60)
    cost = 15 if p.get("costPerHour") is None else num(p.get("costPerHour"), "Cost per hour", min=0, max=1000)
    if _exists(conn, "SELECT 1 FROM robots WHERE lower(name) = lower(?)", (name,)):
        raise ValidationError(f'A robot named "{name}" already exists')
    cur = conn.execute("INSERT INTO robots (name, cost_per_hour) VALUES (?, ?)", (name, cost))
    return {"id": cur.lastrowid, "name": name, "message": f'Robot "{name}" added to the fleet'}


def create_shift(conn: sqlite3.Connection, p: Params) -> dict:
    day = date(p.get("day"), "Day")
    shift = one_of(p.get("shift"), ["morning", "evening", "overnight"], "Shift")
    planned = num(p.get("plannedOperators"), "Planned operators", min=0, max=500, integer=True)
    filled = num(p.get("filledOperators"), "Filled operators", min=0, max=500, integer=True)
    if filled > planned:
        raise ValidationError("Filled operators cannot exceed planned operators")
    if _exists(conn, "SELECT 1 FROM shifts WHERE day = ? AND shift = ?", (day, shift)):
        raise ValidationError(f"A {shift} shift on {day} already exists")
    cur = conn.execute(
        "INSERT INTO shifts (day, shift, planned_operators, filled_operators) VALUES (?, ?, ?, ?)",
        (day, shift, planned, filled),
    )
    return {"id": cur.lastrowid, "message": f"{shift} shift on {day} added ({filled}/{planned} filled)"}


def create_task(conn: sqlite3.Connection, p: Params) -> dict:
    task = _slug(str_(p.get("task"), "Task", 60))
    target = num(p.get("weeklyTarget"), "Weekly target", min=1, max=100000, integer=True)
    if _exists(conn, "SELECT 1 FROM task_targets WHERE task = ?", (task,)):
        raise ValidationError(f'A target for "{task}" already exists')
    cur = conn.execute("INSERT INTO task_targets (task, weekly_target) VALUES (?, ?)", (task, target))
    return {"id": cur.lastrowid, "task": task, "message": f'Task "{task}" added with a weekly target of {target}'}


def get_form_options(conn: sqlite3.Connection, _p: Params) -> dict:
    col = lambda sql, key: [r[key] for r in rows(conn, sql)]  # noqa: E731
    operators = rows(conn, "SELECT id, name, (exit_date IS NULL) AS active FROM operators ORDER BY active DESC, name")
    for o in operators:
        o["active"] = bool(o["active"])
    return {
        "operators": operators,
        "robots": rows(conn, "SELECT id, name FROM robots ORDER BY name"),
        "tasks": col("SELECT task FROM task_targets ORDER BY task", "task"),
        "homes": col("SELECT DISTINCT environment_home FROM episodes ORDER BY 1", "environment_home"),
        "objects": col("SELECT DISTINCT object_category FROM episodes ORDER BY 1", "object_category"),
        "lighting": col("SELECT DISTINCT lighting FROM episodes ORDER BY 1", "lighting"),
    }


REJECTION_REASONS = ["robot_fault", "grasp_failure", "occlusion", "sop_deviation", "scene_drift", "drop"]


def log_episode(conn: sqlite3.Connection, p: Params) -> dict:
    operator_id = num(p.get("operatorId"), "Operator", min=1, integer=True)
    robot_id = num(p.get("robotId"), "Robot", min=1, integer=True)
    if not _exists(conn, "SELECT 1 FROM operators WHERE id = ?", (operator_id,)):
        raise ValidationError(f"Operator {operator_id} not found")
    if not _exists(conn, "SELECT 1 FROM robots WHERE id = ?", (robot_id,)):
        raise ValidationError(f"Robot {robot_id} not found")
    task = _slug(str_(p.get("task"), "Task", 60))
    home = str_(p.get("environmentHome"), "Home", 60)
    obj = _slug(str_(p.get("objectCategory"), "Object", 60))
    lighting = str_(p.get("lighting"), "Lighting", 60).lower()
    started_at = timestamp(p.get("startedAt"), "Started at")
    collect = num(p.get("collectMinutes"), "Collect minutes", min=0, max=600)
    reset = num(p.get("resetMinutes"), "Reset minutes", min=0, max=600)
    status = one_of(p.get("status"), ["accepted", "pending", "rejected"], "Status")
    reason = opt_str(p.get("rejectionReason"), "Rejection reason", 60)
    if status != "rejected":
        reason = None
    if status == "rejected" and not reason:
        raise ValidationError("Rejection reason is required when status is rejected")
    if reason and reason not in REJECTION_REASONS:
        raise ValidationError(f"Rejection reason must be one of: {', '.join(REJECTION_REASONS)}")
    cur = conn.execute(
        """INSERT INTO episodes (operator_id, robot_id, task, environment_home, object_category, lighting,
                                 started_at, collect_minutes, reset_minutes, status, rejection_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (operator_id, robot_id, task, home, obj, lighting, started_at, collect, reset, status, reason),
    )
    return {"id": cur.lastrowid, "message": f"Episode logged ({status})"}


def log_incident(conn: sqlite3.Connection, p: Params) -> dict:
    robot_id = num(p.get("robotId"), "Robot", min=1, integer=True)
    if not _exists(conn, "SELECT 1 FROM robots WHERE id = ?", (robot_id,)):
        raise ValidationError(f"Robot {robot_id} not found")
    occurred_at = timestamp(p.get("occurredAt"), "Occurred at")
    severity = one_of(p.get("severity"), ["minor", "major", "critical"], "Severity")
    near_miss = p.get("isNearMiss") is True
    root_cause = opt_str(p.get("rootCause"), "Root cause", 60)
    cur = conn.execute(
        """INSERT INTO incidents (robot_id, occurred_at, detected_at, responded_at, resolved_at, severity,
                                  is_near_miss, root_cause, root_cause_known)
           VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)""",
        (robot_id, occurred_at, occurred_at, severity, int(near_miss), root_cause, int(root_cause is not None)),
    )
    return {"id": cur.lastrowid, "message": f"{severity} incident logged{' (near miss)' if near_miss else ''}"}


LIMIT = 50


def search_records(conn: sqlite3.Connection, p: Params) -> list[dict]:
    kind = p.get("kind")
    q = p.get("query").strip() if isinstance(p.get("query"), str) else ""
    like = f"%{q}%"

    if kind == "operator":
        r = rows(conn, """SELECT id, name, hire_date, exit_date, hourly_cost, proficiency_days FROM operators
                          WHERE (? = '' OR name LIKE ?) ORDER BY name LIMIT ?""", (q, like, LIMIT))
        return [{"id": t["id"], "name": t["name"], "hireDate": t["hire_date"], "exitDate": t["exit_date"],
                 "hourlyCost": float(t["hourly_cost"] or 0), "proficiencyDays": t["proficiency_days"]} for t in r]
    if kind == "task":
        r = rows(conn, """SELECT id, task, weekly_target FROM task_targets WHERE (? = '' OR task LIKE ?)
                          ORDER BY task LIMIT ?""", (q, like, LIMIT))
        return [{"id": t["id"], "task": t["task"], "weeklyTarget": t["weekly_target"]} for t in r]
    if kind == "robot":
        r = rows(conn, """SELECT id, name, cost_per_hour FROM robots WHERE (? = '' OR name LIKE ?)
                          ORDER BY name LIMIT ?""", (q, like, LIMIT))
        return [{"id": t["id"], "name": t["name"], "costPerHour": float(t["cost_per_hour"] or 0)} for t in r]
    if kind == "shift":
        r = rows(conn, """SELECT id, day, shift, planned_operators, filled_operators FROM shifts
                          WHERE (? = '' OR shift LIKE ? OR day LIKE ?) ORDER BY day DESC, shift LIMIT ?""",
                 (q, like, like, LIMIT))
        return [{"id": t["id"], "day": t["day"], "shift": t["shift"], "plannedOperators": t["planned_operators"],
                 "filledOperators": t["filled_operators"]} for t in r]
    if kind == "episode":
        r = rows(conn, """SELECT e.id, e.started_at, o.name AS operator_name, rb.name AS robot_name, e.task,
                                 e.environment_home, e.object_category, e.lighting, e.status, e.rejection_reason,
                                 e.collect_minutes, e.reset_minutes
                          FROM episodes e JOIN operators o ON o.id = e.operator_id JOIN robots rb ON rb.id = e.robot_id
                          WHERE (? = '' OR e.task LIKE ? OR e.status LIKE ? OR e.environment_home LIKE ?
                                 OR e.object_category LIKE ? OR o.name LIKE ? OR rb.name LIKE ?)
                          ORDER BY e.started_at DESC LIMIT ?""", (q, like, like, like, like, like, like, LIMIT))
        return [{"id": t["id"], "startedAt": t["started_at"], "operatorName": t["operator_name"],
                 "robotName": t["robot_name"], "task": t["task"], "home": t["environment_home"],
                 "object": t["object_category"], "lighting": t["lighting"], "status": t["status"],
                 "rejectionReason": t["rejection_reason"], "collectMinutes": float(t["collect_minutes"] or 0),
                 "resetMinutes": float(t["reset_minutes"] or 0)} for t in r]
    if kind == "incident":
        r = rows(conn, """SELECT i.id, i.occurred_at, rb.name AS robot_name, i.severity, i.is_near_miss, i.root_cause
                          FROM incidents i JOIN robots rb ON rb.id = i.robot_id
                          WHERE (? = '' OR rb.name LIKE ? OR i.severity LIKE ? OR i.root_cause LIKE ?)
                          ORDER BY i.occurred_at DESC LIMIT ?""", (q, like, like, like, LIMIT))
        return [{"id": t["id"], "occurredAt": t["occurred_at"], "robotName": t["robot_name"],
                 "severity": t["severity"], "nearMiss": bool(t["is_near_miss"]), "rootCause": t["root_cause"]}
                for t in r]
    raise ValidationError("Unknown record type")
