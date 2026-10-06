from datetime import datetime, timezone
from sqlalchemy import (Column, Integer, BigInteger, String, Float, Boolean, DateTime,
                        ForeignKey, JSON, Text, UniqueConstraint)
from sqlalchemy.orm import relationship
from database import Base


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Bank(Base):
    __tablename__ = "banks"
    code = Column(String(10), primary_key=True)
    name = Column(String(80), nullable=False)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    full_name = Column(String(120), nullable=False)
    email = Column(String(160), unique=True, nullable=False, index=True)
    phone = Column(String(20))
    password_hash = Column(String(100), nullable=False)
    pin_hash = Column(String(100))
    role = Column(String(20), default="customer")            # customer | admin
    face_embedding = Column(JSON)                             # mean 128-d vector from enrollment
    face_enrolled_at = Column(DateTime)
    failed_logins = Column(Integer, default=0)
    locked_until = Column(DateTime)
    failed_pins = Column(Integer, default=0)
    pin_locked_until = Column(DateTime)
    created_at = Column(DateTime, default=utcnow)
    accounts = relationship("Account", back_populates="user")


class Account(Base):
    __tablename__ = "accounts"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    account_number = Column(String(10), unique=True, nullable=False, index=True)
    bank_code = Column(String(10), ForeignKey("banks.code"), nullable=False)
    balance_kobo = Column(BigInteger, default=0, nullable=False)   # money is ALWAYS integer kobo
    status = Column(String(12), default="ACTIVE")                   # ACTIVE | FROZEN
    report_count = Column(Integer, default=0)                       # fraud reports against this account
    created_at = Column(DateTime, default=utcnow)
    user = relationship("User", back_populates="accounts")
    bank = relationship("Bank")


class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True)
    reference = Column(String(32), unique=True, nullable=False, index=True)
    idempotency_key = Column(String(64), unique=True)
    type = Column(String(12), default="TRANSFER")           # TRANSFER | FUNDING
    sender_account_id = Column(Integer, ForeignKey("accounts.id"), index=True)
    recipient_account_id = Column(Integer, ForeignKey("accounts.id"), index=True)
    amount_kobo = Column(BigInteger, nullable=False)
    narration = Column(String(140), default="")
    status = Column(String(24), default="COMPLETED", index=True)  # PENDING_VERIFICATION|COMPLETED|CANCELLED|FAILED
    failure_reason = Column(String(160))
    risk_score = Column(Integer, default=0)
    risk_level = Column(String(10), default="LOW")
    risk_reasons = Column(JSON)
    recipient_warning = Column(Text)
    required_steps = Column(JSON)
    completed_steps = Column(JSON)
    otp_code = Column(String(6))
    otp_expires = Column(DateTime)
    otp_attempts = Column(Integer, default=0)
    face_attempts = Column(Integer, default=0)
    save_beneficiary = Column(Boolean, default=False)
    reported = Column(Boolean, default=False)
    device_id = Column(String(64))
    lat = Column(Float)
    lon = Column(Float)
    city = Column(String(60))
    created_at = Column(DateTime, default=utcnow, index=True)
    completed_at = Column(DateTime, index=True)
    sender_account = relationship("Account", foreign_keys=[sender_account_id])
    recipient_account = relationship("Account", foreign_keys=[recipient_account_id])


class LedgerEntry(Base):
    """Double-entry ledger: every transfer writes one DEBIT and one CREDIT."""
    __tablename__ = "ledger_entries"
    id = Column(Integer, primary_key=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), index=True)
    direction = Column(String(6), nullable=False)
    amount_kobo = Column(BigInteger, nullable=False)
    balance_after_kobo = Column(BigInteger, nullable=False)
    created_at = Column(DateTime, default=utcnow)


class Beneficiary(Base):
    __tablename__ = "beneficiaries"
    __table_args__ = (UniqueConstraint("user_id", "account_id"),)
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"))
    nickname = Column(String(60))
    created_at = Column(DateTime, default=utcnow)
    account = relationship("Account")


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("user_id", "device_id"),)
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    device_id = Column(String(64), nullable=False)
    label = Column(String(120))
    first_seen = Column(DateTime, default=utcnow)
    last_seen = Column(DateTime, default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    title = Column(String(120))
    body = Column(String(300))
    kind = Column(String(20), default="info")   # info | credit | debit | security | fraud
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, index=True)
    action = Column(String(60))
    detail = Column(String(300))
    ip = Column(String(45))
    created_at = Column(DateTime, default=utcnow)
