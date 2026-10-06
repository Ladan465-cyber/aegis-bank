import secrets
from datetime import timedelta
from sqlalchemy import func
from sqlalchemy.orm import Session
from fraud import evaluate
from models import (Account, Transaction, LedgerEntry, Beneficiary, Notification, AuditLog, utcnow)
from ws import hub


def iso(dt):
    return dt.isoformat() + "Z" if dt else None


def new_reference():
    return "AEG" + utcnow().strftime("%y%m%d%H%M%S") + secrets.token_hex(2).upper()


def notify(db: Session, user_id, title, body, kind="info"):
    db.add(Notification(user_id=user_id, title=title, body=body, kind=kind))


def audit(db: Session, user_id, action, detail="", ip=None):
    db.add(AuditLog(user_id=user_id, action=action, detail=detail[:300], ip=ip))


def party(acct):
    if not acct:
        return {"name": "Wallet top-up", "account_number": "-", "bank": "Demo funding"}
    return {"name": acct.user.full_name, "account_number": acct.account_number,
            "bank": acct.bank.name if acct.bank else acct.bank_code}


def txn_dict(t: Transaction, my_account_ids=None):
    direction = None
    if my_account_ids is not None:
        if t.recipient_account_id in my_account_ids and t.sender_account_id not in my_account_ids:
            direction = "credit"
        elif t.sender_account_id in my_account_ids:
            direction = "debit"
    return {
        "reference": t.reference, "type": t.type, "status": t.status, "failure_reason": t.failure_reason,
        "amount_kobo": t.amount_kobo, "narration": t.narration, "direction": direction,
        "sender": party(t.sender_account), "recipient": party(t.recipient_account),
        "risk_score": t.risk_score or 0, "risk_level": t.risk_level or "LOW",
        "verified_with": t.completed_steps or [], "reported": bool(t.reported),
        "city": t.city, "created_at": iso(t.created_at), "completed_at": iso(t.completed_at),
    }


def next_step(t: Transaction):
    for s in (t.required_steps or []):
        if s not in (t.completed_steps or []):
            return s
    return None


def full_txn(t: Transaction, my_account_ids=None, demo=True):
    d = txn_dict(t, my_account_ids)
    d.update({
        "required_steps": t.required_steps or [], "completed_steps": t.completed_steps or [],
        "next_step": next_step(t) if t.status == "PENDING_VERIFICATION" else None,
        "risk": {"score": t.risk_score or 0, "level": t.risk_level or "LOW",
                 "reasons": t.risk_reasons or [], "recipient_warning": t.recipient_warning},
        "face_attempts_left": max(0, 3 - (t.face_attempts or 0)),
    })
    if demo and t.status == "PENDING_VERIFICATION" and next_step(t) == "otp":
        d["demo_otp"] = t.otp_code                    # DEMO ONLY: shown in the OTP modal
        d["otp_expires"] = iso(t.otp_expires)
    return d


# ----------------------------------------------------- fraud-engine data gathering
def gather_recipient(db: Session, acct: Account, now, hours=72):
    since = now - timedelta(hours=hours)
    base = db.query(Transaction).filter(Transaction.type == "TRANSFER", Transaction.status == "COMPLETED",
                                        Transaction.completed_at >= since)
    ins = base.filter(Transaction.recipient_account_id == acct.id).all()
    outs = base.filter(Transaction.sender_account_id == acct.id).all()
    return {
        "created_at": acct.created_at, "report_count": acct.report_count or 0,
        "inflows": [{"sender": t.sender_account_id, "amount_kobo": t.amount_kobo, "at": t.completed_at} for t in ins],
        "outflows": [{"to": t.recipient_account_id, "amount_kobo": t.amount_kobo, "at": t.completed_at} for t in outs],
    }


