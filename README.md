# Aegis Bank

A full banking demo with a real-time fraud engine. React + FastAPI (Python) + MySQL (XAMPP).

## What it does
- **Accounts and transfers**: name enquiry before paying, transaction PIN, double-entry ledger, row-locked atomic posting, idempotency keys (a double-click never sends twice).
- **Fraud engine** (`backend/fraud.py`): scores every transfer 0-100 with human-readable reasons. It never blocks; it steps up verification.

| Score | Level | Verification |
|---|---|---|
| 0-29 | Low | none, instant |
| 30-59 | Medium | demo OTP |
| 60-84 | High | OTP + face match |
| 85+ | Critical | OTP + face match + warning confirmation |

- **Signals**: amount vs your own history (median/MAD), new beneficiary, new location, impossible travel, new device, velocity, odd hour, balance drain, dormant account.
- **Recipient (Ponzi/mule) signals**: fan-in from many senders, pass-through of funds, young account with heavy deposits, near-identical deposit sizes, fraud reports.
- **Demo OTP** shown in a highlighted modal, validated server-side (expiry, 5-attempt limit).
- **Face verification**: enrol once, then every high-risk transfer must match that face. Multiple faces in frame are rejected. (No liveness check, by design for now.)
- **Analyst console**: live WebSocket feed, KPIs, charts, and a **Ponzi radar** with an animated money-flow graph and one-click account freeze.
- **Also**: JWT access/refresh, login lockout, PIN lockout, rate limiting, beneficiaries, receipts and statements (print), freeze account, trusted devices, audit log, notifications, "report a scam".

## Run it

### 1. Database (XAMPP)
Start **Apache and MySQL** in the XAMPP control panel, open phpMyAdmin and run `backend/database.sql`.

### 2. Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python test_fraud.py            # fraud engine self-test
python seed.py                  # builds the demo world (drops and recreates tables)
uvicorn main:app --reload --port 8000
```
XAMPP's default MySQL user is `root` with no password. If yours differs:
`set DATABASE_URL=mysql+pymysql://USER:PASS@127.0.0.1:3306/aegis_bank`

### 3. Frontend
```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173
```
Face models load from a CDN by default. For an offline showcase, copy the `model` folder from
`node_modules/@vladmandic/face-api/model` to `frontend/public/models` and create `frontend/.env` with `VITE_FACE_MODELS=/models`.
The camera needs `localhost` or HTTPS.

## Logins
| Role | Email | Password |
|---|---|---|
| Customer (60 days of history) | chidi@demo.ng | Demo@1234, PIN 1234 |
| Customer (new profile, cold start) | amara@demo.ng | Demo@1234, PIN 1234 |
| Fraud analyst | analyst@aegis.demo | Admin@123 |

## Showcase script (about 6 minutes)
1. Sign in as **Chidi** → Security → **Enrol face** (3 captures).
2. Send money → scenario **Everyday transfer**: instant, no friction.
3. Scenario **Sudden large transfer** (₦500,000 to a new account): risk gauge, reasons, demo OTP modal, face match.
4. Scenario **Ponzi recipient**: only ₦10,000, yet the recipient's behaviour triggers step-up. Ask a colleague (not enrolled) to try the face check: it is rejected.
5. Scenario **Stolen phone abroad**: critical, all three steps plus the scam warning.
6. Open a second window as **analyst**: watch each transfer land live, then **Ponzi radar** → animated graph → freeze the account.
7. Back as Chidi, try sending to the frozen account.

## Honest limits (say them before a judge does)
- Without liveness, a photo can pass the face check. Add liveness before production.
- Face embeddings are computed in the browser; production should extract server-side.
- OTP is shown on screen because this is a demo. Swap in an SMS provider and set `DEMO_MODE = False` in `config.py`.
- The bank directory is simulated. Replace `/accounts/resolve` with NIBSS/Paystack name enquiry for real rails.
- In-memory rate limiter and WebSocket hub are single-process; use Redis for scale.
