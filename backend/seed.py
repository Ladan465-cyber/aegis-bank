"""
Seeds the demo world.  Usage:  python seed.py      (DROPS and recreates all tables)

Demo logins
  Customer   chidi@demo.ng      Demo@1234   PIN 1234   (has 60 days of ₦2k-₦20k history)
  Customer   amara@demo.ng      Demo@1234   PIN 1234   (brand-new profile: cold-start demo)
  Analyst    analyst@aegis.demo Admin@123
"""
import random
from datetime import timedelta
from database import Base, engine, SessionLocal
from fraud import STEPS_BY_LEVEL
from models import (Bank, User, Account, Transaction, LedgerEntry, Beneficiary, Device, Notification, utcnow)
from security import hash_secret

random.seed(7)
NOW = utcnow()
BANKS = [("900", "Aegis Bank"), ("058", "GTBank"), ("044", "Access Bank"), ("057", "Zenith Bank"),
         ("033", "UBA"), ("011", "First Bank"), ("999992", "OPay"), ("50211", "Kuda Bank")]
FIRST = ["Adaeze", "Bola", "Chinedu", "Damilola", "Emeka", "Funke", "Gbenga", "Hauwa", "Ifeanyi", "Jide", "Kemi",
         "Lanre", "Musa", "Nkechi", "Obinna", "Peter", "Queen", "Ruth", "Segun", "Titi", "Uche", "Vivian", "Wale", "Yemi", "Zainab"]
LAST = ["Adeyemi", "Balogun", "Chukwu", "Dike", "Eze", "Fashola", "Garba", "Ibe", "Jegede", "Kalu", "Lawal", "Madu",
        "Nwankwo", "Okafor", "Peters", "Salami", "Uzor", "Yusuf", "Abiola", "Obi"]

db = SessionLocal()
Base.metadata.drop_all(engine)
Base.metadata.create_all(engine)
PW, PIN = hash_secret("Demo@1234"), hash_secret("1234")
used_numbers = set()


def number():
    while True:
        n = "".join(random.choices("0123456789", k=10))
        if n not in used_numbers:
            used_numbers.add(n)
            return n


def mk(name, email, bank, days_old=120, num=None, pw=PW, role="customer", reports=0):
    u = User(full_name=name, email=email, phone="080" + "".join(random.choices("0123456789", k=8)), password_hash=pw,
             pin_hash=PIN, role=role, created_at=NOW - timedelta(days=days_old))
    db.add(u)
    db.flush()
    if role == "admin":
        return u, None
    n = num or number()
    used_numbers.add(n)
    a = Account(user_id=u.id, account_number=n, bank_code=bank, balance_kobo=0, report_count=reports,
                created_at=NOW - timedelta(days=days_old))
    db.add(a)
    db.flush()
    return u, a


for code, name in BANKS:
    db.add(Bank(code=code, name=name))
db.flush()

# ------------------------------------------------------------------ cast
chidi_u, chidi = mk("Chidi Okeke", "chidi@demo.ng", "900", 200, "0123456789")
amara_u, amara = mk("Amara Eze", "amara@demo.ng", "900", 3, "0987654321")
admin_u, _ = mk("Fraud Analyst", "analyst@aegis.demo", "900", 400, pw=hash_secret("Admin@123"), role="admin")

friends = [mk("Ada Nwosu", "ada@demo.ng", "058", 300, "2201234567"), mk("Tunde Bakare", "tunde@demo.ng", "044", 300, "3101234567"),
           mk("Ngozi Eze", "ngozi@demo.ng", "057", 300, "4101234567"), mk("Folake Okeke", "mama@demo.ng", "999992", 300, "8101234567"),
           mk("Ibrahim Musa", "ibrahim@demo.ng", "033", 300, "5201234567")]
new1 = mk("Sola Adebayo", "sola@demo.ng", "50211", 150, "5100234567")
new2 = mk("Emeka Obi", "emeka@demo.ng", "033", 150, "5200234567")
payroll = mk("Aegis Payroll Ltd", "payroll@demo.ng", "900", 900, "0100000001")