def gather_history(db: Session, acct: Account, now, days=90):
    rows = db.query(Transaction).filter(
        Transaction.sender_account_id == acct.id, Transaction.type == "TRANSFER",
        Transaction.status == "COMPLETED", Transaction.completed_at >= now - timedelta(days=days)).all()
    return [{"amount_kobo": t.amount_kobo, "at": t.completed_at, "lat": t.lat, "lon": t.lon} for t in rows]


def assess(db, user, sender: Account, recipient: Account, amount_kobo, device_id, location):
    from models import Device
    now = utcnow()
    prior = db.query(Transaction.id).filter(
        Transaction.sender_account_id == sender.id, Transaction.recipient_account_id == recipient.id,
        Transaction.status == "COMPLETED").first()
    saved = db.query(Beneficiary.id).filter(Beneficiary.user_id == user.id, Beneficiary.account_id == recipient.id).first()
    recent = db.query(func.count(Transaction.id)).filter(
        Transaction.sender_account_id == sender.id, Transaction.created_at >= now - timedelta(minutes=10),
        Transaction.status.in_(["COMPLETED", "PENDING_VERIFICATION"])).scalar() or 0
    known = db.query(Device.id).filter(Device.user_id == user.id, Device.device_id == device_id).first() is not None
    return evaluate({
        "amount_kobo": amount_kobo, "balance_kobo": sender.balance_kobo, "now": now,
        "history": gather_history(db, sender, now), "recent_attempts": recent, "known_device": known,
        "location": location, "new_beneficiary": not (prior or saved),
        "recipient": gather_recipient(db, recipient, now),
    })


# ------------------------------------------------------------------ money movement
def execute_transfer(db: Session, t: Transaction) -> bool:
    """Atomic double-entry posting. Row-locks both accounts (in id order, avoiding deadlocks)."""
    ids = sorted({t.sender_account_id, t.recipient_account_id})
    locked = {a.id: a for a in db.query(Account).filter(Account.id.in_(ids)).order_by(Account.id).with_for_update().all()}
    s, r = locked[t.sender_account_id], locked[t.recipient_account_id]

    def fail(reason):
        t.status, t.failure_reason = "FAILED", reason
        notify(db, s.user_id, "Transfer failed", reason, "security")
        return False

    if t.status == "COMPLETED":
        return True
    if s.status != "ACTIVE":
        return fail("Your account is frozen.")
    if r.status != "ACTIVE":
        return fail("Recipient account cannot receive funds right now.")
    if s.balance_kobo < t.amount_kobo:
        return fail("Insufficient funds.")

    s.balance_kobo -= t.amount_kobo
    r.balance_kobo += t.amount_kobo
    now = utcnow()
    t.status, t.completed_at = "COMPLETED", now
    db.add_all([
        LedgerEntry(transaction_id=t.id, account_id=s.id, direction="DEBIT", amount_kobo=t.amount_kobo, balance_after_kobo=s.balance_kobo),
        LedgerEntry(transaction_id=t.id, account_id=r.id, direction="CREDIT", amount_kobo=t.amount_kobo, balance_after_kobo=r.balance_kobo),
    ])
    amt = f"₦{t.amount_kobo / 100:,.2f}"
    notify(db, s.user_id, "Transfer successful", f"{amt} sent to {r.user.full_name}.", "debit")
    notify(db, r.user_id, "Credit alert", f"{amt} received from {s.user.full_name}.", "credit")
    if t.save_beneficiary and not db.query(Beneficiary.id).filter_by(user_id=s.user_id, account_id=r.id).first():
        db.add(Beneficiary(user_id=s.user_id, account_id=r.id, nickname=r.user.full_name.split()[0]))
    return True


def emit(t: Transaction, kind="transaction"):
    """Push an event to analyst dashboards (call after commit)."""
    d = txn_dict(t)
    d["risk_reasons"] = t.risk_reasons or []
    d["recipient_warning"] = t.recipient_warning
    hub.publish({"type": kind, "data": d})
