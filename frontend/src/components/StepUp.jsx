import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CheckCircle2, ScanFace, ShieldAlert, KeyRound, ShieldCheck, XCircle, Printer, Smartphone } from 'lucide-react'
import { api, naira, printReceipt, fmtDate } from '../lib.js'
import FaceCapture from './FaceCapture.jsx'
import { Gauge, Modal, ModalHeader, Notice, RISK, Spinner } from './ui.jsx'

const STEP_META = {
  otp: { label: 'One-time code', icon: KeyRound },
  face: { label: 'Face check', icon: ScanFace },
  confirm: { label: 'Confirm warning', icon: ShieldAlert },
}

function Tracker({ txn }) {
  const steps = txn.required_steps
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => {
        const done = txn.completed_steps.includes(s)
        const current = txn.next_step === s
        const Icon = STEP_META[s].icon
        return (
          <li key={s} className="flex flex-1 items-center gap-2">
            <div className={`flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${done ? 'border-safe/30 bg-safe/10 text-safe' : current ? 'border-brand bg-brand-50 text-brand-600' : 'border-ink-900/10 text-ink-400'}`}>
              {done ? <Check size={16} /> : <Icon size={16} />}
              <span className="truncate">{STEP_META[s].label}</span>
            </div>
            {i < steps.length - 1 && <span className="h-px w-3 bg-ink-900/20" />}
          </li>
        )
      })}
    </ol>
  )
}

