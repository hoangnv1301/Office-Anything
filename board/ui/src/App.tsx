// THE OFFICE. Data wiring over registry components, nothing hand-rolled:
// shadcn/ui (resizable, tabs, badge, button, scroll-area) + AI Elements
// (conversation, message, reasoning, tool, task, file-tree, image,
// prompt-input, web-preview). The core stays Claude Code.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning'
import { Tool, ToolHeader, ToolContent, ToolInput } from '@/components/ai-elements/tool'
import { Task, TaskTrigger, TaskContent } from '@/components/ai-elements/task'
import { FileTree, FileTreeFolder, FileTreeFile } from '@/components/ai-elements/file-tree'
import { Image as AIImage } from '@/components/ai-elements/image'
import {
  PromptInput, PromptInputBody, PromptInputTextarea, PromptInputFooter, PromptInputSubmit,
  PromptInputTools, PromptInputActionAddAttachments, PromptInputHeader,
  PromptInputActionMenu, PromptInputActionMenuTrigger, PromptInputActionMenuContent,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { WebPreview, WebPreviewNavigation, WebPreviewUrl, WebPreviewBody } from '@/components/ai-elements/web-preview'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Desk = { key: string; label: string; sub: string; activeMin: number | null }
type Img = { kind: 'b64'; mediaType: string; data: string } | { kind: 'path'; path: string } | { kind: 'marker'; label: string }
export type Msg = { role: 'user' | 'assistant' | 'system'; text: string; label?: string; tools?: { name: string; input: unknown }[]; images?: Img[]; reasoning?: string | null }
type WsNode = { dirs: Record<string, WsNode>; files: { name: string; size: number }[]; truncated?: boolean }
type Pane = { label: string; model: string | null; count: number; messages: Msg[]; folder: { name: string; size: number; ageMin: number }[]; workspace?: WsNode | null }
type CdpTab = { title: string; url: string; devtools: string }

const kb = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'
const age = (m: number) => (m < 60 ? `${m}m` : `${Math.round(m / 60)}h`) + ' ago'

const MsgBlock = memo(function MsgBlock({ m, rich }: { m: Msg; rich: boolean }) {
  if (m.role === 'system') {
    return (
      <Task defaultOpen={false} className="my-0.5 opacity-75">
        <TaskTrigger title={'⚑ ' + (m.label ?? 'system')} />
        <TaskContent><pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs">{m.text}</pre></TaskContent>
      </Task>
    )
  }
  return (
    <div>
      {m.reasoning && (
        <Reasoning className="mb-0.5" isStreaming={false} defaultOpen={false}>
          <ReasoningTrigger /><ReasoningContent>{m.reasoning}</ReasoningContent>
        </Reasoning>
      )}
      {(m.text || m.images?.length) && (
        <Message from={m.role}>
          <MessageContent>
            {m.text && (rich ? <MessageResponse>{m.text}</MessageResponse> : <span className="whitespace-pre-wrap break-words">{m.text}</span>)}
            <Pictures images={m.images} />
          </MessageContent>
        </Message>
      )}
    </div>
  )
}, (a, b) => a.m.text === b.m.text && a.rich === b.rich && a.m.reasoning === b.m.reasoning && (a.m.images?.length ?? 0) === (b.m.images?.length ?? 0))

const ToolsBlock = memo(function ToolsBlock({ tools }: { tools: { name: string; input: unknown }[] }) {
  return (
    <Task defaultOpen={false} className="my-0.5">
      <TaskTrigger title={'⚙ ' + tools.length + ' tool call' + (tools.length > 1 ? 's' : '') + ' — ' + [...new Set(tools.map((t) => t.name))].join(', ')} />
      <TaskContent>
        {tools.map((t, k) => (
          <Tool key={k} className="my-0.5">
            <ToolHeader type="dynamic-tool" state="output-available" toolName={t.name} />
            <ToolContent><ToolInput input={t.input} /></ToolContent>
          </Tool>
        ))}
      </TaskContent>
    </Task>
  )
}, (a, b) => a.tools.length === b.tools.length && a.tools[0]?.name === b.tools[0]?.name)

// ⛔ THE RAIL MUST NOT REBUILD BECAUSE THE CHAT MOVED. The lead's transcript
// grows every few seconds; every poll re-rendered the pane and the tree was
// torn down mid-click — the rig caught a click landing on a row that had just
// been replaced, and a human gets the same twitch under the cursor.
const WorkspaceTree = memo(function WorkspaceTree({ ws, onOpen }: { ws: WsNode; onOpen: (p: string) => void }) {
  return <FileTree className="border-0 bg-transparent" onSelect={onOpen}>{renderWs(ws, '')}</FileTree>
}, (a, b) => JSON.stringify(a.ws) === JSON.stringify(b.ws))

function renderWs(n: WsNode, prefix: string): React.ReactNode {
  return (<>
    {Object.entries(n.dirs).map(([d, c]) => (
      <FileTreeFolder key={prefix + d} name={d} path={prefix + d}>{renderWs(c, prefix + d + '/')}</FileTreeFolder>
    ))}
    {n.files.map((f) => <FileTreeFile key={prefix + f.name} name={f.name} path={prefix + f.name} title={kb(f.size)} />)}
    {n.truncated && <div className="px-2 py-1 text-[10px] text-muted-foreground">…bounded on purpose</div>}
  </>)
}

const Pictures = ({ images }: { images?: Img[] }) => !images?.length ? null : (
  <span className="mt-1 flex flex-wrap gap-2">
    {images.map((im, i) => im.kind === 'b64'
      ? <AIImage key={i} base64={im.data} uint8Array={new Uint8Array()} mediaType={im.mediaType} alt="pasted image" className="max-h-72" />
      : im.kind === 'path'
        ? <img key={i} src={'/api/imgfile?p=' + encodeURIComponent(im.path)} alt={im.path.split('/').pop()} className="h-auto max-h-72 max-w-full overflow-hidden rounded-md" />
        : <Badge key={i} variant="secondary" className="font-normal text-muted-foreground">🖼 {im.label}</Badge>)}
  </span>
)

// item 5: a run of tool calls folds into ONE Task, expandable to the full list
export type Block = { kind: 'msg'; m: Msg } | { kind: 'tools'; tools: { name: string; input: unknown }[] }
export function toBlocks(messages: Msg[]): Block[] {
  const out: Block[] = []
  for (const m of messages) {
    if (m.role === 'assistant' && m.reasoning) out.push({ kind: 'msg', m: { ...m, tools: [], text: '', images: [] } })
    if (m.text?.trim() || m.images?.length || m.role === 'user') out.push({ kind: 'msg', m: { ...m, reasoning: null, tools: [] } })
    if (m.tools?.length) {
      const last = out[out.length - 1]
      if (last?.kind === 'tools') last.tools.push(...m.tools)
      else out.push({ kind: 'tools', tools: [...m.tools] })
    }
  }
  return out
}

export default function App() {
  const [desks, setDesks] = useState<Desk[]>([])
  const [canSend, setCanSend] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [pane, setPane] = useState<Pane | null>(null)
  const [note, setNote] = useState('')
  const [commands, setCommands] = useState<string[]>([])
  const [screen, setScreen] = useState<{ src: string | null; url: string; why: string }>({ src: null, url: '', why: 'no browser to show for this desk yet' })
  const [showComputer, setShowComputer] = useState(false)
  const [file, setFile] = useState<{ path: string; kind: string; content?: string; size?: number } | null>(null)
  const [hireOpen, setHireOpen] = useState(false)
  const [hireWhy, setHireWhy] = useState('')
  const hireName = useRef<HTMLInputElement>(null)
  const hireDesc = useRef<HTMLInputElement>(null)
  const hireKind = useRef('channel')



  const openFile = useCallback(async (path: string) => {
    if (!sel) return
    const q = '/api/wsfile?key=' + encodeURIComponent(sel) + '&path=' + encodeURIComponent(path)
    const r = await fetch(q)
    const type = r.headers.get('content-type') ?? ''
    if (type.startsWith('image/')) { setFile({ path, kind: 'imageurl', content: q }); return }
    setFile({ path, ...(await r.json()) })
  }, [sel])

  const office = useCallback(async () => {
    const o = await (await fetch('/api/office-chat')).json()
    setDesks(o.desks); setCanSend(o.canSend)
    setSel((s) => s ?? o.desks[0]?.key ?? null)
  }, [])
  // ⛔ THIS WAS A PLAIN OBJECT, recreated every render, so the diff guard
  // never engaged and the re-parse froze the thread anyway. A ref survives.
  const lastPayload = useRef('')
  const poll = useCallback(async () => {
    if (!sel) return
    const text = await (await fetch('/api/transcript?key=' + encodeURIComponent(sel))).text()
    // ⛔ 80 markdown documents re-parsed every 2.5s froze the main thread for
    // seconds at a time. An unchanged payload must cost nothing.
    if (text === lastPayload.current) return
    lastPayload.current = text
    setPane(JSON.parse(text))
  }, [sel])

  // moved BELOW office/poll: referencing office above its const was a TDZ
  // crash the minifier renamed into "Cannot access 'O' before initialization"
  const doHire = useCallback(async () => {
    setHireWhy('')
    const r = await (await fetch('/api/hire', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: hireName.current?.value?.trim(), kind: hireKind.current, description: hireDesc.current?.value ?? '' }),
    })).json()
    if (r?.ok === false) { setHireWhy(r.why); return }   // the refusal IS the product; show it verbatim
    setHireOpen(false); office()
  }, [office])
  useEffect(() => { office(); const t = setInterval(office, 10000); return () => clearInterval(t) }, [office])
  useEffect(() => { poll(); const t = setInterval(poll, 2500); return () => clearInterval(t) }, [poll])
  useEffect(() => { fetch('/api/commands').then((r) => r.json()).then((j) => setCommands(j.commands ?? [])) }, [])
  useEffect(() => {
    if (!sel || !showComputer) return
    let alive = true
    const go = async () => {
      const r = await fetch('/api/screen?key=' + encodeURIComponent(sel))
      if (!alive) return
      if (r.status !== 200) { setScreen({ src: null, url: '', why: 'no headed browser answering for this desk right now' }); return }
      const blob = await r.blob()
      if (!alive) return
      setScreen((old) => { if (old.src) URL.revokeObjectURL(old.src); return { src: URL.createObjectURL(blob), url: decodeURIComponent(r.headers.get('x-tab-url') ?? ''), why: '' } })
    }
    go(); const t = setInterval(go, 1200); return () => { alive = false; clearInterval(t) }
  }, [sel, showComputer])

  const blocks = useMemo(() => toBlocks(pane?.messages ?? []), [pane])

  const deskList = desks.map((d) => (
    <Button key={d.key} variant={sel === d.key ? 'secondary' : 'ghost'} onClick={() => setSel(d.key)}
      className="h-auto w-full justify-start rounded-none px-4 py-2.5">
      <span className="flex w-full flex-col items-start gap-0.5 overflow-hidden">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className={'size-2 rounded-full ' + (d.activeMin != null && d.activeMin < 10 ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />
          {d.label}
          {d.sub.includes('LIVE') && <Badge className="h-4 px-1.5 text-[10px]">LIVE</Badge>}
        </span>
        <span className="w-full truncate pl-4 text-left text-xs font-normal text-muted-foreground">{d.sub.replace(' · LIVE', '')}</span>
      </span>
    </Button>
  ))

  // shell-style history: ArrowUp in an EMPTY box recalls, per desk, surviving
  // reloads via localStorage. Not full CLI parity — that is written down as
  // remaining work, not implied away.
  const histIdx = useRef(-1)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const ta = e.target as HTMLTextAreaElement
      if (ta?.tagName !== 'TEXTAREA' || !sel) return
      let hist: string[] = []
      try { hist = JSON.parse(localStorage.getItem('office-hist-' + sel) ?? '[]') } catch { hist = [] }
      if (e.key === 'ArrowUp' && (ta.value === '' || histIdx.current >= 0)) {
        if (!hist.length) return
        histIdx.current = Math.min(histIdx.current + 1, hist.length - 1)
        ta.value = hist[hist.length - 1 - histIdx.current]
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        e.preventDefault()
      } else if (e.key === 'ArrowDown' && histIdx.current >= 0) {
        histIdx.current -= 1
        ta.value = histIdx.current >= 0 ? hist[hist.length - 1 - histIdx.current] : ''
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        e.preventDefault()
      } else if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') histIdx.current = -1
    }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [sel])

  const onSubmit = useCallback(async (m: PromptInputMessage, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSend || !sel) return
    let text = m.text?.trim() ?? ''
    // attachments land in the desk's own scratchpad; the terminal gets the path,
    // exactly as a paste into the CLI would
    for (const f of m.files ?? []) {
      const r = await (await fetch('/api/upload', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: sel, name: f.filename ?? 'file', data: f.url }),
      })).json()
      if (r.ok) text += (text ? '\n' : '') + r.path
      else setNote('⛔ ' + r.why)
    }
    if (!text) return
    const r = await (await fetch('/api/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: sel, text }),
    })).json()
    setNote(r.ok ? '' : '⛔ ' + r.why)
    if (r.ok) {
      try {
        const k = 'office-hist-' + sel
        const hist = JSON.parse(localStorage.getItem(k) ?? '[]')
        hist.push(text); localStorage.setItem(k, JSON.stringify(hist.slice(-50)))
      } catch { /* history is a convenience, never a failure */ }
      histIdx.current = -1
      setTimeout(poll, 800)
    }
  }, [canSend, sel, poll])

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-screen bg-background text-foreground">
      {/* item 3+7: panes told apart by TONE, resizable with bounds */}
      <ResizablePanel defaultSize="18%" minSize="12%" maxSize="28%" className="hidden bg-sidebar md:block">
        <div className="flex h-full flex-col">
          <div className="px-4 py-3 font-semibold">🏢 the office</div>
          <ScrollArea className="min-h-0 flex-1">{deskList}</ScrollArea>
        </div>
      </ResizablePanel>
      <ResizableHandle className="hidden w-0 bg-transparent md:block" />

      <ResizablePanel defaultSize="60%" minSize="40%">
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-2 px-4 py-2 md:px-6">
            <Sheet>
              <SheetTrigger render={<Button variant="ghost" size="sm" className="md:hidden">☰</Button>} />
              <SheetContent side="left" className="w-72 p-0">
                <SheetTitle className="px-4 py-3 text-base">🏢 the office</SheetTitle>
                <ScrollArea className="h-full">{deskList}</ScrollArea>
              </SheetContent>
            </Sheet>
            <span className="min-w-0 truncate whitespace-nowrap font-semibold">{pane?.label ?? '…'}</span>
            {pane?.model && <Badge variant="secondary" className="hidden whitespace-nowrap text-[11px] sm:inline-flex">{pane.model}</Badge>}
            <span className="hidden whitespace-nowrap text-xs text-muted-foreground md:inline">{pane ? pane.count + ' messages' : ''}</span>
            <Button variant={showComputer ? 'secondary' : 'ghost'} size="sm" className="ml-auto h-8 text-xs"
              onClick={() => setShowComputer(v => !v)}>🖥 Computer</Button>
          </header>

          {/* ⛔ SIDE BY SIDE, owner's ruling: the mirror opens NEXT TO the
              conversation, resizable, never instead of it. */}
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={showComputer ? '55%' : '100%'} minSize="30%" className="flex min-h-0 flex-col">
            <Conversation className="flex-1">
              <ConversationContent className="mx-auto w-full max-w-3xl gap-2">
                {blocks.length === 0 && <ConversationEmptyState title="Nothing yet" description="This desk has no conversation in its current session." />}
                {(() => { const tail = blocks.slice(-60); return tail.map((b, i) => b.kind === 'msg'
                  ? <MsgBlock key={'m' + i} m={b.m} rich={i >= tail.length - 15} />
                  : <ToolsBlock key={'t' + i} tools={b.tools} />) })()}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            {note && <div className="px-6 pb-1 text-xs text-destructive">{note}</div>}
            <div className="mx-auto w-full max-w-3xl px-4 pb-4">
              <PromptInput onSubmit={onSubmit} accept="image/*" multiple globalDrop>
                <PromptInputBody>
                  <PromptInputHeader />
                  <PromptInputTextarea placeholder={canSend ? "Message this desk's live terminal — / for commands, drop images anywhere" : 'Read-only on this host (no orca CLI)'} disabled={!canSend} />
                </PromptInputBody>
                <PromptInputFooter>
                  <PromptInputTools>
                    <PromptInputActionMenu>
                      <PromptInputActionMenuTrigger />
                      <PromptInputActionMenuContent>
                        <PromptInputActionAddAttachments />
                      </PromptInputActionMenuContent>
                    </PromptInputActionMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-8 text-xs">/ commands</Button>} />
                      <DropdownMenuContent className="max-h-72 overflow-y-auto">
                        {commands.map((c) => (
                          <DropdownMenuItem key={c} onSelect={() => {
                            const ta = document.querySelector('textarea'); if (ta) { ta.value = c + ' '; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus() }
                          }}>{c}</DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </PromptInputTools>
                  <PromptInputSubmit disabled={!canSend} />
                </PromptInputFooter>
              </PromptInput>
            </div>
          </ResizablePanel>
          {showComputer && <ResizableHandle className="w-0 bg-transparent" />}
          {showComputer && (
          <ResizablePanel defaultSize="45%" minSize="25%" className="flex min-h-0 flex-col bg-black/20">
            {screen.src ? (
              <WebPreview className="min-h-0 flex-1">
                <WebPreviewNavigation>
                  <WebPreviewUrl readOnly value={screen.url} />
                  <span className="text-[11px] text-muted-foreground">display only · ~1 fps</span>
                </WebPreviewNavigation>
                {/* ⛔ WebPreviewBody IS an iframe; handing it a render prop
                    left an empty frame where the mirror belonged while the
                    screen endpoint served frames nobody displayed. The nav is
                    the element's; the pixels get a plain container. */}
                <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-black/40 p-2">
                  <img src={screen.src} alt="desk browser display" className="h-auto max-w-full rounded-md" />
                </div>
              </WebPreview>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">{screen.why}</div>
            )}
          </ResizablePanel>
          )}
          </ResizablePanelGroup>
        </div>
      </ResizablePanel>
      <ResizableHandle className="hidden w-0 bg-transparent md:block" />

      {/* item 4: one rail, a menu to switch what it shows */}
      <ResizablePanel data-rail="files" defaultSize="22%" minSize="14%" maxSize="34%" className="hidden bg-card md:block">
        <Tabs defaultValue="workspace" className="flex h-full flex-col gap-0">
          <TabsList className="m-2">
            <TabsTrigger value="workspace" className="text-xs">workspace</TabsTrigger>
            <TabsTrigger value="scratchpad" className="text-xs">scratchpad</TabsTrigger>
          </TabsList>
          <TabsContent value="workspace" className="min-h-0 flex-1 data-[state=inactive]:hidden">
            <ScrollArea className="h-full px-2 pb-2">
              {pane?.workspace
                ? <WorkspaceTree ws={pane.workspace} onOpen={openFile} />
                : <div className="px-2 py-2 text-xs text-muted-foreground">…</div>}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="scratchpad" className="min-h-0 flex-1 data-[state=inactive]:hidden">
            <ScrollArea className="h-full px-2 pb-2">
              {pane?.folder?.length
                ? <FileTree className="border-0 bg-transparent">
                    {pane.folder.map((f) => <FileTreeFile key={f.name} name={f.name} path={f.name} title={kb(f.size) + ' · ' + age(f.ageMin)} />)}
                  </FileTree>
                : <div className="px-2 py-2 text-xs text-muted-foreground">empty — the scratchpad starts clean each session</div>}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </ResizablePanel>
      <Dialog open={hireOpen} onOpenChange={setHireOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Hire a desk</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3">
            <Input ref={hireName} placeholder="name — lowercase-with-hyphens, e.g. tiktok-customer-service" />
            <Input ref={hireDesc} placeholder="what this desk does, in one sentence" />
            <Select defaultValue="channel" onValueChange={(v) => { hireKind.current = v }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="channel">channel — talks to people on one channel</SelectItem>
                <SelectItem value="knowledge">knowledge — holds facts, can never send</SelectItem>
              </SelectContent>
            </Select>
            {hireWhy && <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">⛔ {hireWhy}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setHireOpen(false)}>Cancel</Button>
              <Button onClick={doHire}>Hire</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Two readers must agree on the kind — you, and the contract's own reading of the description. A disagreement is refused with the reason, and that refusal is the point.</p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!file} onOpenChange={(o) => !o && setFile(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader><DialogTitle className="truncate font-mono text-sm">{file?.path}</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[70vh] min-h-0 flex-1 overflow-auto">
            {file?.kind === 'imageurl' && <img src={file.content} alt={file.path} className="h-auto max-w-full rounded-md" />}
            {file?.kind === 'markdown' && <MessageResponse>{file.content ?? ''}</MessageResponse>}
            {file?.kind === 'text' && <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{file.content}</pre>}
            {(file?.kind === 'binary' || file?.kind === 'big') && <div className="p-4 text-sm text-muted-foreground">{file.kind === 'big' ? 'Too large to open here' : 'Binary file'} ({kb(file.size ?? 0)})</div>}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </ResizablePanelGroup>
  )
}
