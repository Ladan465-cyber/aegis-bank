import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { Check, Copy, Eye, EyeOff, ScanFace, Send, ShieldCheck } from 'lucide-react'
import { api, naira } from '../lib.js'
import { useAuth } from '../auth.jsx'
import TxnRow from '../components/TxnRow.jsx'
import { Empty, Notice, Spinner, useAsync } from '../components/ui.jsx'

export default function Dashboard() {
  const { user, refreshUser } = useAuth()
  const nav = useNavigate()
  const [hide, setHide] = useState(false)
  const [copied, setCopied] = useState(false)
  const sum = useAsync(() => api('/accounts/summary'), [])
  const txns = useAsync(() => api('/transfers?limit=7'), [])
  useEffect(() => {
    const h = () => { refreshUser(); sum.reload(); txns.reload() }
    window.addEventListener('aegis:refresh', h)
    return () => window.removeEventListener('aegis:refresh', h)
  }) // eslint-disable-line
  const a = user.account
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">{greet}, {user.full_name.split(' ')[0]}</h1>
        <p className="text-ink-600">Here is where your money stands today.</p>
      </div>

      {sum.data?.pending > 0 && (
        <Notice tone="warn">
          You have {sum.data.pending} transfer(s) waiting for verification. <Link to="/history" className="font-bold underline">Finish them in Transactions</Link>.
        </Notice>
      )}
      {a.status === 'FROZEN' && <Notice tone="danger">Your account is frozen. Transfers out are disabled. You can unfreeze it in Security.</Notice>}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl bg-ink-900 p-6 text-white">
          <div className="flex items-center justify-between text-sm text-ink-200">
            <span>Available balance</span>
            <button onClick={() => setHide(!hide)} aria-label="Toggle balance" className="rounded-lg p-1.5 hover:bg-white/10">{hide ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div>
          <p className="font-display mt-1 text-5xl font-extrabold tracking-tight">{hide ? '₦ ••••••' : naira(a.balance_kobo)}</p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => { navigator.clipboard?.writeText(a.account_number); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15">
              {a.account_number} · {a.bank} {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <Link to="/transfer" className="btn bg-white text-ink-900 hover:bg-brand-100"><Send size={16} /> Send money</Link>
          </div>
        </section>

        <section className="card p-5">
          <p className="flex items-center gap-2 font-display text-base font-bold"><ShieldCheck size={18} className="text-safe" /> Your protection</p>
          <ul className="mt-3 space-y-2.5 text-sm">
            <li className="flex items-center gap-2"><Check size={16} className="text-safe" /> Transaction PIN set</li>
            <li className="flex items-center gap-2"><Check size={16} className="text-safe" /> Real-time fraud scoring on every transfer</li>
            <li className="flex items-center gap-2">{user.face_enrolled ? <Check size={16} className="text-safe" /> : <ScanFace size={16} className="text-warn" />}
              {user.face_enrolled ? 'Face enrolled for risky transfers' : <>Face not enrolled. <Link className="font-bold text-brand" to="/security">Enrol now</Link></>}</li>
          </ul>
          <p className="mt-4 rounded-xl bg-paper p-3 text-xs text-ink-600">{sum.data ? `${sum.data.stepped_up} transfer(s) needed extra verification in the last 30 days.` : 'Loading protection stats…'}</p>
        </section>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[['Money in (30 days)', sum.data?.total_in_kobo, 'text-safe'], ['Money out (30 days)', sum.data?.total_out_kobo, 'text-ink-900']].map(([l, v, c]) => (
          <div key={l} className="card p-5"><p className="text-sm text-ink-600">{l}</p><p className={`font-display mt-1 text-2xl font-extrabold ${c}`}>{sum.data ? naira(v, 0) : '…'}</p></div>
        ))}
        <div className="card p-4">
          <p className="text-sm text-ink-600">Daily spending, 14 days</p>
          <div className="h-16">
            {sum.data && <ResponsiveContainer><BarChart data={sum.data.daily_out}><XAxis dataKey="date" hide /><Tooltip formatter={(v) => '₦' + v.toLocaleString()} labelFormatter={() => ''} cursor={{ fill: '#EEF0FF' }} /><Bar dataKey="amount" fill="#3341E8" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>}
          </div>
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-900/10 px-4 py-3.5">
          <h2 className="text-lg font-bold">Recent activity</h2>
          <Link to="/history" className="text-sm font-semibold text-brand">See all</Link>
        </div>
        {txns.loading ? <div className="p-8 text-center"><Spinner /></div> : txns.data?.length ? (
          <div className="divide-y divide-ink-900/5">{txns.data.map((t) => <TxnRow key={t.reference} t={t} onClick={() => nav("/history")} />)}</div>
        ) : <Empty title="No transactions yet">Send your first transfer to see it here.</Empty>}
      </section>
    </div>
  )
}
