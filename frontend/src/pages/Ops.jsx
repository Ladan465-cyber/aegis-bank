import { useCallback, useEffect, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Radar, Snowflake } from 'lucide-react'
import { api, fmtDate, naira, session, timeAgo, wsBase } from '../lib.js'
import NetworkGraph from '../components/NetworkGraph.jsx'
import { Empty, Modal, ModalHeader, Notice, RISK, RiskBadge, Spinner, StatusPill, useAsync } from '../components/ui.jsx'

function Kpi({ label, value, tone = '' }) {
  return <div className="card p-4"><p className="text-sm text-ink-600">{label}</p><p className={`font-display mt-1 text-3xl font-extrabold ${tone}`}>{value}</p></div>
}

function TxnDetail({ t, onClose }) {
  return (
    <Modal open onClose={onClose}>
      <ModalHeader title={`${naira(t.amount_kobo)} · ${t.reference}`} sub={`${t.sender.name} → ${t.recipient.name} (${t.recipient.bank})`} onClose={onClose} />
      <div className="space-y-4 px-6 py-5">
        <div className="flex flex-wrap items-center gap-2"><RiskBadge level={t.risk_level} score={t.risk_score} /><StatusPill status={t.status} />
          <span className="text-sm text-ink-600">{t.city || 'Unknown location'} · {fmtDate(t.created_at)}</span></div>
        {t.recipient_warning && <Notice tone="danger"><b>Recipient flagged.</b> {t.recipient_warning}</Notice>}
        {t.risk_reasons?.length ? (
          <ul className="space-y-2">{t.risk_reasons.map((r) => (
            <li key={r.code} className="flex justify-between gap-3 rounded-xl bg-paper px-3.5 py-2.5 text-sm"><span><b>{r.title}.</b> <span className="text-ink-600">{r.detail}</span></span><span className="font-bold">+{r.points}</span></li>
          ))}</ul>
        ) : <p className="text-sm text-ink-600">No risk signals fired for this transfer.</p>}
        {t.verified_with?.length > 0 && <p className="text-sm">Customer passed: <b>{t.verified_with.join(' + ')}</b></p>}
        {t.failure_reason && <Notice tone="warn">{t.failure_reason}</Notice>}
      </div>
    </Modal>
  )
}

