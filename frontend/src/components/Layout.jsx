import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Bell, FlaskConical, Home, LogOut, MapPin, Plus, Radar, Receipt, Send, ShieldCheck, Smartphone, Users } from 'lucide-react'
import { api, CITIES, naira, setDemo, useDemo } from '../lib.js'
import { useAuth } from '../auth.jsx'

const CUSTOMER_NAV = [
  { to: '/', label: 'Home', icon: Home, end: true }, { to: '/transfer', label: 'Send money', icon: Send },
  { to: '/history', label: 'Transactions', icon: Receipt }, { to: '/beneficiaries', label: 'Beneficiaries', icon: Users },
  { to: '/security', label: 'Security', icon: ShieldCheck }, { to: '/notifications', label: 'Alerts', icon: Bell },
]
const ADMIN_NAV = [{ to: '/ops', label: 'Fraud operations', icon: Radar, end: true }]

function DemoPanel() {
  const { user, refreshUser } = useAuth()
  const demo = useDemo()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const simulating = demo.city !== 'Lagos' || demo.newDevice
  async function fund() {
    setBusy(true)
    try { await api('/accounts/fund', { method: 'POST', body: { amount: 100000 } }); await refreshUser(); window.dispatchEvent(new Event('aegis:refresh')) } finally { setBusy(false) }
  }
  return (
    <div className="no-print fixed bottom-20 right-4 z-40 md:bottom-5">
      {open && (
        <div className="pop mb-3 w-72 rounded-2xl border border-ink-900/15 bg-white p-4">
          <p className="font-display text-base font-bold">Demo controls</p>
          <p className="mt-0.5 text-xs text-ink-600">Change where and how this transfer appears to come from.</p>
          <label className="label mt-4"><MapPin size={14} className="mr-1 inline" />Pretend I am in</label>
          <select className="input" value={demo.city} onChange={(e) => setDemo({ city: e.target.value })}>
            {Object.keys(CITIES).map((c) => <option key={c} value={c}>{c}{c === 'Lagos' ? ' (home)' : ''}</option>)}
          </select>
          <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span><Smartphone size={14} className="mr-1 inline" />Use an unrecognised device</span>
            <input type="checkbox" className="size-4 accent-brand" checked={demo.newDevice} onChange={(e) => setDemo({ newDevice: e.target.checked })} />
          </label>
          {user?.role === 'customer' && (
            <button className="btn-ghost mt-4 w-full" disabled={busy} onClick={fund}><Plus size={16} /> Add {naira(10000000, 0)} to my account</button>
          )}
        </div>
      )}
      <button onClick={() => setOpen(!open)} className={`ml-auto flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold ${simulating ? 'bg-alert text-white' : 'bg-ink-900 text-white'}`}>
        <FlaskConical size={16} /> {simulating ? `Simulating: ${demo.city}${demo.newDevice ? ' + new device' : ''}` : 'Demo controls'}
      </button>
    </div>
  )
}

export default function Layout() {
  const { user, signOut } = useAuth()
  const nav = useNavigate()
  const items = user.role === 'admin' ? ADMIN_NAV : CUSTOMER_NAV
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    if (user.role === 'admin') return
    const load = () => api('/notifications').then((n) => setUnread(n.filter((x) => !x.is_read).length)).catch(() => {})
    load()
    const id = setInterval(load, 15000)
    window.addEventListener('aegis:refresh', load)
    return () => { clearInterval(id); window.removeEventListener('aegis:refresh', load) }
  }, [user.role])

  const linkCls = ({ isActive }) => `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-white text-ink-900' : 'text-ink-200 hover:bg-white/10'}`
  return (
    <div className="min-h-full md:flex">
      <aside className="no-print hidden w-64 shrink-0 flex-col bg-ink-900 p-4 md:fixed md:inset-y-0 md:flex">
        <div className="flex items-center gap-2.5 px-2 py-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-brand"><ShieldCheck size={20} className="text-white" /></div>
          <span className="font-display text-xl font-extrabold text-white">Aegis</span>
        </div>
        <nav className="mt-6 flex flex-col gap-1">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkCls}>
              <Icon size={18} /> {label}
              {to === '/notifications' && unread > 0 && <span className="ml-auto rounded-full bg-danger px-2 py-0.5 text-xs text-white">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl bg-ink-800 p-3">
          <p className="truncate text-sm font-semibold text-white">{user.full_name}</p>
          <p className="truncate text-xs text-ink-400">{user.role === 'admin' ? 'Fraud analyst' : user.account?.account_number + ' · ' + user.account?.bank}</p>
          <button onClick={() => { signOut(); nav('/login') }} className="mt-3 flex items-center gap-2 text-sm font-semibold text-ink-200 hover:text-white"><LogOut size={16} /> Sign out</button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-24 md:ml-64 md:pb-10">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8"><Outlet /></div>
      </main>

      <nav className="no-print fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-ink-900/10 bg-white px-1 py-1.5 md:hidden">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `relative flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] font-semibold ${isActive ? 'text-brand' : 'text-ink-600'}`}>
            <Icon size={20} />{label.split(' ')[0]}
            {to === '/notifications' && unread > 0 && <span className="absolute right-3 top-0.5 size-2 rounded-full bg-danger" />}
          </NavLink>
        ))}
        <button onClick={() => { signOut(); nav('/login') }} className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] font-semibold text-ink-600"><LogOut size={20} />Exit</button>
      </nav>
      <DemoPanel />
    </div>
  )
}
