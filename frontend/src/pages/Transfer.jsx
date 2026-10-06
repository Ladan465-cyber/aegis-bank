import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BadgeCheck, FlaskConical, Search } from 'lucide-react'
import { api, currentLocation, deviceId, naira, setDemo } from '../lib.js'
import { useAuth } from '../auth.jsx'
import StepUp from '../components/StepUp.jsx'
import { Field, Notice, Spinner, useAsync } from '../components/ui.jsx'

// These match the accounts created by seed.py
const A = {
  ADA: { n: '2201234567', b: '058' }, SOLA: { n: '5100234567', b: '50211' }, EMEKA: { n: '5200234567', b: '033' },
  GOLDEN: { n: '8109998887', b: '999992' }, GHOST: { n: '0000000000', b: '058' },
}
const SCENARIOS = [
  { title: 'Everyday transfer', to: A.ADA, amount: 7500, city: 'Lagos', device: false, expect: 'Goes straight through', tone: 'text-safe' },
  { title: 'Sudden large transfer', to: A.SOLA, amount: 500000, city: 'Lagos', device: false, expect: 'OTP + face check', tone: 'text-alert' },
  { title: 'New location', to: A.ADA, amount: 15000, city: 'Abuja', device: false, expect: 'OTP', tone: 'text-warn' },
  { title: 'Ponzi recipient, small amount', to: A.GOLDEN, amount: 10000, city: 'Lagos', device: false, expect: 'OTP + face check', tone: 'text-alert' },
  { title: 'Stolen phone abroad', to: A.EMEKA, amount: 120000, city: 'London', device: true, expect: 'OTP + face + warning', tone: 'text-danger' },
  { title: 'Wrong account number', to: A.GHOST, amount: 5000, city: 'Lagos', device: false, expect: 'Name enquiry fails', tone: 'text-ink-600' },
]

