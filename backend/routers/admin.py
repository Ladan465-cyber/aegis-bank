from collections import Counter
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import get_db
from fraud import analyze_recipient, recipient_score
from models import User, Account, Transaction, utcnow
from security import admin_user
from services import gather_recipient, txn_dict, iso, audit

router = APIRouter(prefix="/api/admin", tags=["admin"])


def admin_row(t: Transaction):
    d = txn_dict(t)
    d["risk_reasons"] = t.risk_reasons or []
    d["recipient_warning"] = t.recipient_warning
    return d


@router.get("/stats")
def stats(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    now = utcnow()
    day = now - timedelta(hours=24)
    base = db.query(Transaction).filter(Transaction.type == "TRANSFER")
    recent = base.filter(Transaction.created_at >= day).all()
    levels = Counter(t.risk_level or "LOW" for t in recent)
    reasons = Counter()
    for t in recent:
        for r in (t.risk_reasons or []):
            reasons[r["title"]] += 1
    hourly = {}
    for i in range(24):
        h = (now - timedelta(hours=23 - i)).replace(minute=0, second=0, microsecond=0)
        hourly[h] = {"hour": h.strftime("%H:00"), "total": 0, "flagged": 0}
    for t in recent:
        h = t.created_at.replace(minute=0, second=0, microsecond=0)
        if h in hourly:
            hourly[h]["total"] += 1
            hourly[h]["flagged"] += 1 if (t.risk_score or 0) >= 30 else 0
    completed = [t for t in recent if t.status == "COMPLETED"]
    return {
        "total_24h": len(recent),
        "flagged_24h": sum(1 for t in recent if (t.risk_score or 0) >= 30),
        "stepped_up_pending": base.filter(Transaction.status == "PENDING_VERIFICATION").count(),
        "cancelled_24h": sum(1 for t in recent if t.status == "CANCELLED"),
        "volume_kobo": sum(t.amount_kobo for t in completed),
        "avg_risk": round(sum((t.risk_score or 0) for t in recent) / max(1, len(recent)), 1),
        "levels": [{"level": k, "count": levels.get(k, 0)} for k in ("LOW", "MEDIUM", "HIGH", "CRITICAL")],
        "top_reasons": [{"reason": k, "count": v} for k, v in reasons.most_common(6)],
        "hourly": list(hourly.values()),
    }


@router.get("/feed")
def feed(limit: int = 40, only_flagged: bool = False, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    q = db.query(Transaction).filter(Transaction.type == "TRANSFER")
    if only_flagged:
        q = q.filter(Transaction.risk_score >= 30)
    return [admin_row(t) for t in q.order_by(Transaction.id.desc()).limit(min(limit, 200)).all()]


@router.get("/suspicious")
def suspicious(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    """Accounts whose last-72h behaviour looks like a Ponzi collector or money mule."""
    now = utcnow()
    since = now - timedelta(hours=72)
    cands = (db.query(Transaction.recipient_account_id, func.count(Transaction.id))
             .filter(Transaction.type == "TRANSFER", Transaction.status == "COMPLETED", Transaction.completed_at >= since)
             .group_by(Transaction.recipient_account_id).having(func.count(Transaction.id) >= 4).all())
    out = []
    for acct_id, _n in cands:
        acct = db.get(Account, acct_id)
        reasons = analyze_recipient(gather_recipient(db, acct, now), now)
        score = recipient_score(reasons)
        if score >= 20:
            rec = gather_recipient(db, acct, now)
            out.append({"account_number": acct.account_number, "name": acct.user.full_name, "bank": acct.bank.name,
                        "status": acct.status, "score": score, "reports": acct.report_count or 0,
                        "senders": len({i["sender"] for i in rec["inflows"]}),
                        "inflow_kobo": sum(i["amount_kobo"] for i in rec["inflows"]),
                        "reasons": reasons})
    return sorted(out, key=lambda x: -x["score"])


@router.get("/network/{account_number}")
def network(account_number: str, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    """Money-flow graph around one account for the last 7 days."""
    acct = db.query(Account).filter_by(account_number=account_number).first()
    if not acct:
        raise HTTPException(404, "Account not found")
    since = utcnow() - timedelta(days=7)
    q = db.query(Transaction).filter(Transaction.type == "TRANSFER", Transaction.status == "COMPLETED",
                                     Transaction.completed_at >= since)
    ins, outs = {}, {}
    for t in q.filter(Transaction.recipient_account_id == acct.id):
        e = ins.setdefault(t.sender_account_id, {"amount_kobo": 0, "count": 0})
        e["amount_kobo"] += t.amount_kobo
        e["count"] += 1
    for t in q.filter(Transaction.sender_account_id == acct.id):
        e = outs.setdefault(t.recipient_account_id, {"amount_kobo": 0, "count": 0})
        e["amount_kobo"] += t.amount_kobo
        e["count"] += 1

    def node(a_id, role):
        a = db.get(Account, a_id)
        return {"id": a.account_number, "name": a.user.full_name, "bank": a.bank.name, "role": role}

    reasons = analyze_recipient(gather_recipient(db, acct, utcnow()), utcnow())
    return {
        "center": {"id": acct.account_number, "name": acct.user.full_name, "bank": acct.bank.name,
                   "score": recipient_score(reasons), "reports": acct.report_count or 0, "status": acct.status},
        "senders": [{**node(k, "sender"), **v} for k, v in sorted(ins.items(), key=lambda kv: -kv[1]["amount_kobo"])[:40]],
        "payees": [{**node(k, "payee"), **v} for k, v in sorted(outs.items(), key=lambda kv: -kv[1]["amount_kobo"])[:12]],
        "total_in_kobo": sum(v["amount_kobo"] for v in ins.values()),
        "total_out_kobo": sum(v["amount_kobo"] for v in outs.values()),
        "sender_count": len(ins), "reasons": reasons,
    }


@router.post("/accounts/{account_number}/freeze")
def freeze(account_number: str, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    acct = db.query(Account).filter_by(account_number=account_number).first()
    if not acct:
        raise HTTPException(404, "Account not found")
    acct.status = "ACTIVE" if acct.status == "FROZEN" else "FROZEN"
    audit(db, admin.id, "ADMIN_FREEZE" if acct.status == "FROZEN" else "ADMIN_UNFREEZE", account_number)
    db.commit()
    return {"account_number": account_number, "status": acct.status}