function Reasons({ risk }) {
  return (
    <div>
      {risk.recipient_warning && (
        <Notice tone="danger" className="mb-3">
          <p className="font-bold">Warning about the recipient</p>
          <p className="mt-0.5">{risk.recipient_warning}</p>
        </Notice>
      )}
      <p className="mb-2 text-sm font-semibold text-ink-700">Why we are asking for extra verification</p>
      <ul className="space-y-2">
        {risk.reasons.map((r) => (
          <li key={r.code} className="flex items-start justify-between gap-3 rounded-xl bg-paper px-3.5 py-2.5">
            <div>
              <p className="text-sm font-semibold">{r.title}{r.scope === 'recipient' && <span className="ml-2 rounded bg-danger/10 px-1.5 py-0.5 text-[11px] font-bold text-danger">recipient</span>}</p>
              <p className="text-[13px] text-ink-600">{r.detail}</p>
            </div>
            <span className="shrink-0 rounded-md bg-ink-900 px-1.5 py-0.5 text-xs font-bold text-white">+{r.points}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function OtpStep({ txn, onChange }) {
  const [digits, setDigits] = useState(Array(6).fill(''))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState(0)
  const refs = useRef([])

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(txn.otp_expires) - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [txn.otp_expires])
  useEffect(() => { refs.current[0]?.focus() }, [])

  const code = digits.join('')
  const set = (i, v) => {
    const d = v.replace(/\D/g, '')
    if (!d) { const n = [...digits]; n[i] = ''; return setDigits(n) }
    const n = [...digits]
    d.slice(0, 6 - i).split('').forEach((ch, k) => { n[i + k] = ch })
    setDigits(n)
    refs.current[Math.min(5, i + d.length)]?.focus()
  }
  async function verify(c = code) {
    setBusy(true); setErr('')
    try { onChange(await api(`/transfers/${txn.reference}/otp`, { method: 'POST', body: { code: c } })) }
    catch (e) { setErr(e.message); if (e.message.includes('cancelled')) onChange({ ...txn, status: 'CANCELLED', failure_reason: e.message }) }
    finally { setBusy(false) }
  }
  async function resend() {
    setErr('')
    try { onChange(await api(`/transfers/${txn.reference}/otp/resend`, { method: 'POST' })); setDigits(Array(6).fill('')) }
    catch (e) { setErr(e.message) }
  }

  return (
    <div>
      {/* The demo OTP. In production this arrives by SMS; here it pops up so the audience can see it. */}
      <div className="rounded-2xl bg-brand p-5 text-white">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/80"><Smartphone size={16} /> Demo OTP (a real bank would text this to you)</div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex gap-1.5" aria-label={`Your demo code is ${txn.demo_otp}`}>
            {(txn.demo_otp || '------').split('').map((c, i) => (
              <span key={i} className="flex h-12 w-10 items-center justify-center rounded-lg bg-white font-display text-2xl font-extrabold text-brand">{c}</span>
            ))}
          </div>
          <button className="btn bg-white/15 text-white hover:bg-white/25" onClick={() => { const d = txn.demo_otp.split(''); setDigits(d); verify(txn.demo_otp) }}>Use this code</button>
        </div>
      </div>

      <p className="mb-2 mt-5 text-sm font-semibold text-ink-700">Enter the 6-digit code</p>
      <div className="flex justify-between gap-2" onPaste={(e) => { e.preventDefault(); set(0, e.clipboardData.getData('text')) }}>
        {digits.map((d, i) => (
          <input key={i} ref={(el) => (refs.current[i] = el)} value={d} inputMode="numeric" maxLength={6} aria-label={`Digit ${i + 1}`}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus(); if (e.key === 'Enter' && code.length === 6) verify() }}
            className="h-14 w-full rounded-xl border border-ink-900/20 text-center font-display text-2xl font-bold focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
        ))}
      </div>
      {err && <p className="mt-3 text-sm font-medium text-danger">{err}</p>}
      <button className="btn-primary mt-4 w-full" disabled={code.length !== 6 || busy || left === 0} onClick={() => verify()}>
        {busy ? <Spinner /> : 'Verify code'}
      </button>
      <div className="mt-3 flex items-center justify-between text-sm text-ink-600">
        <span>{left > 0 ? `Code expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Code expired'}</span>
        <button className="font-semibold text-brand hover:underline" onClick={resend}>Send a new code</button>
      </div>
    </div>
  )
}

function FaceStep({ txn, onChange, faceEnrolled, setFaceInfo }) {
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState(null)
  if (!faceEnrolled) {
    return (
      <Notice tone="warn">
        <p className="font-bold">You have not enrolled your face yet.</p>
        <p className="mt-1">This transfer needs a face check. Enrol once in Security, then resume it from Transactions.</p>
        <Link to="/security" className="btn-dark mt-3">Go to Security</Link>
      </Notice>
    )
  }
  async function verify(descriptor) {
    setBusy(true); setFail(null)
    try {
      const r = await api(`/transfers/${txn.reference}/face`, { method: 'POST', body: { descriptor } })
      if (r.matched) setFaceInfo(r)
      else setFail(r)
      onChange(r.transaction)
    } catch (e) { setFail({ error: e.message }) } finally { setBusy(false) }
  }
  return (
    <div>
      <p className="mb-3 text-sm text-ink-600">We compare your live face with the one you enrolled. Only the enrolled person can approve this transfer.</p>
      <FaceCapture mode="verify" busy={busy} onDescriptor={verify} />
      {fail && (
        <Notice tone="danger" className="mt-3">
          {fail.error ? fail.error : <>Face did not match <span className="opacity-70">(distance {fail.distance}, needs {fail.threshold} or less)</span>. {fail.transaction.face_attempts_left} attempt(s) left.</>}
        </Notice>
      )}
    </div>
  )
}

function ConfirmStep({ txn, onChange }) {
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function go() {
    setBusy(true)
    try { onChange(await api(`/transfers/${txn.reference}/confirm`, { method: 'POST', body: { acknowledged: true } })) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div>
      <Notice tone="danger">
        This transfer matches patterns used in scams and investment schemes. Money sent to a fraudulent account is very hard to recover. Pause and ask yourself: was I promised unusually high returns?
      </Notice>
      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>I understand the risk and I still want to send {naira(txn.amount_kobo)} to {txn.recipient.name}.</span>
      </label>
      {err && <p className="mt-2 text-sm font-medium text-danger">{err}</p>}
      <button className="btn-danger mt-4 w-full" disabled={!ok || busy} onClick={go}>{busy ? <Spinner /> : 'Send anyway'}</button>
    </div>
  )
}

export function Result({ txn, onClose }) {
  const ok = txn.status === 'COMPLETED'
  return (
    <div className="px-6 py-8 text-center">
      {ok ? <CheckCircle2 className="mx-auto text-safe" size={56} /> : <XCircle className="mx-auto text-danger" size={56} />}
      <h3 className="mt-3 text-2xl font-extrabold">{ok ? 'Transfer successful' : txn.status === 'CANCELLED' ? 'Transfer cancelled' : 'Transfer failed'}</h3>
      <p className="font-display mt-2 text-4xl font-extrabold">{naira(txn.amount_kobo)}</p>
      <p className="mt-1 text-ink-600">{ok ? 'sent to' : 'to'} <b className="text-ink-900">{txn.recipient.name}</b> · {txn.recipient.bank}</p>
      {!ok && txn.failure_reason && <p className="mt-2 text-sm font-medium text-danger">{txn.failure_reason}</p>}
      <div className="mx-auto mt-5 flex max-w-sm flex-wrap items-center justify-center gap-2 text-xs text-ink-600">
        <span className="rounded-md bg-paper px-2 py-1">Ref {txn.reference}</span>
        <span className="rounded-md bg-paper px-2 py-1">{fmtDate(txn.completed_at || txn.created_at)}</span>
        {txn.verified_with.length > 0 && <span className="inline-flex items-center gap-1 rounded-md bg-safe/10 px-2 py-1 font-semibold text-safe"><ShieldCheck size={13} /> Verified: {txn.verified_with.join(' + ')}</span>}
      </div>
      <div className="mt-6 flex justify-center gap-2">
        {ok && <button className="btn-ghost" onClick={() => printReceipt(txn)}><Printer size={16} /> Receipt</button>}
        <button className="btn-primary" onClick={onClose}>Done</button>
      </div>
    </div>
  )
}

export default function StepUp({ txn, faceEnrolled, onChange, onClose }) {
  const [faceInfo, setFaceInfo] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const pending = txn.status === 'PENDING_VERIFICATION'
  const risk = RISK[txn.risk.level]

  async function cancel() {
    setCancelling(true)
    try { onChange(await api(`/transfers/${txn.reference}/cancel`, { method: 'POST' })) } finally { setCancelling(false) }
  }

  return (
    <Modal open onClose={pending ? undefined : onClose} dismissible={!pending} width="max-w-xl">
      {!pending ? <Result txn={txn} onClose={onClose} /> : (
        <>
          <ModalHeader title="Extra verification needed" sub={`${naira(txn.amount_kobo)} to ${txn.recipient.name} · ${txn.recipient.bank}`} />
          <div className="space-y-5 px-6 py-5">
            <div className="grid items-center gap-4 sm:grid-cols-[12rem_1fr]">
              <div>
                <Gauge score={txn.risk.score} level={txn.risk.level} />
                <p className="mt-1 text-center text-sm font-bold" style={{ color: risk.color }}>{risk.label}</p>
              </div>
              <div className="text-sm text-ink-700">
                <p className="font-display text-lg font-bold text-ink-900">We did not block this. We want to be sure it is you.</p>
                <p className="mt-1">Your money only moves after you complete the steps below.</p>
              </div>
            </div>
            <Reasons risk={txn.risk} />
            <Tracker txn={txn} />
            {faceInfo && txn.next_step !== 'face' && (
              <Notice tone="safe"><b>Face matched.</b> {faceInfo.confidence}% confidence (distance {faceInfo.distance}).</Notice>
            )}
            {txn.next_step === 'otp' && <OtpStep key={txn.demo_otp} txn={txn} onChange={onChange} />}
            {txn.next_step === 'face' && <FaceStep txn={txn} onChange={onChange} faceEnrolled={faceEnrolled} setFaceInfo={setFaceInfo} />}
            {txn.next_step === 'confirm' && <ConfirmStep txn={txn} onChange={onChange} />}
          </div>
          <div className="flex items-center justify-between border-t border-ink-900/10 px-6 py-3 text-sm">
            <button className="font-semibold text-ink-600 hover:text-ink-900" onClick={onClose}>Finish later</button>
            <button className="font-semibold text-danger hover:underline" disabled={cancelling} onClick={cancel}>Cancel this transfer</button>
          </div>
        </>
      )}
    </Modal>
  )
}
