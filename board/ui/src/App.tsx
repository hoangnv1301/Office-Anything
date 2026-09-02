// THE OFFICE, on AI Elements + shadcn/ui. This file is DATA WIRING ONLY:
// every visible widget is a registry component. The core stays Claude Code —
// /api reads desk.json, transcripts and scratchpads; this just shows them.
import { useCallback, useEffect, useState } from 'react'
import {
  Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning'
import { Tool, ToolHeader, ToolContent, ToolInput } from '@/components/ai-elements/tool'
import { FileTree, FileTreeFolder, FileTreeFile } from '@/components/ai-elements/file-tree'
import {
  PromptInput, PromptInputBody, PromptInputTextarea, PromptInputFooter, PromptInputSubmit,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

type Desk = { key: string; label: string; sub: string; activeMin: number | null }
type Msg = { role: 'user' | 'assistant'; text: string; tools?: { name: string; input: unknown }[]; reasoning?: string | null }
type WsNode = { dirs: Record<string, WsNode>; files: { name: string; size: number }[]; truncated?: boolean; shallow?: boolean }
type Pane = { label: string; model: string | null; count: number; messages: Msg[]; folder: { name: string; size: number; ageMin: number }[]; workspace?: WsNode | null }

const kb = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'
const age = (m: number) => (m < 60 ? `${m}m` : `${Math.round(m / 60)}h`) + ' ago'

function renderWs(n: WsNode, prefix: string): React.ReactNode {
  return (<>
    {Object.entries(n.dirs).map(([d, c]) => (
      <FileTreeFolder key={prefix + d} name={d} path={prefix + d}>{renderWs(c, prefix + d + '/')}</FileTreeFolder>
    ))}
    {n.files.map((f) => (
      <FileTreeFile key={prefix + f.name} name={f.name} path={prefix + f.name} title={kb(f.size)} />
    ))}
    {n.truncated && <div className="px-2 py-1 text-[10px] text-muted-foreground">…more, bounded on purpose</div>}
  </>)
}

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
              <div key={i}>
                {m.reasoning && (
                  <Reasoning className="mb-1" isStreaming={false} defaultOpen={false}>
                    <ReasoningTrigger />
                    <ReasoningContent>{m.reasoning}</ReasoningContent>
                  </Reasoning>
                )}
                {(m.text || m.role === 'user') && (
                  <Message from={m.role}>
                    <MessageContent><MessageResponse>{m.text}</MessageResponse></MessageContent>
                  </Message>
                )}
                {m.tools?.map((t, k) => (
                  <Tool key={k} className="my-1">
                    <ToolHeader type="dynamic-tool" state="output-available" toolName={t.name} />
                    <ToolContent><ToolInput input={t.input} /></ToolContent>
                  </Tool>
                ))}
              </div>
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

      <aside className="flex w-64 min-w-64 flex-col border-l bg-sidebar">
        <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">workspace</div>
        <Separator />
        <ScrollArea className="min-h-0 flex-1 px-2 py-2">
          {pane?.workspace
            ? <FileTree className="border-0 bg-transparent">{renderWs(pane.workspace, '')}</FileTree>
            : <div className="px-2 py-2 text-xs text-muted-foreground">…</div>}
        </ScrollArea>
        <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">session scratchpad</div>
        <Separator />
        <ScrollArea className="min-h-0 flex-1 px-2 py-2">
          {pane?.folder?.length
            ? <FileTree className="border-0 bg-transparent">
                {(() => {
                  type Node = { files: [string, { size: number; ageMin: number }][]; dirs: Record<string, Node> }
                  const root: Node = { files: [], dirs: {} }
                  for (const f of pane.folder) {
                    const parts = f.name.split('/')
                    let n = root
                    for (const d of parts.slice(0, -1)) n = (n.dirs[d] ??= { files: [], dirs: {} })
                    n.files.push([parts[parts.length - 1], f])
                  }
                  const renderNode = (n: Node, prefix: string): React.ReactNode => (<>
                    {Object.entries(n.dirs).map(([d, c]) => (
                      <FileTreeFolder key={prefix + d} name={d} path={prefix + d}>{renderNode(c, prefix + d + '/')}</FileTreeFolder>
                    ))}
                    {n.files.map(([name, f]) => (
                      <FileTreeFile key={prefix + name} path={prefix + name}
                        name={name} title={kb(f.size) + ' · ' + age(f.ageMin)} />
                    ))}
                  </>)
                  return renderNode(root, '')
                })()}
              </FileTree>
            : <div className="px-2 py-2 text-xs text-muted-foreground">empty — the scratchpad starts clean each session</div>}
        </ScrollArea>
      </aside>
    </div>
  )
}
