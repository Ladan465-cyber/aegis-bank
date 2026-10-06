"""
Aegis real-time fraud engine.

Pure functions only (no DB, no network) so every rule is unit-testable.
The engine NEVER blocks a transfer. It produces a 0-100 risk score, a list of
human-readable reasons, and the verification steps ("step-up") the customer must pass.

    score  0-29  LOW       -> goes through instantly
    score 30-59  MEDIUM    -> OTP
    score 60-84  HIGH      -> OTP + face verification
    score 85+    CRITICAL  -> OTP + face verification + explicit confirmation of the warning
"""
import math
import statistics
from datetime import timedelta

STEPS_BY_LEVEL = {
    "LOW": [],
    "MEDIUM": ["otp"],
    "HIGH": ["otp", "face"],
    "CRITICAL": ["otp", "face", "confirm"],
}
RECIPIENT_CAP = 55
MIN_HISTORY = 5          # below this we are in "cold start" and use absolute thresholds
NEW_LOCATION_KM = 150
LAGOS_UTC_OFFSET = 1


def naira(kobo):
    return f"₦{kobo / 100:,.0f}"


def level_for(score):
    if score >= 85:
        return "CRITICAL"
    if score >= 60:
        return "HIGH"
    if score >= 30:
        return "MEDIUM"
    return "LOW"


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _reason(code, title, detail, points, scope="customer"):
    return {"code": code, "title": title, "detail": detail, "points": points, "scope": scope}


# ----------------------------------------------------------------- customer signals
def amount_signal(amount_kobo, history):
    amounts = sorted(h["amount_kobo"] for h in history)
    n = len(amounts)
    if n < MIN_HISTORY:
        # Cold start: no personal baseline yet, fall back to absolute thresholds.
        for limit, pts in ((1_000_000, 35), (500_000, 28), (200_000, 18), (100_000, 10)):
            if amount_kobo >= limit * 100:
                return [_reason("AMOUNT_COLD_START", "Large amount on a new profile",
                                f"{naira(amount_kobo)} is large and we have little history to compare against.", pts)]
        return []
    med = statistics.median(amounts)
    mad = statistics.median(abs(a - med) for a in amounts)
    scale = max(mad * 1.4826, med * 0.35, 1)       # robust spread, floored so tiny MAD can't explode z
    z = (amount_kobo - med) / scale                # robust z-score (median/MAD, not mean/std)
    top = amounts[-1]
    ratio = amount_kobo / top if top else 0
    if z < 3.5 or ratio < 1.5:
        return []
    pts = 50 if ratio >= 20 else 42 if ratio >= 10 else 32 if ratio >= 5 else 20 if ratio >= 2.5 else 10
    p10 = amounts[int(0.1 * (n - 1))]
    p90 = amounts[int(round(0.9 * (n - 1)))]
    shown = f"{ratio:.0f}" if ratio >= 10 else f"{ratio:.1f}"
    return [_reason("AMOUNT_ANOMALY", "Amount far outside your normal pattern",
                    f"{naira(amount_kobo)} is {shown}x your largest transfer in 90 days "
                    f"(you usually send {naira(p10)} to {naira(p90)}).", pts)]


def location_signals(ctx):
    loc = ctx.get("location")
    known = [(h["lat"], h["lon"], h["at"]) for h in ctx["history"] if h.get("lat") is not None]
    if not loc or loc.get("lat") is None or not known:
        return []
    out = []
    nearest = min(haversine_km(loc["lat"], loc["lon"], la, lo) for la, lo, _ in known)
    city = loc.get("city") or "an unfamiliar place"
    if nearest > NEW_LOCATION_KM:
        out.append(_reason("NEW_LOCATION", "New location",
                           f"Request came from {city}, about {nearest:,.0f} km from anywhere you usually transact.", 30))
        last = max(known, key=lambda k: k[2])
        hours = (ctx["now"] - last[2]).total_seconds() / 3600
        d_last = haversine_km(loc["lat"], loc["lon"], last[0], last[1])
        if hours < 3 and d_last > 500:
            out.append(_reason("IMPOSSIBLE_TRAVEL", "Impossible travel",
                               f"Your last transfer was {d_last:,.0f} km away only {hours:.1f} hours ago.", 15))
    return out


