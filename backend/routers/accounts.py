import math
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session
from config import FACE_MATCH_THRESHOLD
from database import get_db
from models import (User, Account, Bank, Beneficiary, Device, Notification, AuditLog, Transaction,
                    LedgerEntry, utcnow)
from routers.auth import user_dict
from security import current_user, check_pin, check_secret, hash_secret, rate_limit
from services import audit, iso, notify, txn_dict, new_reference, gather_recipient
from fraud import analyze_recipient, recipient_score

router = APIRouter(prefix="/api", tags=["accounts"])


def my_account(db, user) -> Account:
    a = db.query(Account).filter_by(user_id=user.id).first()
    if not a:
        raise HTTPException(404, "No account found")
    return a


@router.get("/banks")
def banks(db: Session = Depends(get_db)):
    return [{"code": b.code, "name": b.name} for b in db.query(Bank).order_by(Bank.name)]


@router.get("/accounts/resolve")
def resolve(account_number: str, bank_code: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Name enquiry: confirms the account exists before any money moves (like NIBSS)."""
    rate_limit(f"resolve:{user.id}", 30)
    if not (account_number.isdigit() and len(account_number) == 10):
        raise HTTPException(400, "Account number must be 10 digits.")
    a = db.query(Account).filter_by(account_number=account_number, bank_code=bank_code).first()
    if not a:
        raise HTTPException(404, "Account not found. Check the number and bank.")
    if a.user_id == user.id:
        raise HTTPException(400, "You cannot send money to your own account.")
    return {"account_number": a.account_number, "account_name": a.user.full_name.upper(),
            "bank": a.bank.name, "bank_code": a.bank_code}


@router.get("/accounts/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_dict(user)


@router.get("/accounts/summary")
def summary(user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = my_account(db, user)
    now = utcnow()
    since = now - timedelta(days=30)
    rows = db.query(Transaction).filter(
        (Transaction.sender_account_id == a.id) | (Transaction.recipient_account_id == a.id),
        Transaction.status == "COMPLETED", Transaction.completed_at >= since).all()
    total_in = sum(t.amount_kobo for t in rows if t.recipient_account_id == a.id)
    total_out = sum(t.amount_kobo for t in rows if t.sender_account_id == a.id)
    daily = {}
    for i in range(14):
        daily[(now - timedelta(days=13 - i)).date().isoformat()] = 0
    for t in rows:
        if t.sender_account_id == a.id and t.completed_at.date().isoformat() in daily:
            daily[t.completed_at.date().isoformat()] += t.amount_kobo
    stepped = db.query(func.count(Transaction.id)).filter(
        Transaction.sender_account_id == a.id, Transaction.risk_score >= 30, Transaction.created_at >= since).scalar()
    pending = db.query(Transaction).filter_by(sender_account_id=a.id, status="PENDING_VERIFICATION").count()
    return {"total_in_kobo": total_in, "total_out_kobo": total_out, "stepped_up": stepped, "pending": pending,
            "daily_out": [{"date": d, "amount": v / 100} for d, v in daily.items()]}


class FundIn(BaseModel):
    amount: float = Field(gt=0, le=1_000_000)


@router.post("/accounts/fund")
def fund(body: FundIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Demo top-up so presenters can never run out of money on stage."""
    a = db.query(Account).filter_by(id=my_account(db, user).id).with_for_update().one()
    kobo = int(round(body.amount * 100))
    a.balance_kobo += kobo
    t = Transaction(reference=new_reference(), type="FUNDING", recipient_account_id=a.id, amount_kobo=kobo,
                    narration="Demo top-up", status="COMPLETED", completed_at=utcnow(), required_steps=[], completed_steps=[])
    db.add(t)
    db.flush()
    db.add(LedgerEntry(transaction_id=t.id, account_id=a.id, direction="CREDIT", amount_kobo=kobo, balance_after_kobo=a.balance_kobo))
    db.commit()
    return user_dict(user)


class PinIn(BaseModel):
    current_pin: str = Field(pattern=r"^\d{4}$")
    new_pin: str = Field(pattern=r"^\d{4}$")


@router.post("/accounts/pin")
def change_pin(body: PinIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    check_pin(db, user, body.current_pin)
    user.pin_hash = hash_secret(body.new_pin)
    audit(db, user.id, "PIN_CHANGED", "Transaction PIN changed", request.client.host)
    notify(db, user.id, "Transaction PIN changed", "If this was not you, freeze your account now.", "security")
    db.commit()
    return {"ok": True}


class FreezeIn(BaseModel):
    frozen: bool


@router.post("/accounts/freeze")
def freeze(body: FreezeIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = my_account(db, user)
    a.status = "FROZEN" if body.frozen else "ACTIVE"
    audit(db, user.id, "ACCOUNT_FROZEN" if body.frozen else "ACCOUNT_UNFROZEN", "Self-service", request.client.host)
    db.commit()
    return user_dict(user)


# -------------------------------------------------------------------------- beneficiaries
class BenIn(BaseModel):
    account_number: str
    bank_code: str
    nickname: str = ""


def ben_dict(b: Beneficiary, db):
    a = b.account
    rec = analyze_recipient(gather_recipient(db, a, utcnow()), utcnow())
    return {"id": b.id, "nickname": b.nickname or a.user.full_name, "name": a.user.full_name,
            "account_number": a.account_number, "bank_code": a.bank_code, "bank": a.bank.name,
            "flagged": recipient_score(rec) >= 30}


@router.get("/beneficiaries")
def list_bens(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [ben_dict(b, db) for b in db.query(Beneficiary).filter_by(user_id=user.id).order_by(Beneficiary.created_at.desc())]


@router.post("/beneficiaries")
def add_ben(body: BenIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = db.query(Account).filter_by(account_number=body.account_number, bank_code=body.bank_code).first()
    if not a or a.user_id == user.id:
        raise HTTPException(404, "Account not found.")
    if db.query(Beneficiary).filter_by(user_id=user.id, account_id=a.id).first():
        raise HTTPException(400, "Already saved.")
    b = Beneficiary(user_id=user.id, account_id=a.id, nickname=body.nickname or a.user.full_name.split()[0])
    db.add(b)
    db.commit()
    return ben_dict(b, db)


@router.delete("/beneficiaries/{bid}")
def del_ben(bid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = db.query(Beneficiary).filter_by(id=bid, user_id=user.id).first()
    if b:
        db.delete(b)
        db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ devices / audit / notifications
@router.get("/devices")
def devices(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [{"id": d.id, "device_id": d.device_id, "label": d.label, "first_seen": iso(d.first_seen), "last_seen": iso(d.last_seen)}
            for d in db.query(Device).filter_by(user_id=user.id).order_by(Device.last_seen.desc())]


@router.delete("/devices/{did}")
def remove_device(did: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.query(Device).filter_by(id=did, user_id=user.id).first()
    if d:
        db.delete(d)
        db.commit()
    return {"ok": True}


@router.get("/audit")
def audit_log(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(AuditLog).filter_by(user_id=user.id).order_by(AuditLog.id.desc()).limit(40).all()
    return [{"action": r.action, "detail": r.detail, "ip": r.ip, "created_at": iso(r.created_at)} for r in rows]


@router.get("/notifications")
def notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Notification).filter_by(user_id=user.id).order_by(Notification.id.desc()).limit(60).all()
    return [{"id": n.id, "title": n.title, "body": n.body, "kind": n.kind, "is_read": n.is_read, "created_at": iso(n.created_at)} for n in rows]


@router.post("/notifications/read-all")
def read_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter_by(user_id=user.id, is_read=False).update({"is_read": True})
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------------------- face
def euclid(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def valid_vec(v):
    return isinstance(v, list) and len(v) == 128 and all(isinstance(x, (int, float)) for x in v)


class EnrollIn(BaseModel):
    pin: str
    samples: list[list[float]]     # 3+ embeddings captured in the browser by face-api.js


@router.get("/face/status")
def face_status(user: User = Depends(current_user)):
    return {"enrolled": user.face_embedding is not None, "enrolled_at": iso(user.face_enrolled_at)}


@router.post("/face/enroll")
def enroll(body: EnrollIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    check_pin(db, user, body.pin)
    if len(body.samples) < 3 or not all(valid_vec(s) for s in body.samples):
        raise HTTPException(400, "Capture at least 3 clear face samples.")
    # all samples must be the same person, otherwise someone is spoofing the enrolment itself
    for s in body.samples[1:]:
        if euclid(body.samples[0], s) > FACE_MATCH_THRESHOLD:
            raise HTTPException(400, "The captured samples do not look like the same face. Try again in steady light.")
    mean = [sum(col) / len(body.samples) for col in zip(*body.samples)]
    user.face_embedding = mean
    user.face_enrolled_at = utcnow()
    audit(db, user.id, "FACE_ENROLLED", "Face enrolled", request.client.host)
    notify(db, user.id, "Face enrolled", "Your face is now used to protect risky transfers.", "security")
    db.commit()
    return {"enrolled": True}