function Overview() {
  const stats = useAsync(() => api('/admin/stats'), [])
  const [feed, setFeed] = useState([])
  const [fresh, setFresh] = useState(new Set())
  const [live, setLive] = useState(false)
  const [open, setOpen] = useState(null)
  const [only, setOnly] = useState(false)
  const timer = useRef(null)

  useEffect(() => { api('/admin/feed?limit=40').then(setFeed) }, [])
  useEffect(() => {
    const token = session.get()?.access_token
    const ws = new WebSocket(`${wsBase()}/ws/admin?token=${token}`)
    ws.onopen = () => setLive(true)
    ws.onclose = () => setLive(false)
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data)
      if (ev.type !== 'transaction' && ev.type !== 'report') return
      setFeed((cur) => [ev.data, ...cur.filter((x) => x.reference !== ev.data.reference)].slice(0, 60))
      setFresh((s) => new Set(s).add(ev.data.reference))
      clearTimeout(timer.current)
      timer.current = setTimeout(() => stats.reload(), 800)
    }
    return () => ws.close()
  }, []) // eslint-disable-line

  const s = stats.data
  const shown = only ? feed.filter((t) => t.risk_score >= 30) : feed
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Transfers (24h)" value={s?.total_24h ?? '…'} />
        <Kpi label="Stepped up" value={s?.flagged_24h ?? '…'} tone="text-alert" />
        <Kpi label="Awaiting verification" value={s?.stepped_up_pending ?? '…'} tone="text-warn" />
        <Kpi label="Cancelled" value={s?.cancelled_24h ?? '…'} />
        <Kpi label="Volume (24h)" value={s ? naira(s.volume_kobo, 0) : '…'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="card p-5">
          <p className="font-display text-lg font-bold">Transfers per hour</p>
          <p className="mb-3 text-sm text-ink-600">Grey is all transfers, orange is the ones that needed extra verification.</p>
          <div className="h-56">
            {s && <ResponsiveContainer><BarChart data={s.hourly} barGap={-14}><CartesianGrid vertical={false} stroke="#E8E9F3" /><XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={3} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
              <Tooltip /><Bar dataKey="total" name="All" fill="#C9CCE8" radius={[3, 3, 0, 0]} /><Bar dataKey="flagged" name="Stepped up" fill="#EA5A24" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>}
          </div>
        </section>
        <section className="card p-5">
          <p className="font-display text-lg font-bold">Risk mix and top signals</p>
          <div className="mt-3 space-y-2">
            {s?.levels.map((l) => {
              const max = Math.max(1, ...s.levels.map((x) => x.count))
              return <div key={l.level} className="flex items-center gap-3 text-sm"><span className="w-20 font-semibold">{RISK[l.level].label.split(' ')[0]}</span>
                <div className="h-3 flex-1 rounded-full bg-paper"><div className="h-3 rounded-full" style={{ width: `${(l.count / max) * 100}%`, background: RISK[l.level].color }} /></div><span className="w-8 text-right font-bold">{l.count}</span></div>
            })}
          </div>
          <ul className="mt-4 space-y-1.5 border-t border-ink-900/10 pt-3 text-sm">
            {s?.top_reasons.map((r) => <li key={r.reason} className="flex justify-between"><span>{r.reason}</span><b>{r.count}</b></li>)}
          </ul>
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-900/10 px-5 py-4">
          <p className="flex items-center gap-2.5 font-display text-lg font-bold">Live transaction feed
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-sans text-xs font-semibold ${live ? 'bg-safe/10 text-safe' : 'bg-ink-900/10 text-ink-600'}`}>
              <span className={`size-2 rounded-full ${live ? 'bg-safe' : 'bg-ink-400'}`} />{live ? 'Live' : 'Reconnecting'}</span></p>
          <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only stepped-up</label>
        </div>
        <div className="max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs text-ink-600"><tr><th className="px-5 py-2.5">When</th><th>From → To</th><th>Amount</th><th>Risk</th><th>Status</th></tr></thead>
            <tbody className="divide-y divide-ink-900/5">
              {shown.map((t) => (
                <tr key={t.reference} onClick={() => setOpen(t)} className={`cursor-pointer hover:bg-paper ${fresh.has(t.reference) ? 'row-new' : ''}`}>
                  <td className="whitespace-nowrap px-5 py-3 text-ink-600">{timeAgo(t.created_at)}</td>
                  <td className="py-3 pr-3"><span className="font-semibold">{t.sender.name}</span> <span className="text-ink-400">→</span> {t.recipient.name}</td>
                  <td className="whitespace-nowrap py-3 pr-3 font-semibold">{naira(t.amount_kobo, 0)}</td>
                  <td className="py-3 pr-3"><RiskBadge level={t.risk_level} score={t.risk_score} /></td>
                  <td className="py-3 pr-5"><StatusPill status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <Empty title="No transfers yet">Send one as a customer and it will appear here instantly.</Empty>}
        </div>
      </section>
      {open && <TxnDetail t={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function PonziRadar() {
  const list = useAsync(() => api('/admin/suspicious'), [])
  const [sel, setSel] = useState(null)
  const [graph, setGraph] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback((n) => { setSel(n); setGraph(null); api('/admin/network/' + n).then(setGraph) }, [])
  useEffect(() => { if (list.data?.length && !sel) load(list.data[0].account_number) }, [list.data]) // eslint-disable-line

  async function freeze() {
    setBusy(true)
    try { await api(`/admin/accounts/${sel}/freeze`, { method: 'POST' }); await list.reload(); load(sel) } finally { setBusy(false) }
  }
  if (list.loading) return <div className="p-12 text-center"><Spinner /></div>
  if (!list.data?.length) return <Empty title="No suspicious accounts right now">Accounts that collect from many senders and pass money on quickly will show up here.</Empty>
  const current = list.data.find((x) => x.account_number === sel)

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <ul className="space-y-2">
        {list.data.map((a) => (
          <li key={a.account_number}>
            <button onClick={() => load(a.account_number)} className={`w-full rounded-2xl border p-4 text-left transition ${sel === a.account_number ? 'border-brand bg-brand-50' : 'border-ink-900/10 bg-white hover:bg-paper'}`}>
              <div className="flex items-start justify-between gap-2"><p className="text-sm font-bold">{a.name}</p><span className="rounded-md px-1.5 py-0.5 text-xs font-extrabold text-white" style={{ background: a.score >= 50 ? RISK.CRITICAL.color : RISK.HIGH.color }}>{a.score}</span></div>
              <p className="text-xs text-ink-600">{a.account_number} · {a.bank}{a.status === 'FROZEN' ? ' · FROZEN' : ''}</p>
              <p className="mt-2 text-xs">{a.senders} senders · {naira(a.inflow_kobo, 0)} in 72h</p>
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0 space-y-4">
        {!graph ? <div className="p-16 text-center"><Spinner /></div> : (
          <>
            <NetworkGraph data={graph} />
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div className="card p-4">
                <p className="mb-2 font-display text-base font-bold">Why it is flagged</p>
                <ul className="space-y-1.5 text-sm">{graph.reasons.map((r) => <li key={r.code}><b>{r.title}.</b> <span className="text-ink-600">{r.detail}</span></li>)}</ul>
                <p className="mt-3 border-t border-ink-900/10 pt-3 text-sm text-ink-600">7-day totals: <b className="text-ink-900">{naira(graph.total_in_kobo, 0)}</b> in from {graph.sender_count} senders, <b className="text-ink-900">{naira(graph.total_out_kobo, 0)}</b> paid out.</p>
              </div>
              <button className={`${current?.status === 'FROZEN' ? 'btn-primary' : 'btn-danger'} h-fit`} disabled={busy} onClick={freeze}><Snowflake size={16} /> {current?.status === 'FROZEN' ? 'Unfreeze account' : 'Freeze account'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function Ops() {
  const [tab, setTab] = useState('overview')
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-extrabold">Fraud operations</h1><p className="text-ink-600">Every transfer, scored as it happens.</p></div>
        <div className="flex rounded-xl bg-white p-1 border border-ink-900/10">
          {[['overview', 'Live overview'], ['radar', 'Ponzi radar']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${tab === k ? 'bg-ink-900 text-white' : 'text-ink-700'}`}>{k === 'radar' && <Radar size={15} />}{l}</button>
          ))}
        </div>
      </div>
      {tab === 'overview' ? <Overview /> : <PonziRadar />}
    </div>
  )
}
