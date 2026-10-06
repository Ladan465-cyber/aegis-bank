import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'

export const RISK = {
  LOW: { label: 'Low risk', cls: 'bg-safe/10 text-safe', color: '#0E9F6E' },
  MEDIUM: { label: 'Medium risk', cls: 'bg-warn/15 text-warn', color: '#D99200' },
  HIGH: { label: 'High risk', cls: 'bg-alert/10 text-alert', color: '#EA5A24' },
  CRITICAL: { label: 'Critical risk', cls: 'bg-danger/10 text-danger', color: '#D62B48' },
}

export function RiskBadge({ level = 'LOW', score }) {
  const r = RISK[level] || RISK.LOW
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${r.cls}`}>
      {r.label}{score !== undefined && <span className="opacity-70">· {score}</span>}
    </span>
  )
}

export function StatusPill({ status }) {
  const map = {
    COMPLETED: 'bg-safe/10 text-safe', PENDING_VERIFICATION: 'bg-warn/15 text-warn',
    CANCELLED: 'bg-ink-900/10 text-ink-600', FAILED: 'bg-danger/10 text-danger',
  }
  const text = { COMPLETED: 'Successful', PENDING_VERIFICATION: 'Awaiting verification', CANCELLED: 'Cancelled', FAILED: 'Failed' }
  return <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${map[status] || ''}`}>{text[status] || status}</span>
}

export function Spinner({ className = '' }) {
  return <Loader2 className={`animate-spin ${className}`} size={18} />
}

export function Avatar({ name, size = 40, tone = 'brand' }) {
  const init = (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  const tones = { brand: 'bg-brand-100 text-brand-600', ink: 'bg-ink-900 text-white', danger: 'bg-danger/10 text-danger' }
  return (
    <div style={{ width: size, height: size }} className={`flex shrink-0 items-center justify-center rounded-full text-xs font-bold ${tones[tone]}`}>{init}</div>
  )
}

export function Modal({ open, onClose, children, width = 'max-w-lg', dismissible = true }) {
  useEffect(() => {
    if (!open) return
    const h = (e) => e.key === 'Escape' && dismissible && onClose?.()
    window.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = '' }
  }, [open, dismissible, onClose])
  if (!open) return null
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-ink-950/60 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose?.()}>
      <div role="dialog" aria-modal="true" className={`pop max-h-[94vh] w-full ${width} overflow-y-auto rounded-t-3xl bg-white sm:rounded-3xl`}>
        {children}
      </div>
    </div>
  )
}

export function ModalHeader({ title, sub, onClose }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-900/10 px-6 py-4">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {sub && <p className="mt-0.5 text-sm text-ink-600">{sub}</p>}
      </div>
      {onClose && <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink-600 hover:bg-ink-900/5"><X size={18} /></button>}
    </div>
  )
}

export function Field({ label, hint, error, children }) {
  return (
    <div>
      {label && <label className="label">{label}</label>}
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-ink-600">{hint}</p>}
      {error && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </div>
  )
}

export function Notice({ tone = 'info', children, className = '' }) {
  const t = {
    info: 'bg-brand-50 text-brand-600 border-brand-100', danger: 'bg-danger/5 text-danger border-danger/20',
    warn: 'bg-warn/10 text-ink-900 border-warn/30', safe: 'bg-safe/10 text-safe border-safe/20',
  }
  return <div className={`rounded-xl border px-4 py-3 text-sm ${t[tone]} ${className}`}>{children}</div>
}

export function useAsync(fn, deps = []) {
  const [state, set] = useState({ data: null, loading: true, error: null })
  const run = () => {
    set((s) => ({ ...s, loading: true }))
    return fn().then((data) => set({ data, loading: false, error: null })).catch((error) => set({ data: null, loading: false, error }))
  }
  useEffect(() => { run() }, deps) // eslint-disable-line
  return { ...state, reload: run, setData: (d) => set((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) }
}

export function Empty({ title, children }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-display text-base font-bold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-ink-600">{children}</p>}
    </div>
  )
}

/** Semicircle risk gauge. The needle sweeps from 0 to the score on mount. */
export function Gauge({ score = 0, level = 'LOW' }) {
  const [v, setV] = useState(0)
  useEffect(() => { const t = setTimeout(() => setV(score), 80); return () => clearTimeout(t) }, [score])
  const cx = 100, cy = 100, r = 80
  const pt = (s) => { const a = Math.PI * (1 - s / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)] }
  const seg = (a, b, color) => {
    const [x1, y1] = pt(a), [x2, y2] = pt(b)
    return <path key={a} d={`M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`} stroke={color} strokeWidth="14" fill="none" />
  }
  const color = RISK[level].color
  return (
    <div className="relative mx-auto w-48">
      <svg viewBox="0 0 200 118" className="w-full" role="img" aria-label={`Risk score ${score} of 100`}>
        {seg(0, 29.5, '#0E9F6E')}{seg(30.5, 59.5, '#D99200')}{seg(60.5, 84.5, '#EA5A24')}{seg(85.5, 100, '#D62B48')}
        <g style={{ transform: `rotate(${(v / 100) * 180 - 90}deg)`, transformOrigin: '100px 100px', transition: 'transform 1s cubic-bezier(.2,.9,.3,1.1)' }}>
          <path d="M100 100 L100 30" stroke="#0E1130" strokeWidth="3" strokeLinecap="round" />
          <circle cx="100" cy="100" r="7" fill="#0E1130" />
        </g>
      </svg>
      <div className="-mt-3 text-center">
        <div className="font-display text-3xl font-extrabold" style={{ color }}>{score}</div>
        <div className="text-xs font-semibold text-ink-600">out of 100</div>
      </div>
    </div>
  )
}
