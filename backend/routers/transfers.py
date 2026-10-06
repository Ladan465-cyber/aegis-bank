import random
from datetime import timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session
from config import DEMO_MODE, OTP_TTL_SECONDS, FACE_MATCH_THRESHOLD, MAX_TRANSFER_KOBO
from database import get_db
from models import User, Account, Transaction, utcnow
from routers.accounts import euclid, valid_vec, my_account
from security import current_user, check_pin, rate_limit
from services import (assess, audit, emit, execute_transfer, full_txn, new_reference, next_step, notify, txn_dict)
from ws import hub

router = APIRouter(prefix="/api/transfers", tags=["transfers"])


class Location(BaseModel):
    lat: Optional[float] = None
    lon: Optional[float] = None
    city: Optional[str] = None


class InitiateIn(BaseModel):
    account_number: str
    bank_code: str
    amount: float = Field(gt=0)
    narration: str = Field(default="", max_length=140)
    pin: str
    idempotency_key: str = Field(min_length=8, max_length=64)
    device_id: str = "unknown"
    location: Optional[Location] = None
    save_beneficiary: bool = False


def ids_for(db, user):
    return [a.id for a in db.query(Account.id).filter_by(user_id=user.id)]


def load_mine(db, user, ref, pending=False) -> Transaction:
    t = db.query(Transaction).filter_by(reference=ref).first()
    mine = ids_for(db, user)
    if not t or t.sender_account_id not in mine:
        raise HTTPException(404, "Transaction not found.")
    if pending and t.status != "PENDING_VERIFICATION":
        raise HTTPException(409, f"This transfer is already {t.status.lower().replace('_', ' ')}.")
    return t


def issue_otp(t: Transaction):
    t.otp_code = f"{random.SystemRandom().randint(0, 999999):06d}"
    t.otp_expires = utcnow() + timedelta(seconds=OTP_TTL_SECONDS)
    t.otp_attempts = 0


def finish(db, user, t: Transaction):
    """Run the transfer if every required step is done; return the response."""
    if t.status == "PENDING_VERIFICATION" and next_step(t) is None:
        execute_transfer(db, t)
        audit(db, user.id, "TRANSFER_" + t.status, f"{t.reference} verified with {','.join(t.completed_steps or []) or 'none'}")
    db.commit()
    emit(t, "transaction")
    return full_txn(t, ids_for(db, user), DEMO_MODE)