# the scammers
ponzi_u, ponzi = mk("Golden Harvest Investments", "golden@harvest.ng", "999992", 6, "8109998887", reports=2)
quick_u, quick = mk("QuickDouble Cooperative", "quick@double.ng", "50211", 9, "5109998887", reports=0)
mules = [mk(n, f"mule{i}@x.ng", random.choice(["999992", "50211"]), 15) for i, n in
         enumerate(["Kelvin Trading Co", "Blessing Ogar", "Prince Emenike", "Hope Ventures"])]

used_names, pool = set(), []
while len(pool) < 40:
    nm = f"{random.choice(FIRST)} {random.choice(LAST)}"
    if nm not in used_names:
        used_names.add(nm)
        pool.append(mk(nm, f"user{len(pool)}@demo.ng", random.choice([b[0] for b in BANKS]), random.randint(30, 400)))
feeders, normals = pool[:30], pool[30:]

# ------------------------------------------------------------------ planned events
events = []


def ev(s, r, amt, at, narr="", status="COMPLETED", score=0, level="LOW", reasons=None, loc=("Lagos", 6.5244, 3.3792)):
    events.append(dict(s=s, r=r, amt=int(amt * 100), at=at, narr=narr, status=status, score=score, level=level,
                       reasons=reasons or [], city=loc[0], lat=loc[1] + random.uniform(-.05, .05), lon=loc[2] + random.uniform(-.05, .05)))


def when(days_ago=0, hours_ago=0, hour_utc=None):
    t = NOW - timedelta(days=days_ago, hours=hours_ago)
    if hour_utc is not None:
        t = t.replace(hour=hour_utc, minute=random.randint(0, 59))
    return t


# Chidi: a clear 60-day pattern of small everyday payments (₦2k-₦20k) + two salary credits
amounts = [2000, 2500, 3000, 4500, 5000, 7500, 8000, 10000, 12000, 15000, 18000, 20000]
narr = ["Lunch", "Transport", "Rent contribution", "Data top-up", "Groceries", "Thanks", "Owambe contribution"]
for _ in range(48):
    f = random.choices(friends, weights=[5, 4, 3, 3, 2])[0]
    ev(chidi, f[1], random.choice(amounts), when(random.randint(1, 60), hour_utc=random.randint(7, 19)), random.choice(narr))
ev(payroll[1], chidi, 250000, when(3, hour_utc=9), "Salary")
ev(payroll[1], chidi, 250000, when(33, hour_utc=9), "Salary")

# Golden Harvest: 28 feeders pay ~₦50k within 60h, funds forwarded to 4 mules
for f in feeders:
    ev(f[1], ponzi, random.choice([50000] * 5 + [48000, 52000]), when(hours_ago=random.randint(1, 60)), "Investment package",
       score=random.choice([5, 12, 18, 22, 26]), level="LOW")
for m in mules:
    ev(ponzi, m[1], random.choice([225000, 235000, 240000]), when(hours_ago=random.randint(1, 30)), "Payout")
# QuickDouble: 11 payers of ₦20k
for f in feeders[:11]:
    ev(f[1], quick, 20000, when(hours_ago=random.randint(2, 50)), "Double your money")

# background traffic among ordinary people (each has 3 usual counterparties, so no accidental fan-in)
favs = {n[1].id: random.sample([x for x in normals if x is not n], 3) for n in normals}
samples = {"MEDIUM": ("NEW_LOCATION", "New location"), "HIGH": ("AMOUNT_ANOMALY", "Amount far outside your normal pattern")}
for _ in range(170):
    s = random.choice(normals)
    r = random.choice(favs[s[1].id])
    roll = random.random()
    level, score, status, rs = "LOW", random.randint(0, 24), "COMPLETED", []
    if roll > 0.88:
        level, score = "MEDIUM", random.randint(30, 58)
    if roll > 0.97:
        level, score, status = "HIGH", random.randint(60, 82), random.choice(["COMPLETED", "CANCELLED"])
    if level != "LOW":
        c, tl = samples[level]
        rs = [{"code": c, "title": tl, "detail": "Seeded example signal.", "points": score, "scope": "customer"}]
    hrs = random.choice([random.randint(0, 23), random.randint(0, 23), random.randint(0, 150)])
    ev(s[1], r[1], round(random.uniform(1000, 60000), -2), when(hours_ago=hrs), random.choice(narr), status, score, level, rs)

