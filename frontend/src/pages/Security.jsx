import { useState } from 'react'
import { KeyRound, ScanFace, Smartphone, Snowflake, Trash2 } from 'lucide-react'
import { api, fmtDate } from '../lib.js'
import { useAuth } from '../auth.jsx'
import FaceCapture from '../components/FaceCapture.jsx'
import { Empty, Field, Modal, ModalHeader, Notice, Spinner, useAsync } from '../components/ui.jsx'

function EnrollModal({ onClose, onDone }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function enroll(samples) {
    setBusy(true); setErr('')
    try { await api('/face/enroll', { method: 'POST', body: { pin, samples } }); onDone() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose}>
      <ModalHeader title="Enrol your face" sub="One time only. Risky transfers will later be matched to this face." onClose={onClose} />
      <div className="space-y-4 px-6 py-5">
        <Field label="Confirm with your transaction PIN"><input className="input max-w-[10rem] text-center font-display text-xl tracking-[0.5em]" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
        {/^\d{4}$/.test(pin) ? <FaceCapture mode="enroll" busy={busy} onSamples={enroll} /> : <Notice tone="info">Enter your 4-digit PIN to start the camera.</Notice>}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Modal>
  )
}

function PinForm() {
  const [f, setF] = useState({ current_pin: '', new_pin: '' })
  const [msg, setMsg] = useState(null)
  async function save(e) {
    e.preventDefault()
    try { await api('/accounts/pin', { method: 'POST', body: f }); setMsg({ ok: true, t: 'PIN changed.' }); setF({ current_pin: '', new_pin: '' }) } catch (x) { setMsg({ ok: false, t: x.message }) }
  }
  const pinInput = (k, label) => <Field label={label}><input className="input text-center font-display text-lg tracking-[0.4em]" type="password" inputMode="numeric" maxLength={4} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/\D/g, '') })} /></Field>
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">{pinInput('current_pin', 'Current PIN')}{pinInput('new_pin', 'New PIN')}</div>
      {msg && <Notice tone={msg.ok ? 'safe' : 'danger'}>{msg.t}</Notice>}
      <button className="btn-dark" disabled={f.current_pin.length !== 4 || f.new_pin.length !== 4}>Change PIN</button>
    </form>
  )
}

export default function Security() {
  const { user, refreshUser } = useAuth()
  const [enrolling, setEnrolling] = useState(false)
  const devices = useAsync(() => api('/devices'), [])
  const audit = useAsync(() => api('/audit'), [])
  const frozen = user.account.status === 'FROZEN'

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-extrabold">Security</h1><p className="text-ink-600">Control how your account is protected.</p></div>

      <section className="card flex flex-wrap items-center gap-4 p-5">
        <div className={`flex size-12 items-center justify-center rounded-2xl ${user.face_enrolled ? 'bg-safe/10 text-safe' : 'bg-warn/15 text-warn'}`}><ScanFace /></div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold">Face verification</p>
          <p className="text-sm text-ink-600">{user.face_enrolled ? 'Your face is enrolled. High-risk transfers must match it.' : 'Not enrolled. Enrol once to unlock face checks on high-risk transfers.'}</p>
        </div>
        <button className="btn-primary" onClick={() => setEnrolling(true)}>{user.face_enrolled ? 'Re-enrol face' : 'Enrol my face'}</button>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-4 p-5">
          <p className="flex items-center gap-2 font-display text-lg font-bold"><KeyRound size={18} /> Transaction PIN</p>
          <PinForm />
        </section>
        <section className="card space-y-3 p-5">
          <p className="flex items-center gap-2 font-display text-lg font-bold"><Snowflake size={18} /> Freeze account</p>
          <p className="text-sm text-ink-600">Lost your phone or spotted something odd? Freezing stops all money leaving your account instantly. You can unfreeze at any time.</p>
          <button className={frozen ? 'btn-primary' : 'btn-danger'} onClick={async () => { await api('/accounts/freeze', { method: 'POST', body: { frozen: !frozen } }); refreshUser(); audit.reload() }}>
            {frozen ? 'Unfreeze my account' : 'Freeze my account'}
          </button>
        </section>
      </div>

      <section className="card overflow-hidden">
        <p className="flex items-center gap-2 border-b border-ink-900/10 px-5 py-4 font-display text-lg font-bold"><Smartphone size={18} /> Trusted devices</p>
        {devices.loading ? <div className="p-8 text-center"><Spinner /></div> : devices.data?.length ? (
          <ul className="divide-y divide-ink-900/5">
            {devices.data.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{d.label}</p><p className="text-xs text-ink-600">First seen {fmtDate(d.first_seen, false)} · last active {fmtDate(d.last_seen)}</p></div>
                <button aria-label="Remove device" className="rounded-lg p-2 text-ink-400 hover:bg-danger/10 hover:text-danger" onClick={() => api('/devices/' + d.id, { method: 'DELETE' }).then(devices.reload)}><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        ) : <Empty title="No trusted devices" />}
      </section>

      <section className="card overflow-hidden">
        <p className="border-b border-ink-900/10 px-5 py-4 font-display text-lg font-bold">Security activity</p>
        <ul className="divide-y divide-ink-900/5">
          {audit.data?.map((a, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <span><b>{a.action.replaceAll('_', ' ').toLowerCase()}</b> <span className="text-ink-600">{a.detail}</span></span>
              <span className="shrink-0 text-xs text-ink-400">{fmtDate(a.created_at)}</span>
            </li>
          ))}
        </ul>
      </section>
      {enrolling && <EnrollModal onClose={() => setEnrolling(false)} onDone={() => { setEnrolling(false); refreshUser(); audit.reload() }} />}
    </div>
  )
}
