import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, Trash2, AlertTriangle } from 'lucide-react'
import { api } from '../lib.js'
import { Avatar, Empty, Field, Notice, Spinner, useAsync } from '../components/ui.jsx'

export default function Beneficiaries() {
  const nav = useNavigate()
  const banks = useAsync(() => api('/banks'), [])
  const list = useAsync(() => api('/beneficiaries'), [])
  const [f, setF] = useState({ bank_code: '', account_number: '', nickname: '' })
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { if (!f.bank_code && banks.data) setF((p) => ({ ...p, bank_code: banks.data[3]?.code || banks.data[0].code })) }, [banks.data]) // eslint-disable-line
  useEffect(() => {
    setName(''); setErr('')
    if (f.account_number.length !== 10 || !f.bank_code) return
    api(`/accounts/resolve?account_number=${f.account_number}&bank_code=${f.bank_code}`).then((r) => setName(r.account_name)).catch((e) => setErr(e.message))
  }, [f.account_number, f.bank_code])

  async function add(e) {
    e.preventDefault()
    try { await api('/beneficiaries', { method: 'POST', body: f }); setF({ ...f, account_number: '', nickname: '' }); list.reload() } catch (x) { setErr(x.message) }
  }
  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-extrabold">Beneficiaries</h1><p className="text-ink-600">People and businesses you pay often.</p></div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="card divide-y divide-ink-900/5 overflow-hidden">
          {list.loading ? <div className="p-10 text-center"><Spinner /></div> : list.data?.length ? list.data.map((b) => (
            <div key={b.id} className="flex items-center gap-3 px-4 py-3.5">
              <Avatar name={b.name} tone={b.flagged ? 'danger' : 'brand'} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{b.nickname} <span className="font-normal text-ink-600">· {b.name}</span></p>
                <p className="text-xs text-ink-600">{b.account_number} · {b.bank}</p>
                {b.flagged && <p className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-danger"><AlertTriangle size={13} /> Flagged by fraud monitoring</p>}
              </div>
              <button className="btn-ghost !px-3" onClick={() => nav('/transfer', { state: { prefill: { bank_code: b.bank_code, account_number: b.account_number } } })}><Send size={15} /> Send</button>
              <button aria-label="Remove" className="rounded-lg p-2 text-ink-400 hover:bg-danger/10 hover:text-danger" onClick={() => api('/beneficiaries/' + b.id, { method: 'DELETE' }).then(list.reload)}><Trash2 size={16} /></button>
            </div>
          )) : <Empty title="No beneficiaries yet">Add one here, or tick "Save as beneficiary" when you send money.</Empty>}
        </section>
        <form onSubmit={add} className="card h-fit space-y-4 p-5">
          <p className="font-display text-lg font-bold">Add a beneficiary</p>
          <Field label="Bank"><select className="input" value={f.bank_code} onChange={(e) => setF({ ...f, bank_code: e.target.value })}>{banks.data?.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</select></Field>
          <Field label="Account number"><input className="input" inputMode="numeric" maxLength={10} value={f.account_number} onChange={(e) => setF({ ...f, account_number: e.target.value.replace(/\D/g, '') })} /></Field>
          {name && <Notice tone="safe"><b>{name}</b></Notice>}
          {err && <Notice tone="danger">{err}</Notice>}
          <Field label="Nickname (optional)"><input className="input" value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} /></Field>
          <button className="btn-primary w-full" disabled={!name}>Save beneficiary</button>
        </form>
      </div>
    </div>
  )
}
