import { useEffect, useState } from 'react'

// ------------------------------------------------------------------ formatting
export const naira = (kobo, dp = 2) =>
  '₦' + (Number(kobo || 0) / 100).toLocaleString('en-NG', { minimumFractionDigits: dp, maximumFractionDigits: dp })
export const fmtDate = (iso, withTime = true) =>
  iso ? new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }) : ''
export const timeAgo = (iso) => {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}
export const initials = (n = '') => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

// ------------------------------------------------------------------ session + api
// Empty in local dev (Vite proxies /api). On Render, set VITE_API_URL to the backend URL.
export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export const wsBase = () => (API ? API.replace(/^http/, 'ws') : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`)
const TKEY = 'aegis_tokens'
export const session = {
  get() { try { return JSON.parse(localStorage.getItem(TKEY)) } catch { return null } },
  set(t) { localStorage.setItem(TKEY, JSON.stringify(t)) },
  clear() { localStorage.removeItem(TKEY) },
}
let refreshing = null
function refresh() {
  const s = session.get()
  if (!s) return Promise.resolve(false)
  refreshing ||= fetch(API + '/api/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }),
  }).then(async (r) => {
    if (!r.ok) throw new Error('refresh failed')
    const d = await r.json()
    session.set({ access_token: d.access_token, refresh_token: d.refresh_token })
    return true
  }).catch(() => { session.clear(); return false }).finally(() => { refreshing = null })
  return refreshing
}
export async function api(path, { method = 'GET', body } = {}, retry = true) {
  const s = session.get()
  const res = await fetch(API + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: 'Bearer ' + s.access_token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && s && retry && !path.startsWith('/auth/')) {
    if (await refresh()) return api(path, { method, body }, false)
    window.dispatchEvent(new Event('aegis:logout'))
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const d = data?.detail
    const e = new Error(typeof d === 'string' ? d : Array.isArray(d) ? 'Please check the form fields and try again.' : 'Something went wrong.')
    e.status = res.status
    throw e
  }
  return data
}

// ------------------------------------------------------------------ demo controls (location / device)
export const CITIES = {
  Lagos: { lat: 6.5244, lon: 3.3792 }, Abuja: { lat: 9.0765, lon: 7.3986 }, 'Port Harcourt': { lat: 4.8156, lon: 7.0498 },
  London: { lat: 51.5072, lon: -0.1276 }, Dubai: { lat: 25.2048, lon: 55.2708 },
}
const DK = 'aegis_demo'
export const getDemo = () => ({ city: 'Lagos', newDevice: false, ...JSON.parse(localStorage.getItem(DK) || '{}') })
export function setDemo(patch) {
  localStorage.setItem(DK, JSON.stringify({ ...getDemo(), ...patch }))
  window.dispatchEvent(new Event('aegis:demo'))
}
export function useDemo() {
  const [d, setD] = useState(getDemo())
  useEffect(() => {
    const h = () => setD(getDemo())
    window.addEventListener('aegis:demo', h)
    return () => window.removeEventListener('aegis:demo', h)
  }, [])
  return d
}
export function realDeviceId() {
  let id = localStorage.getItem('aegis_device')
  if (!id) { id = 'dev-' + crypto.randomUUID().slice(0, 12); localStorage.setItem('aegis_device', id) }
  return id
}
export const deviceId = () => (getDemo().newDevice ? 'unrecognised-' + realDeviceId() : realDeviceId())
export function currentLocation() {
  const d = getDemo()
  const c = CITIES[d.city] || CITIES.Lagos
  return { city: d.city, lat: c.lat, lon: c.lon }
}

// ------------------------------------------------------------------ printing (receipt / statement)
function printHtml(title, body) {
  const w = window.open('', '_blank', 'width=820,height=900')
  if (!w) return alert('Allow pop-ups to print.')
  w.document.write(`<!doctype html><html><head><title>${title}</title><style>
    body{font-family:system-ui,sans-serif;color:#0E1130;padding:40px;max-width:760px;margin:auto}
    h1{font-size:22px;margin:0}.muted{color:#5b5f8c;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:18px}
    td,th{padding:9px 6px;border-bottom:1px solid #e3e4f0;text-align:left;font-size:13px}th{color:#5b5f8c;font-weight:600}
    .amt{font-size:30px;font-weight:800;margin:14px 0}.r{text-align:right}</style></head><body>${body}</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 350)
}
export function printReceipt(t) {
  const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`
  printHtml('Receipt ' + t.reference, `<h1>Aegis Bank</h1><div class="muted">Transfer receipt</div>
    <div class="amt">${naira(t.amount_kobo)}</div><table>
    ${row('Status', t.status)}${row('From', `${t.sender.name} · ${t.sender.account_number} · ${t.sender.bank}`)}
    ${row('To', `${t.recipient.name} · ${t.recipient.account_number} · ${t.recipient.bank}`)}
    ${row('Narration', t.narration || '-')}${row('Reference', t.reference)}${row('Date', fmtDate(t.created_at))}
    ${row('Verified with', (t.verified_with || []).join(', ') || 'No extra verification needed')}</table>
    <p class="muted" style="margin-top:28px">Generated by Aegis Bank. Keep this receipt for your records.</p>`)
}
export function printStatement(list, user) {
  const rows = list.map((t) => `<tr><td>${fmtDate(t.created_at)}</td><td>${t.direction === 'credit' ? t.sender.name : t.recipient.name}<br><span class="muted">${t.reference}</span></td>
    <td>${t.status}</td><td class="r">${t.direction === 'credit' ? '+' : '-'}${naira(t.amount_kobo)}</td></tr>`).join('')
  printHtml('Statement', `<h1>Account statement</h1><div class="muted">${user.full_name} · ${user.account.account_number} · ${user.account.bank}</div>
    <table><tr><th>Date</th><th>Details</th><th>Status</th><th class="r">Amount</th></tr>${rows}</table>`)
}
