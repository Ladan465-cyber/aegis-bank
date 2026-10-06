import { useEffect, useState } from 'react'
import { Flag, Printer, ShieldCheck } from 'lucide-react'
import { api, fmtDate, naira, printReceipt, printStatement } from '../lib.js'
import { useAuth } from '../auth.jsx'
import StepUp from '../components/StepUp.jsx'
import TxnRow from '../components/TxnRow.jsx'
import { Empty, Modal, ModalHeader, Notice, RiskBadge, Spinner, StatusPill, useAsync } from '../components/ui.jsx'

const TABS = [['', 'All'], ['debit', 'Money out'], ['credit', 'Money in'], ['PENDING_VERIFICATION', 'Awaiting verification']]

function Detail({ ref_, onClose, onResume, onReported }) {
  const { data: t, loading, reload } = useAsync(() => api('/transfers/' + ref_), [ref_])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function report() {
    setBusy(true)
    try { await api(`/transfers/${ref_}/report`, { method: 'POST' }); setMsg('Reported. Our fraud team has been alerted.'); reload(); onReported() }
    catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose}>
      <ModalHeader title="Transaction details" onClose={onClose} />
      {loading || !t ? <div className="p-10 text-center"><Spinner /></div> : (
        <div className="space-y-4 px-6 py-5">
          <div className="text-center">
            <p className="font-display text-4xl font-extrabold">{naira(t.amount_kobo)}</p>
            <div className="mt-2 flex justify-center gap-2"><StatusPill status={t.status} />{t.risk_score >= 30 && t.direction === 'debit' && <RiskBadge level={t.risk_level} score={t.risk_score} />}</div>
          </div>
          <dl className="divide-y divide-ink-900/5 rounded-xl bg-paper px-4 text-sm">
            {[['From', `${t.sender.name} · ${t.sender.account_number} · ${t.sender.bank}`], ['To', `${t.recipient.name} · ${t.recipient.account_number} · ${t.recipient.bank}`],
              ['Narration', t.narration || '-'], ['Reference', t.reference], ['Date', fmtDate(t.created_at)], ['Location', t.city || '-'],
              ...(t.verified_with?.length ? [['Verified with', t.verified_with.join(' + ')]] : [])].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-ink-600">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>
            ))}
          </dl>
          {t.risk?.reasons?.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-bold"><ShieldCheck size={16} className="text-brand" /> Why this was checked</p>
              <ul className="space-y-1.5 text-sm text-ink-700">{t.risk.reasons.map((r) => <li key={r.code} className="rounded-lg bg-paper px-3 py-2"><b>{r.title}.</b> {r.detail}</li>)}</ul>
            </div>
          )}
          {t.failure_reason && <Notice tone="danger">{t.failure_reason}</Notice>}
          {msg && <Notice tone="info">{msg}</Notice>}
          <div className="flex flex-wrap gap-2">
            {t.status === 'PENDING_VERIFICATION' && <button className="btn-primary flex-1" onClick={() => onResume(t)}>Resume verification</button>}
            {t.status === 'COMPLETED' && <button className="btn-ghost flex-1" onClick={() => printReceipt(t)}><Printer size={16} /> Receipt</button>}
            {t.status === 'COMPLETED' && t.direction === 'debit' && !t.reported && (
              <button className="btn-ghost flex-1 !text-danger" disabled={busy} onClick={report}><Flag size={16} /> This was a scam</button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

export default function History() {
  const { user, refreshUser } = useAuth()
  const [tab, setTab] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [resume, setResume] = useState(null)
  const { data, loading, reload } = useAsync(() => {
    const p = new URLSearchParams({ limit: 100, q })
    if (tab === 'debit' || tab === 'credit') p.set('direction', tab)
    else if (tab) p.set('status', tab)
    return api('/transfers?' + p)
  }, [tab, q])
  useEffect(() => { const h = () => reload(); window.addEventListener('aegis:refresh', h); return () => window.removeEventListener('aegis:refresh', h) }) // eslint-disable-line

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-extrabold">Transactions</h1><p className="text-ink-600">Every movement on your account.</p></div>
        <button className="btn-ghost" disabled={!data?.length} onClick={() => printStatement(data.filter((t) => t.status === 'COMPLETED'), user)}><Printer size={16} /> Print statement</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === k ? 'bg-ink-900 text-white' : 'bg-white text-ink-700 border border-ink-900/10 hover:bg-ink-900/5'}`}>{l}</button>)}
        <input className="input ml-auto max-w-xs" placeholder="Search name, reference, narration" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <section className="card divide-y divide-ink-900/5 overflow-hidden">
        {loading ? <div className="p-10 text-center"><Spinner /></div> : data?.length ? data.map((t) => <TxnRow key={t.reference} t={t} onClick={() => setOpen(t.reference)} />) : <Empty title="Nothing here">No transactions match this filter.</Empty>}
      </section>
      {open && <Detail ref_={open} onClose={() => setOpen(null)} onReported={reload} onResume={(t) => { setOpen(null); setResume(t) }} />}
      {resume && <StepUp txn={resume} faceEnrolled={user.face_enrolled} onChange={(t) => { setResume(t); if (t.status !== 'PENDING_VERIFICATION') { refreshUser(); reload() } }} onClose={() => { setResume(null); reload() }} />}
    </div>
  )
}