@router.post("/initiate")
def initiate(body: InitiateIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rate_limit(f"xfer:{user.id}", 20)
    mine = ids_for(db, user)
    existing = db.query(Transaction).filter_by(idempotency_key=body.idempotency_key).first()
    if existing:                                    # double-click / retry safe: never sends twice
        if existing.sender_account_id not in mine:
            raise HTTPException(409, "Duplicate request key.")
        return full_txn(existing, mine, DEMO_MODE)

    sender = db.query(Account).filter_by(user_id=user.id).first()
    if sender.status != "ACTIVE":
        raise HTTPException(403, "Your account is frozen. Unfreeze it in Security to send money.")
    check_pin(db, user, body.pin)

    kobo = int(round(body.amount * 100))
    if kobo < 100:
        raise HTTPException(400, "Minimum transfer is ₦1.")
    if kobo > MAX_TRANSFER_KOBO:
        raise HTTPException(400, "Maximum single transfer is ₦10,000,000.")
    recipient = db.query(Account).filter_by(account_number=body.account_number, bank_code=body.bank_code).first()
    if not recipient:
        raise HTTPException(404, "Recipient account does not exist.")
    if recipient.id == sender.id:
        raise HTTPException(400, "You cannot send money to yourself.")
    if recipient.status != "ACTIVE":
        raise HTTPException(400, "That account cannot receive funds right now.")
    if sender.balance_kobo < kobo:
        raise HTTPException(400, "Insufficient funds.")

    loc = body.location.model_dump() if body.location else None
    risk = assess(db, user, sender, recipient, kobo, body.device_id, loc)
    t = Transaction(
        reference=new_reference(), idempotency_key=body.idempotency_key, type="TRANSFER",
        sender_account_id=sender.id, recipient_account_id=recipient.id, amount_kobo=kobo,
        narration=body.narration, status="PENDING_VERIFICATION", risk_score=risk["score"], risk_level=risk["level"],
        risk_reasons=risk["reasons"], recipient_warning=risk["recipient_warning"],
        required_steps=risk["required_steps"], completed_steps=[], save_beneficiary=body.save_beneficiary,
        device_id=body.device_id, lat=(loc or {}).get("lat"), lon=(loc or {}).get("lon"), city=(loc or {}).get("city"),
    )
    if "otp" in t.required_steps:
        issue_otp(t)
    db.add(t)
    db.flush()
    t.sender_account, t.recipient_account = sender, recipient
    if risk["level"] != "LOW":
        notify(db, user.id, f"Extra verification required ({risk['level'].title()} risk)",
               f"A transfer of ₦{kobo / 100:,.2f} to {recipient.user.full_name} needs {' + '.join(risk['required_steps'])}.", "fraud")
        audit(db, user.id, "STEP_UP", f"{t.reference} score={risk['score']} level={risk['level']}", request.client.host)
    return finish(db, user, t)


@router.get("")
def history(limit: int = 50, status: str = "", direction: str = "", q: str = "",
            user: User = Depends(current_user), db: Session = Depends(get_db)):
    mine = ids_for(db, user)
    query = db.query(Transaction).filter(or_(Transaction.sender_account_id.in_(mine), Transaction.recipient_account_id.in_(mine)))
    query = query.filter(~((Transaction.status == "PENDING_VERIFICATION") & Transaction.recipient_account_id.in_(mine)
                           & ~Transaction.sender_account_id.in_(mine)))
    if status:
        query = query.filter(Transaction.status == status)
    if direction == "debit":
        query = query.filter(Transaction.sender_account_id.in_(mine))
    elif direction == "credit":
        query = query.filter(Transaction.recipient_account_id.in_(mine), or_(Transaction.sender_account_id.is_(None), ~Transaction.sender_account_id.in_(mine)))
    rows = query.order_by(Transaction.id.desc()).limit(min(limit, 200)).all()
    out = [txn_dict(t, mine) for t in rows]
    if q:
        ql = q.lower()
        out = [t for t in out if ql in (t["sender"]["name"] + t["recipient"]["name"] + t["reference"] + (t["narration"] or "")).lower()]
    return out


@router.get("/{ref}")
def get_one(ref: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = db.query(Transaction).filter_by(reference=ref).first()
    mine = ids_for(db, user)
    if not t or (t.sender_account_id not in mine and t.recipient_account_id not in mine):
        raise HTTPException(404, "Transaction not found.")
    if t.sender_account_id not in mine:      # recipients see the receipt only, never the sender's risk analysis
        return txn_dict(t, mine)
    return full_txn(t, mine, DEMO_MODE)


class OtpIn(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


@router.post("/{ref}/otp")
def verify_otp(ref: str, body: OtpIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = load_mine(db, user, ref, pending=True)
    if next_step(t) != "otp":
        raise HTTPException(409, "OTP is not the current step.")
    if utcnow() > t.otp_expires:
        raise HTTPException(400, "That code has expired. Request a new one.")
    if body.code != t.otp_code:
        t.otp_attempts += 1
        if t.otp_attempts >= 5:
            t.status, t.failure_reason = "CANCELLED", "Too many wrong OTP attempts."
            db.commit()
            emit(t)
            raise HTTPException(400, "Too many wrong codes. This transfer was cancelled for your safety.")
        db.commit()
        raise HTTPException(400, f"Wrong code. {5 - t.otp_attempts} attempt(s) left.")
    t.completed_steps = (t.completed_steps or []) + ["otp"]
    return finish(db, user, t)


@router.post("/{ref}/otp/resend")
def resend_otp(ref: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rate_limit(f"otp:{user.id}", 5)
    t = load_mine(db, user, ref, pending=True)
    if next_step(t) != "otp":
        raise HTTPException(409, "OTP is not the current step.")
    issue_otp(t)
    db.commit()
    return full_txn(t, ids_for(db, user), DEMO_MODE)


class FaceIn(BaseModel):
    descriptor: list[float]


@router.post("/{ref}/face")
def verify_face(ref: str, body: FaceIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = load_mine(db, user, ref, pending=True)
    if next_step(t) != "face":
        raise HTTPException(409, "Face verification is not the current step.")
    if user.face_embedding is None:
        raise HTTPException(409, "FACE_NOT_ENROLLED")
    if not valid_vec(body.descriptor):
        raise HTTPException(400, "Could not read a face. Try again.")
    dist = euclid(user.face_embedding, body.descriptor)
    matched = dist <= FACE_MATCH_THRESHOLD
    if matched:
        t.completed_steps = (t.completed_steps or []) + ["face"]
    else:
        t.face_attempts = (t.face_attempts or 0) + 1
        if t.face_attempts >= 3:
            t.status, t.failure_reason = "CANCELLED", "Face verification failed 3 times."
            notify(db, user.id, "Transfer cancelled: face mismatch",
                   f"3 failed face checks on {t.reference}. If this wasn't you, freeze your account.", "fraud")
            audit(db, user.id, "FACE_MISMATCH", f"{t.reference} cancelled after 3 failures", request.client.host)
    result = finish(db, user, t)
    return {"matched": matched, "distance": round(dist, 3), "threshold": FACE_MATCH_THRESHOLD,
            "confidence": max(0, min(100, round((1 - dist / 0.8) * 100))), "transaction": result}


class ConfirmIn(BaseModel):
    acknowledged: bool


@router.post("/{ref}/confirm")
def confirm(ref: str, body: ConfirmIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = load_mine(db, user, ref, pending=True)
    if next_step(t) != "confirm":
        raise HTTPException(409, "Confirmation is not the current step.")
    if not body.acknowledged:
        raise HTTPException(400, "Please confirm you understand the warning.")
    t.completed_steps = (t.completed_steps or []) + ["confirm"]
    return finish(db, user, t)


@router.post("/{ref}/cancel")
def cancel(ref: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = load_mine(db, user, ref, pending=True)
    t.status, t.failure_reason = "CANCELLED", "Cancelled by you."
    db.commit()
    emit(t)
    return full_txn(t, ids_for(db, user), DEMO_MODE)


@router.post("/{ref}/report")
def report(ref: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """'This was a scam': flags the recipient account so future senders get warned."""
    t = load_mine(db, user, ref)
    if t.reported:
        raise HTTPException(400, "You already reported this transfer.")
    t.reported = True
    if t.recipient_account:
        t.recipient_account.report_count = (t.recipient_account.report_count or 0) + 1
    audit(db, user.id, "FRAUD_REPORT", t.reference, request.client.host)
    notify(db, user.id, "Report received", "Our fraud team has been alerted and the recipient account is under review.", "security")
    db.commit()
    emit(t, "report")
    return {"ok": True}
