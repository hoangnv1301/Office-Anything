// THE PAGE. A pure function from gathered data to HTML, so a test can render
// a fixture office without a server, a filesystem or a browser.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const age = (min) => min == null ? '—' : min < 1 ? 'now' : min < 60 ? `${min}m` : min < 1440 ? `${Math.round(min / 60)}h` : `${Math.round(min / 1440)}d`
const kilo = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n)

export function render(office, checks) {
  const deskRows = office.desks.map((d) => {
    const s = d.stats
    const wt = d.worktop.slice(0, 3).map((f) => `${esc(f.name)} <span class=m>(${age(f.ageMin)})</span>`).join(', ')
    return `<tr>
      <td><b>${esc(d.name)}</b></td>
      <td>${esc(d.kind)}</td>
      <td>${d.live ? '<span class="b live">LIVE</span>' : '<span class=m>dark</span>'}</td>
      <td>${s ? esc(s.model ?? '?') : '<span class=m>never ran</span>'}</td>
      <td class=r>${s ? s.turns : '—'}</td>
      <td class=r>${s ? kilo(s.input + s.cacheRead) + ' in / ' + kilo(s.output) + ' out' : '—'}</td>
      <td class=r>${s ? esc(age(d.idleMin)) + ' ago' : '—'}</td>
      <td class=r>${s ? s.sessions : 0}</td>
      <td>${wt || '<span class=m>empty</span>'}${d.worktop.length > 3 ? ` <span class=m>+${d.worktop.length - 3}</span>` : ''}</td>
    </tr>`
  }).join('\n')

  const brokenRows = (office.broken ?? []).map((b) =>
    `<tr><td colspan=9 class=bad>⛔ ${esc(b.desk)}: ${esc(b.why)}</td></tr>`).join('\n')

  const checkRows = (checks?.rows ?? []).map((r) => {
    const cls = r.applicable === false ? 'na' : r.code === 0 ? 'ok' : r.code === 7 ? 'unk' : 'bad'
    const tag = r.applicable === false ? '—' : r.code === 0 ? 'ok' : r.code === 7 ? '???' : '⛔'
    return `<tr><td class=${cls}>${tag}</td><td>${esc(r.name)}</td><td class=m>${esc(r.why)}</td></tr>`
  }).join('\n')

  return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="30">
<title>the office</title>
<style>
  body{font:14px/1.5 ui-monospace,monospace;max-width:1080px;margin:2rem auto;padding:0 1rem;background:#0d1117;color:#e6edf3}
  table{border-collapse:collapse;width:100%;margin:.75rem 0 2rem}
  td,th{padding:.3rem .6rem;border-bottom:1px solid #21262d;text-align:left;vertical-align:top}
  th{color:#8b949e;font-weight:normal}
  .m{color:#8b949e}.r{text-align:right;white-space:nowrap}
  .b{padding:.05rem .4rem;border-radius:4px;font-size:12px}
  .live{background:#238636;color:#fff}
  .ok{color:#3fb950}.bad{color:#f85149}.unk{color:#d29922}.na{color:#484f58}
  h1{font-size:1.2rem}h2{font-size:1rem;color:#8b949e}
</style>
<h1>🏢 the office <span class=m>· ${esc(office.root)}</span></h1>
<h2>${office.desks.length} desk(s) · read from desk.json, transcripts and scratchpads · never from self-report · refreshes every 30s</h2>
<table>
<tr><th>desk</th><th>kind</th><th></th><th>model (transcript)</th><th>turns</th><th>tokens</th><th>active</th><th>sessions</th><th>worktop</th></tr>
${brokenRows}${deskRows}
</table>
<h2>the checks</h2>
<table>${checkRows}</table>
<p class=m>Read-only. No database, no login, nothing stored. Close the tab and it never happened.</p>`
}
