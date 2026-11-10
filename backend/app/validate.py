"""Shared validation helpers for the add-data endpoints (port of _validate.ts)."""
from __future__ import annotations

import math
import re
from datetime import date as _date, datetime, timezone
from typing import Any, Sequence


class ValidationError(Exception):
    pass


def _number(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str) and v.strip():
        try:
            return float(v)
        except ValueError:
            return None
    return None


def str_(v: Any, field: str, max_len: int = 120) -> str:
    if not isinstance(v, str) or not v.strip():
        raise ValidationError(f"{field} is required")
    s = v.strip()
    if len(s) > max_len:
        raise ValidationError(f"{field} must be at most {max_len} characters")
    return s


def opt_str(v: Any, field: str, max_len: int = 200) -> str | None:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    return str_(v, field, max_len)


def num(v: Any, field: str, *, min: float | None = None, max: float | None = None, integer: bool = False) -> float:
    n = _number(v)
    if n is None or not math.isfinite(n):
        raise ValidationError(f"{field} must be a number")
    if integer and not n.is_integer():
        raise ValidationError(f"{field} must be a whole number")
    if min is not None and n < min:
        raise ValidationError(f"{field} must be at least {min:g}")
    if max is not None and n > max:
        raise ValidationError(f"{field} must be at most {max:g}")
    return int(n) if integer else n


def opt_num(v: Any, field: str, **opts: Any) -> float | None:
    if v is None or v == "":
        return None
    return num(v, field, **opts)


def date(v: Any, field: str) -> str:
    s = str_(v, field, 10)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        raise ValidationError(f"{field} must be a valid date (YYYY-MM-DD)")
    try:
        _date.fromisoformat(s)
    except ValueError:
        raise ValidationError(f"{field} must be a valid date (YYYY-MM-DD)") from None
    return s


def opt_date(v: Any, field: str) -> str | None:
    if v is None or v == "":
        return None
    return date(v, field)


def timestamp(v: Any, field: str) -> str:
    if not isinstance(v, str) or not v.strip():
        raise ValidationError(f"{field} is required")
    s = v.strip().replace("Z", "+00:00")
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        raise ValidationError(f"{field} must be a valid date and time") from None
    if d.tzinfo is None:  # datetime-local inputs have no zone; treat as UTC
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def one_of(v: Any, allowed: Sequence[str], field: str) -> str:
    s = str_(v, field, 60)
    if s not in allowed:
        raise ValidationError(f"{field} must be one of: {', '.join(allowed)}")
    return s


def clamp_days(v: Any, default: int = 30) -> int:
    n = _number(v)
    n = default if n is None else math.floor(n)
    return int(min(max(n, 1), 90))