def customer_signals(ctx):
    now, amount = ctx["now"], ctx["amount_kobo"]
    hist = ctx["history"]
    reasons = amount_signal(amount, hist)

    if ctx["new_beneficiary"]:
        reasons.append(_reason("NEW_BENEFICIARY", "First time paying this account",
                               "You have never sent money to this account before.", 15))
    reasons += location_signals(ctx)
    if not ctx.get("known_device", True):
        reasons.append(_reason("NEW_DEVICE", "Unrecognised device",
                               "This device is not on your trusted device list.", 20))

    attempts = ctx.get("recent_attempts", 0)
    if attempts >= 5:
        reasons.append(_reason("VELOCITY", "Rapid-fire transfers", f"{attempts} transfers in the last 10 minutes.", 25))
    elif attempts >= 3:
        reasons.append(_reason("VELOCITY", "Rapid-fire transfers", f"{attempts} transfers in the last 10 minutes.", 12))

    hour = (now.hour + LAGOS_UTC_OFFSET) % 24
    if 0 <= hour < 5:
        reasons.append(_reason("ODD_HOUR", "Unusual hour", f"Transfer attempted at {hour:02d}:{now.minute:02d} local time.", 8))

    bal = ctx["balance_kobo"]
    if bal > 0 and amount >= 10_000 * 100:
        share = amount / bal
        if share >= 0.95:
            reasons.append(_reason("BALANCE_DRAIN", "Draining the account",
                                   f"This sends {share * 100:.0f}% of your available balance.", 22))
        elif share >= 0.8:
            reasons.append(_reason("BALANCE_DRAIN", "Large share of balance",
                                   f"This sends {share * 100:.0f}% of your available balance.", 15))

    if len(hist) >= MIN_HISTORY:
        last = max(h["at"] for h in hist)
        idle = (now - last).days
        if idle > 30:
            reasons.append(_reason("DORMANT", "Account just woke up",
                                   f"No outgoing transfers for {idle} days.", 10))
    return reasons


# ------------------------------------------------------------- recipient (Ponzi / mule)
def analyze_recipient(rec, now):
    """Return a list of recipient-risk reasons. `rec` holds the last 72h of the account's activity."""
    if not rec:
        return []
    out = []
    ins, outs = rec["inflows"], rec["outflows"]
    senders = {i["sender"] for i in ins}
    n_senders = len(senders)

    if n_senders >= 20:
        out.append(_reason("FAN_IN", "Many unrelated people paying this account",
                           f"Received money from {n_senders} different senders in the last 72 hours.", 30, "recipient"))
    elif n_senders >= 10:
        out.append(_reason("FAN_IN", "Many people paying this account",
                           f"Received money from {n_senders} different senders in the last 72 hours.", 22, "recipient"))
    elif n_senders >= 6:
        out.append(_reason("FAN_IN", "Growing number of payers",
                           f"Received money from {n_senders} different senders in the last 72 hours.", 12, "recipient"))

    total_in = sum(i["amount_kobo"] for i in ins)
    total_out = sum(o["amount_kobo"] for o in outs)
    payees = {o["to"] for o in outs}
    if len(ins) >= 4 and total_in > 0 and len(payees) >= 3 and total_out / total_in >= 0.6:
        out.append(_reason("PASS_THROUGH", "Money is passed straight on",
                           f"{total_out / total_in * 100:.0f}% of incoming funds were forwarded to {len(payees)} other "
                           f"accounts within 72 hours, a typical mule or Ponzi payout pattern.", 20, "recipient"))

    age_days = (now - rec["created_at"]).days
    if age_days < 14 and len(ins) >= 5:
        out.append(_reason("YOUNG_ACCOUNT", "Brand-new account, heavy deposits",
                           f"Opened {age_days} day(s) ago but already received {len(ins)} deposits.", 12, "recipient"))

    amts = [i["amount_kobo"] for i in ins]
    if len(amts) >= 6:
        mean = statistics.mean(amts)
        if mean > 0 and statistics.pstdev(amts) / mean <= 0.2:
            out.append(_reason("SIMILAR_AMOUNTS", "Near-identical deposit sizes",
                               f"{len(amts)} deposits of almost the same amount, typical of fixed 'investment packages'.",
                               10, "recipient"))

    reports = rec.get("report_count", 0)
    if reports >= 3:
        out.append(_reason("REPORTED", "Reported by other customers",
                           f"This account has been reported for fraud {reports} times.", 30, "recipient"))
    elif reports >= 1:
        out.append(_reason("REPORTED", "Reported by a customer",
                           f"This account has been reported for fraud {reports} time(s).", 15, "recipient"))
    return out


def recipient_score(reasons):
    return min(RECIPIENT_CAP, sum(r["points"] for r in reasons))


# ------------------------------------------------------------------------ entry point
def evaluate(ctx):
    """ctx keys: amount_kobo, balance_kobo, now, history[], recent_attempts, known_device,
    location{lat,lon,city}|None, new_beneficiary, recipient{...}|None"""
    cust = customer_signals(ctx)
    rec = analyze_recipient(ctx.get("recipient"), ctx["now"])
    r_score = recipient_score(rec)
    score = min(100, sum(r["points"] for r in cust) + r_score)
    level = level_for(score)
    reasons = sorted(cust + rec, key=lambda r: -r["points"])
    warning = None
    if rec:
        warning = " ".join(r["detail"] for r in sorted(rec, key=lambda r: -r["points"])[:2])
    return {
        "score": score,
        "level": level,
        "required_steps": STEPS_BY_LEVEL[level],
        "reasons": reasons,
        "recipient_score": r_score,
        "recipient_warning": warning,
    }
