// THE OFFICE, on AI Elements + shadcn/ui. This file is DATA WIRING ONLY:
// every visible widget is a registry component. The core stays Claude Code —
// /api reads desk.json, transcripts and scratchpads; this just shows them.
import { useCallback, useEffect, useState } from 'react'
import {
  Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent } from '@/components/ai-elements/message'
import {
  PromptInput, PromptInputBody, PromptInputTextarea, PromptInputFooter, PromptInputSubmit,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

type Desk = { key: string; label: string; sub: string; activeMin: number | null }
type Msg = { role: 'user' | 'assistant'; text: string; tools?: string[] }
type Pane = { label: string; model: string | null; count: number; messages: Msg[]; folder: { name: string; size: number; ageMin: number }[] }

const kb = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'
const age = (m: number) => (m < 60 ? `${m}m` : `${Math.round(m / 60)}h`) + ' ago'

export default function App() {
  const [desks, setDesks] = useState<Desk[]>([])
  const [canSend, setCanSend] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [pane, setPane] = useState<Pane | null>(null)
  const [note, setNote] = useState('')

  const office = useCallback(async () => {
    const o = await (await fetch('/api/office-chat')).json()
    setDesks(o.desks); setCanSend(o.canSend)
    setSel((s) => s ?? o.desks[0]?.key ?? null)
  }, [])

  const poll = useCallback(async () => {
    if (!sel) return
    setPane(await (await fetch('/api/transcript?key=' + encodeURIComponent(sel))).json())
  }, [sel])

  useEffect(() => { office(); const t = setInterval(office, 10000); return () => clearInterval(t) }, [office])
  useEffect(() => { poll(); const t = setInterval(poll, 2500); return () => clearInterval(t) }, [poll])

  const onSubmit = useCallback(async (m: PromptInputMessage, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const text = m.text?.trim()
    if (!text || !canSend || !sel) return
    const r = await (await fetch('/api/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: sel, text }),
    })).json()
    setNote(r.ok ? '' : '⛔ ' + r.why)
    if (r.ok) setTimeout(poll, 800)
  }, [canSend, sel, poll])

  return (
    <div className="dark flex h-screen bg-background text-foreground">
      <aside className="flex w-72 min-w-72 flex-col border-r bg-sidebar">
        <div className="px-4 py-3 font-semibold">🏢 the office</div>
        <Separator />
        <ScrollArea className="flex-1">
          {desks.map((d) => (
            <button key={d.key} onClick={() => setSel(d.key)}
              className={'flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-accent ' + (sel === d.key ? 'bg-accent' : '')}>
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className={'size-2 rounded-full ' + (d.activeMin != null && d.activeMin < 10 ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />
                {d.label}
                {d.sub.includes('LIVE') && <Badge className="h-4 px-1.5 text-[10px]">LIVE</Badge>}
              </span>
              <span className="truncate pl-4 text-xs text-muted-foreground">{d.sub.replace(' · LIVE', '')}</span>
            </button>
          ))}
        </ScrollArea>
        <Separator />
        <a href="/board" className="px-4 py-2.5 text-xs text-muted-foreground hover:underline">table view · checks →</a>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-baseline gap-2 border-b px-6 py-3">
          <span className="font-semibold">{pane?.label ?? '…'}</span>
          {pane?.model && <Badge variant="secondary" className="text-[11px]">{pane.model}</Badge>}
          <span className="text-xs text-muted-foreground">{pane ? pane.count + ' messages' : ''}</span>
        </header>

        <Conversation className="flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl">
            {(!pane || pane.messages.length === 0) && (
              <ConversationEmptyState title="Nothing yet" description="This desk has no conversation in its current session." />
            )}
            {pane?.messages.map((m, i) => (
              <Message from={m.role} key={i}>
                <MessageContent>
                  <span className="whitespace-pre-wrap break-words">{m.text}</span>
                  {m.tools && m.tools.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {m.tools.map((t, k) => <Badge key={k} variant="outline" className="text-[10px] font-normal text-muted-foreground">⚙ {t}</Badge>)}
                    </span>
                  )}
                </MessageContent>
              </Message>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {note && <div className="px-6 pb-1 text-xs text-destructive">{note}</div>}
        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          <PromptInput onSubmit={onSubmit}>
            <PromptInputBody>
              <PromptInputTextarea placeholder={canSend ? "Type into this desk's live terminal…" : 'Read-only on this host (no orca CLI)'} disabled={!canSend} />
            </PromptInputBody>
            <PromptInputFooter>
              <span className="text-[11px] text-muted-foreground">{canSend ? 'sends with Enter, straight into the live terminal' : ''}</span>
              <PromptInputSubmit disabled={!canSend} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </main>

      <aside className="w-64 min-w-64 border-l bg-sidebar">
        <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">session folder</div>
        <Separator />
        <ScrollArea className="h-full px-4 py-2">
          {pane?.folder?.length
            ? pane.folder.map((f, i) => (
              <div key={i} className="py-1.5">
                <div className="truncate text-[13px]" title={f.name}>{f.name}</div>
                <div className="text-[11px] text-muted-foreground">{kb(f.size)} · {age(f.ageMin)}</div>
              </div>
            ))
            : <div className="py-2 text-xs text-muted-foreground">empty — the scratchpad starts clean each session</div>}
        </ScrollArea>
      </aside>
    </div>
  )
}
