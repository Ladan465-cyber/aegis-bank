"""Run:  python test_fraud.py   (or pytest)"""
from datetime import datetime, timedelta
from fraud import evaluate, analyze_recipient, recipient_score

NOW = datetime(2026, 10, 5, 12, 0)          # 13:00 Lagos
LAGOS = {"lat": 6.5244, "lon": 3.3792, "city": "Lagos"}
ABUJA = {"lat": 9.0765, "lon": 7.3986, "city": "Abuja"}
LONDON = {"lat": 51.5072, "lon": -0.1276, "city": "London"}
HIST = [{"amount_kobo": a * 100, "at": NOW - timedelta(days=d), "lat": 6.52, "lon": 3.38}
        for a, d in [(2000, 50), (4500, 44), (8000, 40), (12000, 33), (3000, 28), (20000, 21),
                     (7500, 15), (2500, 9), (9000, 6), (15000, 3)]]


def ctx(amount, **kw):
    base = dict(amount_kobo=amount * 100, balance_kobo=900_000 * 100, now=NOW, history=HIST,
                recent_attempts=0, known_device=True, location=LAGOS, new_beneficiary=False, recipient=None)
    base.update(kw)
    return base


def ponzi(n=28):
    ins = [{"sender": i, "amount_kobo": 5_000_000 + (i % 3) * 20_000, "at": NOW - timedelta(hours=i)} for i in range(n)]
    outs = [{"to": 900 + i, "amount_kobo": 30_000_000, "at": NOW - timedelta(hours=i)} for i in range(4)]
    return {"created_at": NOW - timedelta(days=6), "report_count": 2, "inflows": ins, "outflows": outs}


def test_normal_is_low():
    r = evaluate(ctx(7500))
    assert r["level"] == "LOW" and r["required_steps"] == [], r


def test_sudden_large_transfer_steps_up():
    r = evaluate(ctx(500_000, new_beneficiary=True))
    assert r["level"] == "HIGH" and r["required_steps"] == ["otp", "face"], r
    assert any(x["code"] == "AMOUNT_ANOMALY" for x in r["reasons"])


def test_new_location_is_medium():
    r = evaluate(ctx(15000, location=ABUJA))
    assert r["level"] == "MEDIUM" and r["required_steps"] == ["otp"], r


def test_impossible_travel():
    h = HIST + [{"amount_kobo": 500000, "at": NOW - timedelta(minutes=30), "lat": 6.52, "lon": 3.38}]
    r = evaluate(ctx(5000, location=LONDON, history=h))
    assert any(x["code"] == "IMPOSSIBLE_TRAVEL" for x in r["reasons"])


def test_new_device_alone_is_low_but_combines():
    assert evaluate(ctx(5000, known_device=False))["level"] == "LOW"
    assert evaluate(ctx(5000, known_device=False, location=ABUJA))["level"] == "MEDIUM"


def test_ponzi_recipient_flagged():
    rec = analyze_recipient(ponzi(), NOW)
    codes = {x["code"] for x in rec}
    assert {"FAN_IN", "PASS_THROUGH", "YOUNG_ACCOUNT", "SIMILAR_AMOUNTS", "REPORTED"} <= codes, codes
    assert recipient_score(rec) == 55


def test_ponzi_plus_large_is_critical():
    r = evaluate(ctx(100_000, new_beneficiary=True, recipient=ponzi()))
    assert r["level"] == "CRITICAL" and r["required_steps"] == ["otp", "face", "confirm"], r
    assert r["recipient_warning"]


def test_cold_start_uses_absolute_limits():
    r = evaluate(ctx(600_000, history=[], location=None, new_beneficiary=True))
    assert r["level"] == "MEDIUM", r


def test_balance_drain():
    r = evaluate(ctx(880_000, balance_kobo=900_000 * 100))
    assert any(x["code"] == "BALANCE_DRAIN" for x in r["reasons"])


def test_one_old_big_transfer_does_not_normalise_big_amounts():
    h = HIST + [{"amount_kobo": 400_000 * 100, "at": NOW - timedelta(days=60), "lat": 6.52, "lon": 3.38}]
    r = evaluate(ctx(450_000, history=h))
    assert not any(x["code"] == "AMOUNT_ANOMALY" for x in r["reasons"])


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok ", name)
    r = evaluate(ctx(500_000, new_beneficiary=True))
    print("\nExample: ₦500,000 to a new account ->", r["score"], r["level"], r["required_steps"])
    for x in r["reasons"]:
        print("  +%2d %s: %s" % (x["points"], x["title"], x["detail"]))
