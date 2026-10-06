import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { fmtDate, naira } from '../lib.js'
import { Avatar, RiskBadge, StatusPill } from './ui.jsx'

export default function TxnRow({ t, onClick }) {
  const credit = t.direction === 'credit'
  const other = credit ? t.sender : t.recipient
  const Arrow = credit ? ArrowDownLeft : ArrowUpRight
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-paper">
      <div className="relative">
        <Avatar name={other.name} />
        <span className={`absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full border-2 border-white ${credit ? 'bg-safe' : 'bg-ink-900'} text-white`}><Arrow size={10} /></span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{other.name}</p>
        <p className="truncate text-xs text-ink-600">{t.narration || (credit ? 'Credit' : 'Transfer')} · {fmtDate(t.created_at)}</p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <p className={`text-sm font-bold ${credit ? 'text-safe' : t.status === 'COMPLETED' ? 'text-ink-900' : 'text-ink-400 line-through'}`}>{credit ? '+' : '-'}{naira(t.amount_kobo)}</p>
        {t.status !== 'COMPLETED' ? <StatusPill status={t.status} /> : !credit && t.risk_score >= 30 ? <RiskBadge level={t.risk_level} /> : null}
      </div>
    </button>
  )
}
