import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session
from config import SECRET_KEY, ACCESS_MINUTES, REFRESH_DAYS
from database import get_db
from models import User, utcnow

bearer = HTTPBearer(auto_error=False)


def hash_secret(value: str) -> str:
    return bcrypt.hashpw(value.encode(), bcrypt.gensalt(rounds=10)).decode()


def check_secret(value: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(value.encode(), hashed.encode())
    except Exception:
        return False


def make_token(user_id: int, kind: str) -> str:
    delta = timedelta(minutes=ACCESS_MINUTES) if kind == "access" else timedelta(days=REFRESH_DAYS)
    payload = {"sub": str(user_id), "type": kind, "exp": datetime.now(timezone.utc) + delta}
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def decode_token(token: str, kind: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired. Please sign in again.")
    if payload.get("type") != kind:
        raise HTTPException(401, "Invalid token type")
    return payload


def current_user(creds=Depends(bearer), db: Session = Depends(get_db)) -> User:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    payload = decode_token(creds.credentials, "access")
    user = db.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(401, "User not found")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Fraud analyst access only")
    return user


# --- tiny in-memory sliding-window rate limiter (swap for Redis in production) ---
_hits = defaultdict(list)


def rate_limit(key: str, limit: int, window: int = 60):
    now = time.time()
    _hits[key] = [t for t in _hits[key] if now - t < window]
    if len(_hits[key]) >= limit:
        raise HTTPException(429, "Too many requests. Slow down and try again shortly.")
    _hits[key].append(now)


def check_pin(db: Session, user: User, pin: str):
    """Verify transaction PIN with lockout after 3 wrong attempts."""
    if user.pin_locked_until and user.pin_locked_until > utcnow():
        mins = int((user.pin_locked_until - utcnow()).total_seconds() // 60) + 1
        raise HTTPException(423, f"PIN locked. Try again in {mins} minute(s).")
    if not user.pin_hash or not check_secret(pin or "", user.pin_hash):
        user.failed_pins = (user.failed_pins or 0) + 1
        left = 3 - user.failed_pins
        if left <= 0:
            user.pin_locked_until = utcnow() + timedelta(minutes=15)
            user.failed_pins = 0
            db.commit()
            raise HTTPException(423, "Too many wrong PINs. Transfers are locked for 15 minutes.")
        db.commit()
        raise HTTPException(401, f"Incorrect PIN. {left} attempt(s) left.")
    user.failed_pins = 0
    db.commit()
