import { naira } from '../lib.js'

/**
 * Money-flow graph. Senders fan in from the left, payees fan out on the right.
 * Dashes animate along each edge so the direction of money is obvious on a projector.
 */
export default function NetworkGraph({ data }) {
  const W = 900, H = 540, cx = 450, cy = 270, R = 300
  const { center, senders, payees } = data
  const place = (list, from, to) => list.map((n, i) => {
    const a = ((from + ((to - from) * (list.length === 1 ? 0.5 : i / (list.length - 1)))) * Math.PI) / 180
    return { ...n, x: cx + R * Math.cos(a), y: cy + R * 0.82 * Math.sin(a) }
  })
  const S = place(senders, 125, 235)
  const P = place(payees, -48, 48)
  const maxS = Math.max(1, ...senders.map((s) => s.amount_kobo))
  const maxP = Math.max(1, ...payees.map((s) => s.amount_kobo))
  const hot = center.score >= 50

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-2xl bg-ink-900" role="img" aria-label={`Money flow around ${center.name}`}>
      <text x="24" y="34" fill="#7B80B8" fontSize="13" fontWeight="600">Who paid in</text>
      <text x={W - 24} y="34" fill="#7B80B8" fontSize="13" fontWeight="600" textAnchor="end">Where it went next</text>
      {S.map((n) => (
        <line key={'e' + n.id} x1={n.x} y1={n.y} x2={cx} y2={cy} stroke="#6D75FF" strokeOpacity=".55" strokeWidth={1 + (n.amount_kobo / maxS) * 2.2} className="flow-edge" />
      ))}
      {P.map((n) => (
        <line key={'o' + n.id} x1={cx} y1={cy} x2={n.x} y2={n.y} stroke="#FF6B4A" strokeWidth={2 + (n.amount_kobo / maxP) * 6} strokeOpacity=".85" className="flow-edge" />
      ))}
      {S.map((n) => (
        <circle key={n.id} cx={n.x} cy={n.y} r="6.5" fill="#C9CCE8" stroke="#0E1130" strokeWidth="2">
          <title>{`${n.name} (${n.bank}) paid ${naira(n.amount_kobo, 0)} in ${n.count} transfer(s)`}</title>
        </circle>
      ))}
      {P.map((n) => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r="12" fill="#FF6B4A" stroke="#0E1130" strokeWidth="3"><title>{`${n.name} received ${naira(n.amount_kobo, 0)}`}</title></circle>
          <text x={n.x} y={n.y + 28} fill="#fff" fontSize="12" textAnchor="middle" fontWeight="600">{n.name.length > 18 ? n.name.slice(0, 17) + '…' : n.name}</text>
          <text x={n.x} y={n.y + 42} fill="#FFB4A2" fontSize="11" textAnchor="middle">{naira(n.amount_kobo, 0)}</text>
        </g>
      ))}
      {hot && <circle cx={cx} cy={cy} r="46" fill="none" stroke="#D62B48" strokeWidth="3" className="pulse-ring" />}
      <circle cx={cx} cy={cy} r="46" fill={hot ? '#D62B48' : '#3341E8'} stroke="#fff" strokeWidth="3" />
      <text x={cx} y={cy - 2} fill="#fff" fontSize="26" fontWeight="800" textAnchor="middle" fontFamily="Bricolage Grotesque">{center.score}</text>
      <text x={cx} y={cy + 16} fill="#fff" fontSize="10.5" textAnchor="middle" opacity=".85">recipient risk</text>
      <text x={cx} y={cy + 72} fill="#fff" fontSize="14" fontWeight="700" textAnchor="middle">{center.name}</text>
      <text x={cx} y={cy + 90} fill="#7B80B8" fontSize="12" textAnchor="middle">{center.id} · {center.bank}</text>
    </svg>
  )
}
