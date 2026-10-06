import { useEffect } from 'react'
import { ArrowDownLeft, ArrowUpRight, Bell, ShieldAlert, ShieldCheck } from 'lucide-react'
import { api, timeAgo } from '../lib.js'
import { Empty, Spinner, useAsync } from '../components/ui.jsx'

const KIND = {
  credit: [ArrowDownLeft, 'bg-safe/10 text-safe'], debit: [ArrowUpRight, 'bg-ink-900/10 text-ink-900'],
  security: [ShieldCheck, 'bg-brand-50 text-brand'], fraud: [ShieldAlert, 'bg-danger/10 text-danger'], info: [Bell, 'bg-ink-900/5 text-ink-600'],
}

export default function Notifications() {
  const { data, loading } = useAsync(() => api('/notifications'), [])
  useEffect(() => { const t = setTimeout(() => api('/notifications/read-all', { method: 'POST' }).then(() => window.dispatchEvent(new Event('aegis:refresh'))), 1500); return () => clearTimeout(t) }, [])
  return (
    <div className="space-y-5">
      <div><h1 className="text-3xl font-extrabold">Alerts</h1><p className="text-ink-600">Credits, debits and security events.</p></div>
      <section className="card divide-y divide-ink-900/5 overflow-hidden">
        {loading ? <div className="p-10 text-center"><Spinner /></div> : data?.length ? data.map((n) => {
          const [Icon, cls] = KIND[n.kind] || KIND.info
          return (
            <div key={n.id} className={`flex gap-3 px-4 py-3.5 ${n.is_read ? '' : 'bg-brand-50/60'}`}>
              <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${cls}`}><Icon size={17} /></div>
              <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{n.title}</p><p className="text-sm text-ink-600">{n.body}</p></div>
              <span className="shrink-0 text-xs text-ink-400">{timeAgo(n.created_at)}</span>
            </div>
          )
        }) : <Empty title="You are all caught up" />}
      </section>
    </div>
  )
}