export default function Transfer() {
  const { user, refreshUser } = useAuth()
  const loc = useLocation()
  const banks = useAsync(() => api('/banks'), [])
  const bens = useAsync(() => api('/beneficiaries'), [])
  const [f, setF] = useState({ bank_code: '', account_number: '', amount: '', narration: '', pin: '', save: false })
  const [res, setRes] = useState({ state: 'idle', name: '', bank: '', error: '' })
  const [txn, setTxn] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const key = useRef(crypto.randomUUID())
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  useEffect(() => { if (loc.state?.prefill) setF((p) => ({ ...p, ...loc.state.prefill })) }, [loc.state])
  useEffect(() => { if (!f.bank_code && banks.data?.length) setF((p) => ({ ...p, bank_code: p.bank_code || banks.data[1].code })) }, [banks.data]) // eslint-disable-line

  // Name enquiry: runs as soon as 10 digits + a bank are present
  useEffect(() => {
    if (f.account_number.length !== 10 || !f.bank_code) return setRes({ state: 'idle', name: '', bank: '', error: '' })
    let dead = false
    setRes({ state: 'loading', name: '', bank: '', error: '' })
    api(`/accounts/resolve?account_number=${f.account_number}&bank_code=${f.bank_code}`)
      .then((r) => !dead && setRes({ state: 'ok', name: r.account_name, bank: r.bank, error: '' }))
      .catch((e) => !dead && setRes({ state: 'error', name: '', bank: '', error: e.message }))
    return () => { dead = true }
  }, [f.account_number, f.bank_code])

  function runScenario(s) {
    setDemo({ city: s.city, newDevice: s.device })
    setF((p) => ({ ...p, bank_code: s.to.b, account_number: s.to.n, amount: String(s.amount), narration: s.title, pin: '' }))
    setErr(''); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function send(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const t = await api('/transfers/initiate', {
        method: 'POST',
        body: { account_number: f.account_number, bank_code: f.bank_code, amount: Number(f.amount), narration: f.narration, pin: f.pin,
          idempotency_key: key.current, device_id: deviceId(), location: currentLocation(), save_beneficiary: f.save },
      })
      key.current = crypto.randomUUID()
      setF((p) => ({ ...p, pin: '' }))
      setTxn(t)
      refreshUser()
    } catch (x) { setErr(x.message); setF((p) => ({ ...p, pin: '' })) } finally { setBusy(false) }
  }

  function change(t) {
    setTxn(t)
    if (t.status !== 'PENDING_VERIFICATION') { refreshUser(); window.dispatchEvent(new Event('aegis:refresh')) }
  }
  function close() {
    const done = txn && txn.status !== 'PENDING_VERIFICATION'
    setTxn(null)
    if (done) { setF({ ...f, account_number: '', amount: '', narration: '', pin: '', save: false }); bens.reload() }
  }

  const amt = Number(f.amount) || 0
  const canSend = res.state === 'ok' && amt >= 1 && /^\d{4}$/.test(f.pin) && !busy

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Send money</h1>
        <p className="text-ink-600">We confirm the recipient exists before you pay, and score the transfer before it leaves.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <form onSubmit={send} className="card space-y-5 p-6">
          {bens.data?.length > 0 && (
            <div>
              <p className="label">Saved beneficiaries</p>
              <div className="flex flex-wrap gap-2">
                {bens.data.map((b) => (
                  <button type="button" key={b.id} onClick={() => setF({ ...f, bank_code: b.bank_code, account_number: b.account_number })}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${f.account_number === b.account_number ? 'border-brand bg-brand-50 text-brand' : 'border-ink-900/15 hover:bg-paper'}`}>{b.nickname}</button>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Recipient bank">
              <select className="input" value={f.bank_code} onChange={set('bank_code')}>
                {banks.data?.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Account number">
              <input className="input" inputMode="numeric" maxLength={10} placeholder="10 digits" value={f.account_number} onChange={(e) => setF({ ...f, account_number: e.target.value.replace(/\D/g, '') })} />
            </Field>
          </div>

          <div aria-live="polite" className="min-h-[3rem]">
            {res.state === 'loading' && <p className="flex items-center gap-2 text-sm text-ink-600"><Spinner /> Checking account…</p>}
            {res.state === 'ok' && (
              <div className="flex items-center gap-3 rounded-xl border border-safe/30 bg-safe/10 px-4 py-3">
                <BadgeCheck className="text-safe" />
                <div><p className="text-sm font-bold">{res.name}</p><p className="text-xs text-ink-600">{res.bank} · account verified</p></div>
              </div>
            )}
            {res.state === 'error' && <Notice tone="danger">{res.error}</Notice>}
          </div>

          <Field label="Amount (₦)" hint={amt ? naira(amt * 100) : ''}>
            <input className="input font-display !text-xl !font-bold" inputMode="decimal" placeholder="0.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
          <Field label="Narration (optional)"><input className="input" maxLength={140} value={f.narration} onChange={set('narration')} /></Field>
          <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand" checked={f.save} onChange={(e) => setF({ ...f, save: e.target.checked })} /> Save as beneficiary after sending</label>
          <Field label="Transaction PIN" hint="Demo PIN: 1234">
            <input className="input max-w-[10rem] text-center font-display text-xl tracking-[0.5em]" type="password" inputMode="numeric" maxLength={4} autoComplete="off" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} />
          </Field>
          {err && <Notice tone="danger">{err}</Notice>}
          <button className="btn-primary w-full py-3 text-base" disabled={!canSend}>{busy ? <Spinner /> : `Send ${amt ? naira(amt * 100) : ''}`}</button>
          <p className="text-center text-xs text-ink-600">Available: {naira(user.account.balance_kobo)}</p>
        </form>

        <aside className="card h-fit p-5">
          <p className="flex items-center gap-2 font-display text-lg font-bold"><FlaskConical size={18} className="text-brand" /> Try a scenario</p>
          <p className="mb-3 mt-1 text-sm text-ink-600">Each button fills the form and sets the demo location and device. Enter the PIN and send.</p>
          <div className="space-y-2">
            {SCENARIOS.map((s) => (
              <button key={s.title} onClick={() => runScenario(s)} className="w-full rounded-xl border border-ink-900/10 px-4 py-3 text-left transition hover:border-brand hover:bg-brand-50">
                <p className="text-sm font-bold">{s.title}</p>
                <p className="text-xs text-ink-600">{s.amount ? naira(s.amount * 100, 0) : ''} · {s.city}{s.device ? ' · new device' : ''} → <span className={`font-semibold ${s.tone}`}>{s.expect}</span></p>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {txn && <StepUp txn={txn} faceEnrolled={user.face_enrolled} onChange={change} onClose={close} />}
    </div>
  )
}