# ------------------------------------------------------------------ balances + posting
events.sort(key=lambda e: e["at"])
net, outflow = {}, {}
for e in events:
    if e["status"] == "COMPLETED":
        net[e["s"].id] = net.get(e["s"].id, 0) - e["amt"]
        net[e["r"].id] = net.get(e["r"].id, 0) + e["amt"]
        outflow[e["s"].id] = outflow.get(e["s"].id, 0) + e["amt"]
targets = {chidi.id: 850_000 * 100, amara.id: 120_000 * 100}
everyone = [chidi, amara, payroll[1], ponzi, quick, new1[1], new2[1], *[f[1] for f in friends],
            *[m[1] for m in mules], *[p[1] for p in pool]]
for a in everyone:
    if a.id in targets:                       # exact final balance for the demo customers
        a.balance_kobo = targets[a.id] - net.get(a.id, 0)
    else:                                     # cushion so running balances never dip below zero
        a.balance_kobo = outflow.get(a.id, 0) + random.randint(30_000, 500_000) * 100

for i, e in enumerate(events):
    done = e["status"] == "COMPLETED"
    t = Transaction(reference=f"SEED{i:05d}", type="TRANSFER", sender_account_id=e["s"].id, recipient_account_id=e["r"].id,
                    amount_kobo=e["amt"], narration=e["narr"], status=e["status"], risk_score=e["score"], risk_level=e["level"],
                    risk_reasons=e["reasons"], required_steps=STEPS_BY_LEVEL[e["level"]],
                    completed_steps=STEPS_BY_LEVEL[e["level"]] if done else [], city=e["city"], lat=e["lat"], lon=e["lon"],
                    created_at=e["at"], completed_at=e["at"] if done else None, device_id="seed-device",
                    failure_reason=None if done else "Cancelled by customer.")
    db.add(t)
    db.flush()
    if done:
        e["s"].balance_kobo -= e["amt"]
        e["r"].balance_kobo += e["amt"]
        db.add_all([LedgerEntry(transaction_id=t.id, account_id=e["s"].id, direction="DEBIT", amount_kobo=e["amt"],
                                balance_after_kobo=e["s"].balance_kobo, created_at=e["at"]),
                    LedgerEntry(transaction_id=t.id, account_id=e["r"].id, direction="CREDIT", amount_kobo=e["amt"],
                                balance_after_kobo=e["r"].balance_kobo, created_at=e["at"])])

# Chidi's saved beneficiaries, trusted device and a few notifications
for u, a in friends[:4]:
    db.add(Beneficiary(user_id=chidi_u.id, account_id=a.id, nickname=u.full_name.split()[0]))
db.add(Device(user_id=chidi_u.id, device_id="seed-device", label="Chrome on Windows (home laptop)", first_seen=NOW - timedelta(days=90)))
db.add(Notification(user_id=chidi_u.id, title="Credit alert", body="₦250,000.00 received from Aegis Payroll Ltd.", kind="credit"))
db.add(Notification(user_id=chidi_u.id, title="Tip", body="Enrol your face in Security to protect large transfers.", kind="info"))
db.commit()

print("\nSeed complete.\n")
print(f"{'Who':32}{'Account':14}{'Bank':14}Use in the demo")
for label, (u, a), note in [
    ("Chidi Okeke (you)", (chidi_u, chidi), "demo customer, balance ₦850,000"),
    ("Ada Nwosu", friends[0], "known beneficiary (normal transfer)"),
    ("Sola Adebayo", new1, "new account (new-beneficiary signal)"),
    ("Emeka Obi", new2, "new account"),
    ("Golden Harvest Investments", (ponzi_u, ponzi), "PONZI collector (fan-in + pass-through)"),
    ("QuickDouble Cooperative", (quick_u, quick), "smaller suspicious scheme"),
]:
    print(f"{label:32}{a.account_number:14}{a.bank_code:14}{note}")
print("\nLogins: chidi@demo.ng / Demo@1234 (PIN 1234) | analyst@aegis.demo / Admin@123\n")
