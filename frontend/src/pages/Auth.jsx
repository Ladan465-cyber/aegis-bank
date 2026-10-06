import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { api, realDeviceId } from '../lib.js'
import { useAuth } from '../auth.jsx'
import { Field, Notice, Spinner } from '../components/ui.jsx'

function Shell({ title, sub, children, footer }) {
  const { signIn } = useAuth()
  const nav = useNavigate()
  const quick = async (email, password) => {
    try { const r = await api('/auth/login', { method: 'POST', body: { email, password, device_id: realDeviceId() } }); signIn(r); nav(r.user.role === 'admin' ? '/ops' : '/') } catch { /* shown by form */ }
  }
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <section className="hidden flex-col justify-between bg-ink-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand"><ShieldCheck size={22} /></div>
          <span className="font-display text-2xl font-extrabold">Aegis</span>
        </div>
        <div>
          <h1 className="font-display text-5xl font-extrabold leading-[1.05]">Money moves fast. Fraud moves faster. We check first.</h1>
          <p className="mt-5 max-w-md text-lg text-ink-200">Every transfer is scored in real time against your own habits and the recipient's behaviour. Risky ones ask for more proof. They are never silently blocked.</p>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold text-ink-400">Showcase accounts (one click)</p>
          <div className="grid max-w-md grid-cols-2 gap-3">
            <button onClick={() => quick('chidi@demo.ng', 'Demo@1234')} className="rounded-2xl border border-white/15 p-4 text-left hover:bg-white/10">
              <p className="font-semibold">Chidi Okeke</p><p className="text-xs text-ink-400">Customer · 60 days of history · PIN 1234</p>
            </button>
            <button onClick={() => quick('analyst@aegis.demo', 'Admin@123')} className="rounded-2xl border border-white/15 p-4 text-left hover:bg-white/10">
              <p className="font-semibold">Fraud analyst</p><p className="text-xs text-ink-400">Live dashboard and Ponzi radar</p>
            </button>
          </div>
        </div>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <h2 className="text-3xl font-extrabold">{title}</h2>
          <p className="mb-7 mt-1.5 text-ink-600">{sub}</p>
          {children}
          <p className="mt-6 text-center text-sm text-ink-600">{footer}</p>
        </div>
      </section>
    </div>
  )
}

export function Login() {
  const { signIn } = useAuth()
  const [f, setF] = useState({ email: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('')
    try { signIn(await api('/auth/login', { method: 'POST', body: { ...f, device_id: realDeviceId() } })) }
    catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <Shell title="Welcome back" sub="Sign in to your account." footer={<>New to Aegis? <Link className="font-semibold text-brand" to="/register">Open an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><input className="input" type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password"><input className="input" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {err && <Notice tone="danger">{err}</Notice>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</button>
      </form>
    </Shell>
  )
}

export function Register() {
  const { signIn } = useAuth()
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '', pin: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('')
    try { signIn(await api('/auth/register', { method: 'POST', body: { ...f, device_id: realDeviceId() } })) }
    catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <Shell title="Open your account" sub="You get ₦50,000 to try the demo." footer={<>Already banking with us? <Link className="font-semibold text-brand" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name"><input className="input" required minLength={3} value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label="Email"><input className="input" type="email" required value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Password" hint="At least 8 characters."><input className="input" type="password" required minLength={8} value={f.password} onChange={set('password')} /></Field>
        <Field label="Transaction PIN" hint="4 digits. You will enter it for every transfer."><input className="input" inputMode="numeric" maxLength={4} pattern="\d{4}" required value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} /></Field>
        {err && <Notice tone="danger">{err}</Notice>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : 'Create account'}</button>
      </form>
    </Shell>
  )
}
