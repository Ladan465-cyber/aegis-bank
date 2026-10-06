import random
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from database import get_db
from models import User, Account, Device, Transaction, LedgerEntry, utcnow
from security import (hash_secret, check_secret, make_token, decode_token, current_user, rate_limit)
from services import audit, notify

router = APIRouter(prefix="/api/auth", tags=["auth"])
STARTER_KOBO = 50_000 * 100


class RegisterIn(BaseModel):
    full_name: str = Field(min_length=3, max_length=120)
    email: str = Field(min_length=5, max_length=160)
    phone: str = ""
    password: str = Field(min_length=8, max_length=72)
    pin: str = Field(pattern=r"^\d{4}$")
    device_id: str = "unknown"


class LoginIn(BaseModel):
    email: str
    password: str
    device_id: str = "unknown"


class RefreshIn(BaseModel):
    refresh_token: str


def user_dict(u: User):
    acct = u.accounts[0] if u.accounts else None
    return {"id": u.id, "full_name": u.full_name, "email": u.email, "phone": u.phone, "role": u.role,
            "face_enrolled": u.face_embedding is not None, "has_pin": bool(u.pin_hash),
            "account": {"account_number": acct.account_number, "bank_code": acct.bank_code,
                        "bank": acct.bank.name, "balance_kobo": acct.balance_kobo, "status": acct.status} if acct else None}


def tokens(u: User):
    return {"access_token": make_token(u.id, "access"), "refresh_token": make_token(u.id, "refresh"), "user": user_dict(u)}


def trust_device(db, user, device_id, ua):
    d = db.query(Device).filter_by(user_id=user.id, device_id=device_id).first()
    if d:
        d.last_seen = utcnow()
    else:
        db.add(Device(user_id=user.id, device_id=device_id, label=(ua or "Browser")[:110]))


@router.post("/register")
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    rate_limit(f"reg:{request.client.host}", 10)
    email = body.email.strip().lower()
    if "@" not in email or db.query(User).filter_by(email=email).first():
        raise HTTPException(400, "That email is invalid or already registered.")
    u = User(full_name=body.full_name.strip(), email=email, phone=body.phone,
             password_hash=hash_secret(body.password), pin_hash=hash_secret(body.pin), role="customer")
    db.add(u)
    db.flush()
    while True:
        number = "".join(random.choices("0123456789", k=10))
        if not db.query(Account.id).filter_by(account_number=number).first():
            break
    acct = Account(user_id=u.id, account_number=number, bank_code="900", balance_kobo=STARTER_KOBO)
    db.add(acct)
    db.flush()
    t = Transaction(reference="AEGWELCOME" + number, type="FUNDING", recipient_account_id=acct.id,
                    amount_kobo=STARTER_KOBO, narration="Welcome bonus", status="COMPLETED",
                    completed_at=utcnow(), risk_level="LOW", completed_steps=[], required_steps=[])
    db.add(t)
    db.flush()
    db.add(LedgerEntry(transaction_id=t.id, account_id=acct.id, direction="CREDIT", amount_kobo=STARTER_KOBO,
                       balance_after_kobo=STARTER_KOBO))
    trust_device(db, u, body.device_id, request.headers.get("user-agent"))
    notify(db, u.id, "Welcome to Aegis", "Your account is ready. Enrol your face in Security to unlock stronger protection.", "info")
    audit(db, u.id, "REGISTER", "Account created", request.client.host)
    db.commit()
    return tokens(u)


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host
    rate_limit(f"login:{ip}", 15)
    u = db.query(User).filter_by(email=body.email.strip().lower()).first()
    if u and u.locked_until and u.locked_until > utcnow():
        raise HTTPException(423, "Account temporarily locked after repeated failed logins. Try again in 15 minutes.")
    if not u or not check_secret(body.password, u.password_hash):
        if u:
            u.failed_logins = (u.failed_logins or 0) + 1
            if u.failed_logins >= 5:
                u.locked_until = utcnow() + timedelta(minutes=15)
                u.failed_logins = 0
            audit(db, u.id, "LOGIN_FAILED", "Wrong password", ip)
            db.commit()
        raise HTTPException(401, "Incorrect email or password.")
    u.failed_logins = 0
    trust_device(db, u, body.device_id, request.headers.get("user-agent"))
    audit(db, u.id, "LOGIN", "Signed in", ip)
    db.commit()
    return tokens(u)


@router.post("/refresh")
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    payload = decode_token(body.refresh_token, "refresh")
    u = db.get(User, int(payload["sub"]))
    if not u:
        raise HTTPException(401, "User not found")
    return tokens(u)


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_dict(user)
