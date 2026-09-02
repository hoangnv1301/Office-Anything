// THE CHAT PAGE. shadcn's visual language (zinc tokens, soft borders, rounded
// cards) in plain CSS: no build step, no framework, one request. All data
// arrives from /api/* after load; this file is the shell.
export function chatPage() {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>the office · chat</title>
<style>
  :root{--bg:#09090b;--panel:#18181b;--border:#27272a;--fg:#fafafa;--muted:#a1a1aa;--accent:#22c55e;--user:#2563eb}
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.55 -apple-system,'Segoe UI',Inter,sans-serif;background:var(--bg);color:var(--fg);height:100vh;display:flex}
  aside{width:270px;min-width:270px;border-right:1px solid var(--border);background:var(--panel);display:flex;flex-direction:column}
  aside h1{font-size:14px;margin:0;padding:16px;border-bottom:1px solid var(--border)}
  #desks{overflow-y:auto;flex:1}
  .desk{padding:10px 16px;cursor:pointer;border-left:2px solid transparent;display:flex;gap:8px;align-items:center}
  .desk:hover{background:#1f1f23}
  .desk.sel{background:#1f1f23;border-left-color:var(--accent)}
  .dot{width:8px;height:8px;border-radius:50%;background:#3f3f46;flex:none}
  .dot.on{background:var(--accent)}
  .dname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dsub{font-size:11px;color:var(--muted)}
  main{flex:1;display:flex;flex-direction:column;min-width:0}
  header{padding:12px 20px;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:baseline}
  header .t{font-weight:600}
  header .s{font-size:12px;color:var(--muted)}
  #log{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px}
  .msg{max-width:76%;padding:10px 14px;border-radius:12px;white-space:pre-wrap;word-break:break-word;border:1px solid var(--border)}
  .msg.user{align-self:flex-end;background:var(--user);border-color:transparent}
  .msg.assistant{align-self:flex-start;background:var(--panel)}
  .meta{font-size:11px;color:var(--muted);margin-top:6px}
  .chip{display:inline-block;font-size:11px;background:#27272a;border:1px solid var(--border);border-radius:999px;padding:1px 8px;margin:2px 4px 0 0;color:var(--muted)}
  form{display:flex;gap:8px;padding:14px 20px;border-top:1px solid var(--border)}
  textarea{flex:1;resize:none;background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font:inherit;height:44px}
  button{background:var(--fg);color:var(--bg);border:0;border-radius:10px;padding:0 18px;font-weight:600;cursor:pointer}
  button:disabled{opacity:.4;cursor:not-allowed}
  #note{font-size:12px;color:var(--muted);padding:0 20px 10px}
  a{color:var(--muted)}
</style>
<aside>
  <h1>🏢 the office</h1>
  <div id="desks"></div>
  <div style="padding:12px 16px;border-top:1px solid var(--border)"><a href="/">← the board</a></div>
</aside>
<main>
  <header><span class="t" id="title">…</span><span class="s" id="sub"></span></header>
  <div id="log"></div>
  <div id="note"></div>
  <form id="f"><textarea id="box" placeholder="Type into this desk's live terminal…"></textarea><button id="go">Send</button></form>
</main>
<script>
const $=(q)=>document.querySelector(q)
let sel=null, sending=false, canSend=false
const esc=(s)=>String(s??'').replace(/[&<>]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
async function office(){
  const o=await (await fetch('/api/office-chat')).json()
  canSend=o.canSend
  $('#note').textContent=o.canSend?'Send types into the desk\\'s LIVE terminal via orca, with Enter. Treat it like walking to their desk.':'Read-only on this host: no orca CLI, so there is no way to type into a terminal.'
  $('#go').disabled=!o.canSend
  const list=$('#desks'); list.innerHTML=''
  for(const d of o.desks){
    const el=document.createElement('div')
    el.className='desk'+(sel===d.key?' sel':'')
    el.innerHTML='<span class="dot'+(d.activeMin!=null&&d.activeMin<10?' on':'')+'"></span><span><div class="dname">'+esc(d.label)+'</div><div class="dsub">'+esc(d.sub)+'</div></span>'
    el.onclick=()=>{sel=d.key;office();poll(true)}
    list.appendChild(el)
  }
  if(!sel&&o.desks.length){sel=o.desks[0].key;office();poll(true)}
}
async function poll(scroll){
  if(!sel)return
  const t=await (await fetch('/api/transcript?key='+encodeURIComponent(sel))).json()
  $('#title').textContent=t.label
  $('#sub').textContent=t.model?t.model+' · '+t.count+' messages shown':'no session yet'
  const log=$('#log'); const stick=scroll||log.scrollTop+log.clientHeight>=log.scrollHeight-80
  log.innerHTML=t.messages.map(m=>'<div class="msg '+m.role+'">'+esc(m.text)+(m.tools&&m.tools.length?'<div>'+m.tools.map(x=>'<span class="chip">'+esc(x)+'</span>').join('')+'</div>':'')+(m.at?'<div class="meta">'+new Date(m.at).toLocaleTimeString()+'</div>':'')+'</div>').join('')
  if(stick)log.scrollTop=log.scrollHeight
}
$('#f').onsubmit=async(e)=>{
  e.preventDefault()
  if(sending||!canSend)return
  const text=$('#box').value.trim(); if(!text)return
  sending=true;$('#go').disabled=true
  const r=await (await fetch('/api/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:sel,text})})).json()
  sending=false;$('#go').disabled=!canSend
  if(r.ok){$('#box').value='';setTimeout(()=>poll(true),800)}else{$('#note').textContent='⛔ '+r.why}
}
office();setInterval(office,10000);setInterval(()=>poll(false),2500)
</script>`
}
