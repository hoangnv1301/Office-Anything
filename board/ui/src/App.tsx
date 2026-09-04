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
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Task, TaskTrigger, TaskContent } from '@/components/ai-elements/task'
import { FileTree, FileTreeFolder, FileTreeFile } from '@/components/ai-elements/file-tree'
import { Image as AIImage } from '@/components/ai-elements/image'
import {
  PromptInput, PromptInputBody, PromptInputTextarea, PromptInputFooter, PromptInputSubmit,
  PromptInputTools, PromptInputActionAddAttachments, PromptInputHeader,
  PromptInputActionMenu, PromptInputActionMenuTrigger, PromptInputActionMenuContent,
  usePromptInputAttachments,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { WebPreview, WebPreviewNavigation, WebPreviewUrl, WebPreviewBody } from '@/components/ai-elements/web-preview'
import { Building2, Monitor, Plus, Menu, ImageIcon, Flag, DollarSign, CircleHelp, Users, Clock, ArrowUpCircle, Wrench, CornerDownRight, HeartPulse, ChevronDown, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { QueueList, QueueItem, QueueItemIndicator, QueueItemContent, QueueItemDescription } from '@/components/ai-elements/queue'
import { Context, ContextTrigger, ContextContent, ContextContentHeader, ContextContentBody, ContextContentFooter, ContextInputUsage, ContextOutputUsage, ContextCacheUsage } from '@/components/ai-elements/context'
import { Confirmation, ConfirmationTitle, ConfirmationRequest, ConfirmationActions, ConfirmationAction } from '@/components/ai-elements/confirmation'
import { Sources, SourcesTrigger, SourcesContent, Source } from '@/components/ai-elements/sources'

type Desk = { key: string; label: string; sub: string; activeMin: number | null; online?: boolean | null; busy?: boolean | null; status?: string | null; waiting?: boolean; agents?: { kind?: string; label: string; activeMin: number; turns: number }[]; jobs?: { id: string; ageSec: number; size: number; label?: string }[] }
type Img = { kind: 'b64'; mediaType: string; data: string } | { kind: 'path'; path: string } | { kind: 'marker'; label: string }
export type Msg = { role: 'user' | 'assistant' | 'system' | 'peer'; from?: string; text: string; label?: string; tools?: ToolRow[]; images?: Img[]; reasoning?: string | null }
type WsNode = { dirs: Record<string, WsNode>; files: { name: string; size: number }[]; truncated?: boolean }
type Usage = { turns: number; input: number; output: number; cacheRead: number; cacheWrite: number; model: string | null; sessions?: number; ctxUsed?: number; ctxMax?: number; cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; asOf: string } | null }
type PendingAsk = { type: 'question'; questions: { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string }[] }[] } | { type: 'plan'; plan: string }
type Pane = { label: string; model: string | null; count: number; messages: Msg[]; folder: { name: string; size: number; ageMin: number }[]; workspace?: WsNode | null; usage?: Usage | null; turn?: { elapsedSec: number | null; output: number } | null; mode?: string | null; pending?: PendingAsk | null }
type CdpTab = { title: string; url: string; devtools: string }

// a stable accent per desk, hashed from the NAME so it is identical across
// sessions, machines and reloads with nothing to configure. One hue, used
// wherever a desk appears: its dot, its header, its bubble, its send fold.
const deskHue = (name: string) => {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}
const deskColor = (name: string) => `oklch(0.72 0.15 ${deskHue(name)})`

// a small playful shape per desk, colour AND form both hashed from the name,
// so each desk is recognizable at a glance without reading it. Five organic
// border-radius blobs; the initial rides on top.
const BLOBS = [
  '42% 58% 63% 37% / 41% 44% 56% 59%',
  '63% 37% 54% 46% / 55% 48% 52% 45%',
  '50% 50% 33% 67% / 55% 60% 40% 45%',
  '38% 62% 47% 53% / 63% 37% 63% 37%',
  '58% 42% 38% 62% / 45% 63% 37% 55%',
]
function DeskAvatar({ name, busy, size = 20 }: { name: string; busy?: boolean | null; size?: number }) {
  const blob = BLOBS[deskHue(name) % BLOBS.length]
  return (
    <span className={'flex flex-none items-center justify-center font-semibold text-black ' + (busy ? 'animate-pulse' : '')}
      style={{ width: size, height: size, borderRadius: blob, background: deskColor(name), fontSize: size * 0.5 }}>
      {name[0]?.toUpperCase() ?? '?'}
    </span>
  )
}

const kb = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'
const age = (m: number) => (m < 60 ? `${m}m` : `${Math.round(m / 60)}h`) + ' ago'

const MsgBlock = memo(function MsgBlock({ m, rich }: { m: Msg; rich: boolean }) {
  if (m.role === 'system') {
    const isErr = /error/i.test(m.label ?? '')
    return (
      <Task defaultOpen={false} className={'my-0.5 ' + (isErr ? 'rounded-md border-l-2 border-red-500 bg-red-950/20 py-0.5 pl-2 [&_p]:text-red-400' : 'opacity-75')}>
        <TaskTrigger title={(isErr ? '⛔ ' : '⚑ ') + (m.label ?? 'system')} icon={<Flag className={'size-3.5 ' + (isErr ? 'text-red-400' : '')} />} />
        <TaskContent><pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs">{m.text}</pre></TaskContent>
      </Task>
    )
  }
  if (m.role === 'peer') {
    // a message from another desk reads like a message from a colleague:
    // attributed, left-aligned, no envelope, no harness boilerplate
    return (
      <div className="max-w-[85%]">
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: deskColor(m.from ?? '') }}><DeskAvatar name={m.from ?? '?'} size={16} /> from {m.from}</div>
        <Message from="assistant">
          <MessageContent className="rounded-lg border-l-2 bg-muted/40 px-3 py-2" style={{ borderColor: deskColor(m.from ?? '') }}>
            {rich ? <MessageResponse>{m.text}</MessageResponse> : <span className="whitespace-pre-wrap break-words">{m.text}</span>}
          </MessageContent>
        </Message>
      </div>
    )
  }
  return (
    <div>
      {m.reasoning && (
        <Reasoning className="mb-0.5" isStreaming={false} defaultOpen={false}>
          <ReasoningTrigger /><ReasoningContent>{m.reasoning}</ReasoningContent>
        </Reasoning>
      )}
      {/* ⛔ boolean, not number: `text || images?.length` leaked a literal
          0 into the chat for every empty-text, empty-images turn */}
      {(m.text !== '' || (m.images?.length ?? 0) > 0) && (
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

type ToolRow = { name: string; input: unknown; output?: string | null; isError?: boolean }

// a dropped or picked file was landing in context with NO chip on screen, so
// the composer looked like it swallowed the image. The hook is the component's
// own; only the chips are ours.
function AttachChips() {
  const a = usePromptInputAttachments()
  if (!a.files.length) return null
  return (<>
    {a.files.map((f) => (
      <Badge key={f.id} variant="secondary" className="gap-1 font-normal">
        <ImageIcon className="size-3" />{f.filename ?? 'image'}
        <button type="button" className="ml-0.5 opacity-70 hover:opacity-100" title="remove" onClick={() => a.remove(f.id)}>×</button>
      </Badge>
    ))}
  </>)
}

// an Edit is a diff and should read as one: what left in red, what arrived
// in green. Write shows the new content in green. Everything else keeps the
// registry's ToolInput JSON view.
const EditDiff = ({ input }: { input: Record<string, unknown> }) => (
  <div className="space-y-1 p-2 text-xs">
    {typeof input.file_path === 'string' && <div className="font-mono text-muted-foreground">{input.file_path}</div>}
    {typeof input.old_string === 'string' && (
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border-l-2 border-red-500 bg-red-950/30 p-2 text-red-200">{input.old_string.slice(0, 1500)}</pre>
    )}
    {typeof input.new_string === 'string' && (
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border-l-2 border-emerald-500 bg-emerald-950/30 p-2 text-emerald-200">{input.new_string.slice(0, 1500)}</pre>
    )}
    {typeof input.content === 'string' && (
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border-l-2 border-emerald-500 bg-emerald-950/30 p-2 text-emerald-200">{input.content.slice(0, 1500)}</pre>
    )}
  </div>
)

const ToolsBlock = memo(function ToolsBlock({ tools }: { tools: ToolRow[] }) {
  const failed = tools.filter((t) => t.isError).length
  return (
    <Task defaultOpen={false} className="my-0.5">
      <TaskTrigger title="tools">
        <div className="flex w-full cursor-pointer items-center justify-start gap-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
          <Wrench className="size-3.5 flex-none" />
          <span className="text-left">{tools.length + ' tool call' + (tools.length > 1 ? 's' : '') + ' — ' + [...new Set(tools.map((t) => {
            const to = t.name === 'SendMessage' && typeof t.input === 'object' && t.input !== null ? (t.input as Record<string, unknown>).to : null
            return typeof to === 'string' ? 'SendMessage → ' + to : t.name
          }))].join(', ')}</span>
          {failed > 0 && <Badge variant="destructive" className="h-4 gap-1 px-1.5 text-[10px]"><XCircle className="size-3" />{failed} failed</Badge>}
          <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
        </div>
      </TaskTrigger>
      <TaskContent>
        {tools.map((t, k) => {
          const isDiff = (t.name === 'Edit' || t.name === 'Write') && typeof t.input === 'object' && t.input !== null
          return (
            <Tool key={k} className="my-0.5">
              <ToolHeader type="dynamic-tool" state={t.isError ? 'output-error' : t.output ? 'output-available' : 'input-available'} toolName={t.name} />
              <ToolContent>
                {isDiff ? <EditDiff input={t.input as Record<string, unknown>} /> : <ToolInput input={t.input} />}
                {(t.name === 'WebSearch' || t.name === 'WebFetch') && t.output && (() => {
                  const urls = [...new Set((t.output.match(/https?:\/\/[^\s)\]"'<>]+/g) ?? []))].slice(0, 12)
                  return urls.length ? (
                    <Sources className="px-2 pb-1">
                      <SourcesTrigger count={urls.length} />
                      <SourcesContent>{urls.map((u) => <Source key={u} href={u} title={u.replace(/^https?:\/\//, '').slice(0, 80)} />)}</SourcesContent>
                    </Sources>
                  ) : null
                })()}
                <ToolOutput output={t.isError ? undefined : (t.output || undefined)} errorText={t.isError ? (t.output || 'failed') : undefined} />
              </ToolContent>
            </Tool>
          )
        })}
      </TaskContent>
    </Task>
  )
}, (a, b) => a.tools.length === b.tools.length && a.tools[0]?.name === b.tools[0]?.name
  && a.tools.map((t) => (t.output ? 1 : 0) + (t.isError ? 2 : 0)).join() === b.tools.map((t) => (t.output ? 1 : 0) + (t.isError ? 2 : 0)).join())

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
    {n.truncated && <div className="px-2 py-1 text-[10px] text-muted-foreground">… more files not shown — the tree lists the first 500</div>}
  </>)
}

const Pictures = ({ images }: { images?: Img[] }) => !images?.length ? null : (
  <span className="mt-1 flex flex-wrap gap-2">
    {/* click = the full-size image in its own tab, URL and all */}
    {images.map((im, i) => im.kind === 'b64'
      ? <button key={i} type="button" title="open full size" onClick={() => window.dispatchEvent(new CustomEvent('office-lightbox', { detail: { src: 'data:' + im.mediaType + ';base64,' + im.data, name: 'image' } }))}>
          <AIImage base64={im.data} uint8Array={new Uint8Array()} mediaType={im.mediaType} alt="pasted image" className="max-h-72 cursor-zoom-in" /></button>
      : im.kind === 'path'
        ? <button key={i} type="button" title="open full size" onClick={() => window.dispatchEvent(new CustomEvent('office-lightbox', { detail: { src: 'api/imgfile?p=' + encodeURIComponent(im.path), name: im.path.split('/').pop() } }))}>
            <img src={'api/imgfile?p=' + encodeURIComponent(im.path)} alt={im.path.split('/').pop()} className="h-auto max-h-72 max-w-full cursor-zoom-in overflow-hidden rounded-md" /></button>
        : <Badge key={i} variant="secondary" className="gap-1 font-normal text-muted-foreground"><ImageIcon className="size-3" /> {im.label}</Badge>)}
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
  const [commands, setCommands] = useState<{ name: string; desc: string }[]>([])
  const commandsRef = useRef<{ name: string; desc: string }[]>([])
  useEffect(() => { commandsRef.current = commands }, [commands])
  const [screen, setScreen] = useState<{ src: string | null; url: string; why: string }>({ src: null, url: '', why: 'Computer is off — no browser running for this desk' })
  const [showComputer, setShowComputer] = useState(false)
  const [file, setFile] = useState<{ path: string; kind: string; content?: string; size?: number } | null>(null)
  const [hireOpen, setHireOpen] = useState(false)
  // the phone drawer is CONTROLLED so choosing anything inside it dismisses
  // it — a drawer that stays over the thing you just chose is a wall
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; setFile({ path: d.name ?? 'image', kind: 'imageurl', content: d.src }) }
    window.addEventListener('office-lightbox', h)
    return () => window.removeEventListener('office-lightbox', h)
  }, [])
  // typing "/" in the box suggests inline, the way the CLI does — the
  // dropdown button was a second place to look for a first-class behavior
  const [slashQ, setSlashQ] = useState<string | null>(null)
  useEffect(() => {
    const h = (e: Event) => {
      const ta = e.target as HTMLTextAreaElement
      if (ta?.tagName !== 'TEXTAREA') return
      const v = ta.value
      setSlashQ(v.startsWith('/') && !v.includes(' ') && v.length < 40 ? v : null)
    }
    document.addEventListener('input', h, true)
    return () => document.removeEventListener('input', h, true)
  }, [])
  const pickCommand = useCallback((c: string) => {
    const ta = document.querySelector('textarea')
    if (ta) { ta.value = c + ' '; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus() }
    setSlashQ(null)
  }, [])
  const [hireWhy, setHireWhy] = useState('')
  const hireName = useRef<HTMLInputElement>(null)
  const hireDesc = useRef<HTMLInputElement>(null)
  const hireKind = useRef('channel')
  // ⛔ A hidden ResizablePanel still OWNS its percent of the row — display:none
  // hides the pixels but the layout keeps the gutter, and on a phone that was
  // a third of the screen spent on two invisible panes. So below md the side
  // panels are not rendered at all, not merely hidden.
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const h = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])



  // the tree fires onSelect for FOLDER rows too; a folder click must toggle
  // the folder, never open the detail dialog
  const paneRef = useRef<Pane | null>(null)
  const isFileIn = (n: WsNode | null | undefined, p: string): boolean => {
    if (!n) return true // no tree yet: let the fetch decide
    const parts = p.split('/')
    let cur: WsNode = n
    for (let i = 0; i < parts.length - 1; i++) { const d = cur.dirs[parts[i]]; if (!d) return false; cur = d }
    return cur.files.some((f) => f.name === parts[parts.length - 1])
  }
  const openFile = useCallback(async (path: string) => {
    if (!sel) return
    if (!isFileIn(paneRef.current?.workspace, path)) return
    setDrawerOpen(false) // a file chosen from the phone drawer should be visible, not behind it
    setFile({ path, kind: 'loading' }) // the dialog opens NOW; content follows
    const q = 'api/wsfile?key=' + encodeURIComponent(sel) + '&path=' + encodeURIComponent(path)
    const r = await fetch(q)
    const type = r.headers.get('content-type') ?? ''
    if (type.startsWith('image/')) { setFile({ path, kind: 'imageurl', content: q }); return }
    setFile({ path, ...(await r.json()) })
  }, [sel])

  const office = useCallback(async () => {
    const o = await (await fetch('api/office-chat')).json()
    setDesks(o.desks); setCanSend(o.canSend)
    setSel((s) => s ?? o.desks[0]?.key ?? null)
  }, [])
  // ⛔ THIS WAS A PLAIN OBJECT, recreated every render, so the diff guard
  // never engaged and the re-parse froze the thread anyway. A ref survives.
  const lastPayload = useRef('')
  // what YOU just sent, shown immediately: typing -> terminal -> transcript
  // -> poll takes seconds, and a silent gap reads as a swallowed message
  const [outbox, setOutbox] = useState<{ text: string; at: number }[]>([])
  const poll = useCallback(async () => {
    if (!sel) return
    const text = await (await fetch('api/transcript?key=' + encodeURIComponent(sel))).text()
    // ⛔ 80 markdown documents re-parsed every 2.5s froze the main thread for
    // seconds at a time. An unchanged payload must cost nothing.
    if (text === lastPayload.current) return
    lastPayload.current = text
    const p = JSON.parse(text)
    setPane(p); paneRef.current = p
    // an echo leaves the outbox the moment the transcript itself shows it
    const norm = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 80)
    const recent = (p?.messages ?? []).slice(-12).filter((m: Msg) => m.role === 'user').map((m: Msg) => norm(m.text))
    setOutbox((o) => o.filter((x) => !recent.some((r) => r.startsWith(norm(x.text)) || norm(x.text).startsWith(r)) && Date.now() - x.at < 90000))
  }, [sel])

  // moved BELOW office/poll: referencing office above its const was a TDZ
  // crash the minifier renamed into "Cannot access 'O' before initialization"
  const doHire = useCallback(async () => {
    setHireWhy('')
    const r = await (await fetch('api/hire', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: hireName.current?.value?.trim(), kind: hireKind.current, description: hireDesc.current?.value ?? '' }),
    })).json()
    if (r?.ok === false) { setHireWhy(r.why); return }   // the refusal IS the product; show it verbatim
    setHireOpen(false); office()
  }, [office])
  useEffect(() => { office(); const t = setInterval(office, 5000); return () => clearInterval(t) }, [office])
  // ⛔ AN OPEN TAB NEVER REFETCHES THE PAGE: no-store protects the next load,
  // not the one already running, and a tab left open across ships kept
  // yesterday's UI while looking current. The tab heals itself: when the
  // build underneath changes, reload — unless the human is mid-sentence.
  const bootBuild = useRef<number | null>(null)
  useEffect(() => {
    const check = async () => {
      try {
        const v = await (await fetch('api/version')).json()
        if (bootBuild.current === null) { bootBuild.current = v.builtAt; return }
        if (v.builtAt !== bootBuild.current) {
          const ta = document.querySelector('textarea') as HTMLTextAreaElement | null
          if (ta?.value?.trim()) { setNote('the board updated underneath this tab — refresh when ready') ; return }
          location.reload()
        }
      } catch { /* offline moments are not staleness */ }
    }
    check(); const t = setInterval(check, 15000); return () => clearInterval(t)
  }, [])
  // push first, poll as the net: the server watches the transcript and ticks
  // over SSE the moment Claude writes; the interval only covers a dropped stream
  useEffect(() => { poll(); const t = setInterval(poll, 4000); return () => clearInterval(t) }, [poll])
  useEffect(() => {
    if (!sel) return
    const es = new EventSource('api/events?key=' + encodeURIComponent(sel))
    es.onmessage = () => poll()
    return () => es.close()
  }, [sel, poll])
  useEffect(() => { fetch('api/commands').then((r) => r.json()).then((j) => setCommands(j.detail ?? (j.commands ?? []).map((n: string) => ({ name: n, desc: '' })))) }, [])
  // switching desks must not leave the LAST desk's pixels or words on
  // screen — a few seconds of the wrong desk reads as the wrong truth
  useEffect(() => {
    setPane(null); paneRef.current = null
    setOutbox([]); setNote('') // a toast belongs to the desk that earned it
    setScreen((old) => { if (old.src) URL.revokeObjectURL(old.src); return { src: null, url: '', why: 'connecting to this desk’s computer…' } })
  }, [sel])
  // the WHOLE browser, not one tab: the strip lists every page the desk has
  // open and a click picks which one the mirror shows
  const [beat, setBeat] = useState<{ declared: boolean; ok?: boolean; last?: string; lines?: string[] } | null>(null)
  useEffect(() => {
    const go = () => fetch('api/heartbeat').then((r) => r.json()).then(setBeat).catch(() => {})
    go(); const t = setInterval(go, 20000); return () => clearInterval(t)
  }, [])
  const [checks, setChecks] = useState<{ code: number; rows: { name: string; code: number; why: string; applicable: boolean }[] } | null>(null)
  const [agents, setAgents] = useState<{ name: string; description: string; model?: string; effort?: string; source: string }[] | null>(null)
  const [skills, setSkills] = useState<{ name: string; description: string; kind?: string; source: string }[] | null>(null)
  const [plugins, setPlugins] = useState<{ name: string; version: string; marketplace: string; description: string; agents: number; skills: number; commands: number; hooks: number }[] | null>(null)
  useEffect(() => { fetch('api/plugins').then((r) => r.json()).then((j) => setPlugins(j.items ?? [])).catch(() => setPlugins([])) }, [])
  const [hooks, setHooks] = useState<{ source: string; event: string; matcher: string; command: string }[] | null>(null)
  useEffect(() => {
    if (!sel) return
    setHooks(null); setAgents(null); setSkills(null)
    fetch('api/agents?key=' + encodeURIComponent(sel)).then((r) => r.json()).then((j) => setAgents(j.items ?? [])).catch(() => setAgents([]))
    fetch('api/skills?key=' + encodeURIComponent(sel)).then((r) => r.json()).then((j) => setSkills(j.items ?? [])).catch(() => setSkills([]))
    fetch('api/hooks?key=' + encodeURIComponent(sel)).then((r) => r.json()).then((j) => setHooks(j.hooks ?? [])).catch(() => setHooks([]))
  }, [sel])
  const [tabs, setTabs] = useState<{ id: string; title: string; url: string }[]>([])
  const [curTab, setCurTab] = useState<string | null>(null)
  useEffect(() => { setTabs([]); setCurTab(null) }, [sel])
  useEffect(() => {
    if (!sel || !showComputer) return
    let alive = true
    const go = async () => {
      const r = await fetch('api/screen?key=' + encodeURIComponent(sel) + (curTab ? '&tab=' + encodeURIComponent(curTab) : ''))
      if (!alive) return
      if (r.status !== 200) { setScreen({ src: null, url: '', why: 'Computer is currently off for this desk' }); return }
      const blob = await r.blob()
      if (!alive) return
      setScreen((old) => { if (old.src) URL.revokeObjectURL(old.src); return { src: URL.createObjectURL(blob), url: decodeURIComponent(r.headers.get('x-tab-url') ?? ''), why: '' } })
    }
    const tabsGo = async () => {
      try { const r = await fetch('api/tabs?key=' + encodeURIComponent(sel)); if (r.status === 200) { const j = await r.json(); if (alive) setTabs(j.tabs ?? []) } } catch { /* the strip is a convenience */ }
    }
    go(); tabsGo()
    const t = setInterval(go, 1200); const t2 = setInterval(tabsGo, 5000)
    return () => { alive = false; clearInterval(t); clearInterval(t2) }
  }, [sel, showComputer, curTab])

  const blocks = useMemo(() => toBlocks(pane?.messages ?? []), [pane])

  const deskList = desks.map((d) => (
    <Button key={d.key} variant={sel === d.key ? 'secondary' : 'ghost'} onClick={() => { setSel(d.key); setDrawerOpen(false) }}
      title={d.sub} className="h-auto w-full justify-start rounded-none px-3 py-2.5 md:py-1.5">
      <span className="flex w-full flex-col items-start gap-0.5 overflow-hidden">
        <span className="flex w-full items-center gap-2 text-[13px] font-medium">
          {/* the shape IS the desk (colour + form from its name); status is
              carried by the NAME now — grayed when offline, shimmering when
              handling something — so the green dot is gone. */}
          {(() => {
            const online = d.online ?? (d.activeMin != null && d.activeMin < 30)
            return <>
              <DeskAvatar name={d.label} busy={d.busy} />
              {d.busy
                ? <Shimmer className="truncate">{d.label}</Shimmer>
                : <span className={'truncate ' + (online ? '' : 'text-muted-foreground/50')}>{d.label}</span>}
            </>
          })()}
          {d.sub.includes('LIVE') && <Badge className="h-4 flex-none px-1 text-[9px]">LIVE</Badge>}
          {(d.agents?.length ?? 0) > 0 && <Badge variant="secondary" className="h-4 flex-none px-1 text-[9px]">◇ {d.agents!.length}</Badge>}
          {d.waiting && <Badge className="h-4 flex-none gap-0.5 bg-amber-500 px-1 text-[9px] text-black"><CircleHelp className="size-2.5" /> waiting</Badge>}
        </span>
        {d.agents?.map((a, i) => (
          <span key={i} title={(a.kind === 'session' ? 'teammate session: ' : 'subagent: ') + a.label} className="mt-1 flex w-full items-center gap-2 overflow-hidden pl-7 text-[11px] font-normal text-muted-foreground">
            {a.kind === 'session'
              ? <Users className={'size-3 flex-none ' + (a.activeMin < 2 ? 'text-sky-400' : 'opacity-70')} />
              : <CornerDownRight className={'size-3 flex-none ' + (a.activeMin < 2 ? 'text-amber-300' : 'opacity-60')} />}
            <span className="truncate">{a.label}</span>
          </span>
        ))}
        {d.jobs?.map((j) => (
          <span key={j.id} title={'background job ' + j.id + ' · output ' + j.size + 'B'} className="mt-1 flex w-full items-center gap-2 overflow-hidden pl-7 text-[11px] font-normal text-muted-foreground">
            <Clock className={'size-3 flex-none ' + (j.ageSec < 60 ? 'animate-pulse text-amber-400' : 'opacity-70')} />
            <span className="truncate">{j.label || 'background · ' + j.id} · {j.ageSec < 60 ? 'running' : Math.round(j.ageSec / 60) + 'm ago'}</span>
          </span>
        ))}
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
      // Tab completes the top slash suggestion, exactly like the CLI
      if (e.key === 'Tab' && ta.value.startsWith('/') && !ta.value.includes(' ')) {
        const hit = commandsRef.current.find((c) => c.name.startsWith(ta.value))
        if (hit) { ta.value = hit.name + ' '; ta.dispatchEvent(new Event('input', { bubbles: true })) }
        e.preventDefault(); return
      }
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

  const answer = useCallback(async (text: string) => {
    if (!canSend || !sel) return
    const r = await (await fetch('api/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: sel, text }),
    })).json()
    setNote(r.ok ? '' : '⛔ ' + r.why)
    if (r.ok) { setOutbox((o) => [...o, { text, at: Date.now() }]); setTimeout(poll, 900) }
  }, [canSend, sel, poll])

  const onSubmit = useCallback(async (m: PromptInputMessage, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSend || !sel) return
    let text = m.text?.trim() ?? ''
    // attachments land in the desk's own scratchpad; the terminal gets the path,
    // exactly as a paste into the CLI would
    for (const f of m.files ?? []) {
      const r = await (await fetch('api/upload', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: sel, name: f.filename ?? 'file', data: f.url }),
      })).json()
      if (r.ok) text += (text ? '\n' : '') + r.path
      else setNote('⛔ ' + r.why)
    }
    if (!text) return
    const r = await (await fetch('api/send', {
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
      setOutbox((o) => [...o, { text, at: Date.now() }])
      setSlashQ(null) // the form clears without an input event; the menu must follow
      setTimeout(poll, 800)
    }
  }, [canSend, sel, poll])

  // one rail, two homes: the desktop side panel and the phone's drawer. Every
  // tab is a READ of the desk's .claude: its files, its agents, its skills and
  // commands, its hooks. Nothing here is invented; the files are the truth.
  const bySource = <T extends { source: string }>(xs: T[]) => [...new Set(xs.map((x) => x.source))].map((src) => [src, xs.filter((x) => x.source === src)] as const)
  const railTabs = (
    <Tabs defaultValue="workspace" className="flex h-full flex-col gap-0">
      <TabsList className="m-2">
        <TabsTrigger value="workspace" className="text-xs">workspace</TabsTrigger>
        <TabsTrigger value="agents" className="text-xs">agents</TabsTrigger>
        <TabsTrigger value="skills" className="text-xs">skills</TabsTrigger>
        <TabsTrigger value="plugins" className="text-xs">plugins</TabsTrigger>
        <TabsTrigger value="hooks" className="text-xs">hooks</TabsTrigger>
      </TabsList>
      <TabsContent value="plugins" className="min-h-0 flex-1 data-[state=inactive]:hidden">
        <ScrollArea className="h-full px-2 pb-2">
          {plugins === null
            ? <div className="px-2 py-2 text-xs text-muted-foreground">…</div>
            : plugins.length === 0
              ? <div className="px-2 py-2 text-xs text-muted-foreground">no plugins installed</div>
              : plugins.map((pl) => (
                  <div key={pl.marketplace + '/' + pl.name} className="flex items-start gap-2 px-1 py-2" title={pl.description}>
                    <DeskAvatar name={pl.name} size={18} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 text-[12px] font-medium"><span className="truncate">{pl.name}</span><span className="flex-none font-mono text-[10px] text-muted-foreground">{pl.version}</span></div>
                      {pl.description && <div className="line-clamp-2 text-[11px] text-muted-foreground">{pl.description}</div>}
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {[pl.agents && pl.agents + ' agents', pl.skills && pl.skills + ' skills', pl.commands && pl.commands + ' commands', pl.hooks && pl.hooks + ' hooks'].filter(Boolean).join(' · ') || 'no agents, skills, commands or hooks'} · {pl.marketplace}
                      </div>
                    </div>
                  </div>
                ))}
        </ScrollArea>
      </TabsContent>
      <TabsContent value="agents" className="min-h-0 flex-1 data-[state=inactive]:hidden">
        <ScrollArea className="h-full px-2 pb-2">
          {agents === null
            ? <div className="px-2 py-2 text-xs text-muted-foreground">…</div>
            : agents.length === 0
              ? <div className="px-2 py-2 text-xs text-muted-foreground">no agents defined for this desk</div>
              : bySource(agents).map(([src, xs]) => (
                  <div key={src} className="mb-3">
                    <div className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-blue-400">{src}</div>
                    {xs.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 px-1 py-1.5" title={a.description}>
                        <DeskAvatar name={a.name} size={18} />
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2 text-[12px] font-medium"><span className="truncate">{a.name}</span>
                            {a.model && <span className="flex-none font-mono text-[10px] text-muted-foreground">{a.model.replace('claude-', '')}{a.effort ? ' · ' + a.effort : ''}</span>}</div>
                          <div className="line-clamp-2 text-[11px] text-muted-foreground">{a.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
        </ScrollArea>
      </TabsContent>
      <TabsContent value="skills" className="min-h-0 flex-1 data-[state=inactive]:hidden">
        <ScrollArea className="h-full px-2 pb-2">
          {skills === null
            ? <div className="px-2 py-2 text-xs text-muted-foreground">…</div>
            : skills.length === 0
              ? <div className="px-2 py-2 text-xs text-muted-foreground">no skills or commands for this desk</div>
              : bySource(skills).map(([src, xs]) => (
                  <div key={src} className="mb-3">
                    <div className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-blue-400">{src}</div>
                    {xs.map((k, i) => (
                      <button key={i} type="button" className="grid w-full grid-cols-[minmax(6rem,max-content)_1fr] items-baseline gap-x-2 rounded-md px-1 py-1 text-left hover:bg-accent" title={k.description + ' — click to type it'}
                        onClick={() => pickCommand(k.name)}>
                        <span className="whitespace-nowrap font-mono text-[12px]">{k.name}</span>
                        <span className="truncate text-[11px] text-muted-foreground">{k.description}</span>
                      </button>
                    ))}
                  </div>
                ))}
        </ScrollArea>
      </TabsContent>
      <TabsContent value="hooks" className="min-h-0 flex-1 data-[state=inactive]:hidden">
        <ScrollArea className="h-full px-2 pb-2">
          {hooks === null
            ? <div className="px-2 py-2 text-xs text-muted-foreground">…</div>
            : hooks.length === 0
              ? <div className="px-2 py-2 text-xs text-muted-foreground">no hooks configured for this desk</div>
              : [...new Set(hooks.map((h) => h.event))].map((event) => (
                  <div key={event} className="mb-2">
                    <div className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-blue-400">{event}</div>
                    {hooks.filter((h) => h.event === event).map((h, i) => (
                      <div key={i} className="px-1 py-0.5 text-[11px]" title={h.command}>
                        <div className="truncate font-mono">{h.command.split('/').pop()}</div>
                        <div className="truncate text-muted-foreground">{h.matcher !== '*' ? h.matcher + ' · ' : ''}{h.source}</div>
                      </div>
                    ))}
                  </div>
                ))}
        </ScrollArea>
      </TabsContent>
      <TabsContent value="workspace" className="min-h-0 flex-1 data-[state=inactive]:hidden">
        <ScrollArea className="h-full px-2 pb-2">
          {pane?.workspace
            ? <WorkspaceTree ws={pane.workspace} onOpen={openFile} />
            : <div className="px-2 py-2 text-xs text-muted-foreground">…</div>}
        </ScrollArea>
      </TabsContent>
    </Tabs>
  )

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-screen bg-background text-foreground">
      {/* item 3+7: panes told apart by TONE, resizable with bounds */}
      {isDesktop && <ResizablePanel defaultSize="13%" minSize="9%" maxSize="24%" collapsible collapsedSize="0%" className="bg-sidebar">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between py-2 pl-4 pr-2 font-semibold">
            <span className="flex items-center gap-1.5 whitespace-nowrap py-1"><Building2 className="size-4 flex-none text-blue-400" /> the office</span>
            <Button variant="ghost" size="sm" className="px-1.5" title="Hire a desk" onClick={() => setHireOpen(true)}><Plus className="size-4" /></Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">{deskList}</ScrollArea>
          {beat?.declared && (
            <div className={'flex items-center gap-2 border-t border-border/40 px-3 py-2 text-[11px] ' + (beat.ok ? 'text-muted-foreground' : 'text-red-400')} title={beat.lines?.join('\n')}>
              <HeartPulse className={'size-3.5 flex-none ' + (beat.ok ? 'text-emerald-400' : 'animate-pulse text-red-400')} />
              <span className="truncate">{beat.last || (beat.ok ? 'office heartbeat OK' : 'office heartbeat RED')}</span>
            </div>
          )}
        </div>
      </ResizablePanel>}
      {isDesktop && <ResizableHandle className="w-0 bg-transparent" />}

      <ResizablePanel defaultSize={isDesktop ? '60%' : '100%'} minSize="40%">
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-2 px-4 py-2 md:px-6">
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger render={<Button variant="ghost" size="sm" className="md:hidden"><Menu className="size-4" /></Button>} />
              <SheetContent side="left" className="flex w-72 flex-col p-0">
                <SheetTitle className="flex items-center gap-1.5 px-4 py-3 text-base"><Building2 className="size-4" /> the office
                  <Button variant="ghost" size="sm" className="ml-auto mr-7" title="Hire a desk" onClick={() => { setDrawerOpen(false); setHireOpen(true) }}><Plus className="size-4" /></Button>
                </SheetTitle>
                <ScrollArea className="min-h-0 flex-[1.1]">{deskList}</ScrollArea>
                {/* the phone gets the same rail, in the drawer */}
                <div className="min-h-0 flex-1 border-t border-border/50">{railTabs}</div>
              </SheetContent>
            </Sheet>
            {pane?.label && <DeskAvatar name={pane.label} size={22} />}
            <span className="min-w-0 truncate whitespace-nowrap font-semibold">{pane?.label ?? '…'}</span>
            {pane?.mode && <Badge variant="outline" className="hidden h-5 flex-none gap-1 whitespace-nowrap px-1.5 font-mono text-[10px] sm:inline-flex" title="permission mode, from the session record">⇧⇥ {pane.mode === 'bypassPermissions' ? 'bypass' : pane.mode === 'acceptEdits' ? 'accept edits' : pane.mode}</Badge>}
            {pane?.model && (
              <Context usedTokens={pane.usage?.ctxUsed ?? 0} maxTokens={pane.usage?.ctxMax ?? 200000} modelId={pane.model ?? undefined}
                usage={{ inputTokens: pane.usage?.input ?? 0, outputTokens: pane.usage?.output ?? 0, totalTokens: (pane.usage?.input ?? 0) + (pane.usage?.output ?? 0), cachedInputTokens: pane.usage?.cacheRead ?? 0 } as never}
                openDelay={100}>
                <ContextTrigger><Badge variant="secondary" className="hidden cursor-default gap-1 whitespace-nowrap text-[11px] sm:inline-flex" title="context window used · hover for tokens and cost">
                  <DollarSign className="size-3" />{pane.model}<span className="text-muted-foreground">· {Math.round(((pane.usage?.ctxUsed ?? 0) / (pane.usage?.ctxMax ?? 200000)) * 100)}% ctx</span></Badge></ContextTrigger>
                <ContextContent className="w-80 text-xs">
                  <ContextContentHeader />
                  <ContextContentBody><ContextInputUsage /><ContextOutputUsage /><ContextCacheUsage /></ContextContentBody>
                  <ContextContentFooter />
                <HoverCardContent className="hidden">
                  {pane.usage ? (() => {
                    const u = pane.usage!
                    const k = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n)
                    const $ = (n: number) => '$' + (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3))
                    const row = (label: string, tok: number, cost?: number) => (
                      <div className="flex justify-between py-0.5"><span className="text-muted-foreground">{label}</span><span>{k(tok)} tok{cost != null ? ' · ' + $(cost) : ''}</span></div>
                    )
                    return (<div>
                      <div className="mb-1 font-medium">{u.turns} turns · this session</div>
                      {row('input (fresh)', u.input, u.cost?.input)}
                      {row('output', u.output, u.cost?.output)}
                      {row('cache read', u.cacheRead, u.cost?.cacheRead)}
                      {row('cache write', u.cacheWrite, u.cost?.cacheWrite)}
                      <div className="mt-1 flex justify-between border-t pt-1 font-medium"><span>estimated total</span><span>{u.cost ? $(u.cost.total) : 'no rate for this model'}</span></div>
                      <div className="mt-1 text-[10px] text-muted-foreground">{u.cost ? 'rates as of ' + u.cost.asOf + ' · cache read 0.1×, write 1.25× input rate' : 'tokens only — an unknown model gets no dollars, never a guess'}</div>
                    </div>)
                  })() : <span className="text-muted-foreground">no session yet</span>}
                </HoverCardContent>
                </ContextContent>
              </Context>
            )}
            <span className="hidden whitespace-nowrap text-xs text-muted-foreground md:inline">{pane ? pane.count + ' messages' : ''}</span>
            <Button variant={showComputer ? 'secondary' : 'ghost'} size="sm" className="ml-auto h-8 text-xs"
              onClick={() => setShowComputer(v => !v)}><Monitor className="size-3.5 sm:mr-1" /><span className="hidden sm:inline"> Computer</span></Button>
          </header>

          {/* ⛔ SIDE BY SIDE, owner's ruling: the mirror opens NEXT TO the
              conversation, resizable, never instead of it. On a phone the
              same pair stacks vertically — still both visible, still resizable. */}
          <ResizablePanelGroup orientation={isDesktop ? 'horizontal' : 'vertical'} className="min-h-0 flex-1">
          <ResizablePanel defaultSize={showComputer ? '55%' : '100%'} minSize="30%" className="flex min-h-0 flex-col">
            <Conversation key={sel ?? 'none'} className="flex-1">
              <ConversationContent className="mx-auto w-full max-w-3xl gap-2">
                {!pane && (
                  <div className="flex flex-col gap-3 py-4">
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="h-16 w-4/5" />
                    <Skeleton className="h-4 w-1/3 self-end" />
                    <Skeleton className="h-10 w-3/5" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                )}
                {pane && blocks.length === 0 && <ConversationEmptyState title="Nothing yet" description="This desk has no conversation in its current session." />}
                {/* markdown for the WHOLE tail: memoized blocks parse once
                    per message, so the old last-15 cutoff protected nothing
                    and left older turns reading as raw asterisks */}
                {(() => { const tail = blocks.slice(-60); return tail.map((b, i) => b.kind === 'msg'
                  ? <MsgBlock key={'m' + i} m={b.m} rich />
                  : <ToolsBlock key={'t' + i} tools={b.tools} />) })()}
                {outbox.length > 0 && (
                  <QueueList className="ml-auto w-fit max-w-[85%]">
                    {outbox.map((x, i) => (
                      <QueueItem key={'ob' + i} className="flex-row items-baseline gap-2">
                        <QueueItemIndicator className="animate-pulse border-sky-400" />
                        <QueueItemContent className="line-clamp-2">{x.text}</QueueItemContent>
                        <QueueItemDescription className="ml-2 flex-none">{(() => { const dk = desks.find((d) => d.key === sel); return dk?.status === 'waiting' ? 'queued — the desk is waiting on a prompt in its terminal' : dk?.busy ? 'queued' : 'delivering…' })()}</QueueItemDescription>
                      </QueueItem>
                    ))}
                  </QueueList>
                )}
                {desks.find((d) => d.key === sel)?.busy && (
                  <div className="py-1 text-sm"><Shimmer>{'✳ working… ' + (pane?.turn?.elapsedSec != null
                    ? '(' + (pane.turn.elapsedSec >= 60 ? Math.floor(pane.turn.elapsedSec / 60) + 'm ' + (pane.turn.elapsedSec % 60) + 's' : pane.turn.elapsedSec + 's')
                      + ' · ↓ ' + (pane.turn.output >= 1000 ? (pane.turn.output / 1000).toFixed(1) + 'k' : pane.turn.output) + ' tokens)'
                    : '')}</Shimmer></div>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            {pane?.pending && (
              <div className="mx-auto w-full max-w-3xl px-4 pb-2">
                <Confirmation approval={{ id: 'pending' } as never} state="approval-requested" className="border-amber-500/40 bg-amber-500/5">
                  <ConfirmationTitle className="flex items-center gap-1.5 text-xs font-medium text-amber-500">
                    <CircleHelp className="size-3.5" />
                    {pane.pending.type === 'question' ? 'This desk is waiting on YOUR answer' : 'This desk is waiting for plan approval'}
                  </ConfirmationTitle>
                  <ConfirmationRequest>
                  {pane.pending.type === 'question' ? pane.pending.questions.map((q, i) => (
                    <div key={i} className="mb-1">
                      <div className="mb-1.5 text-sm">{q.question}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {q.options.map((o, k) => (
                          <Button key={k} size="sm" variant="outline" className="h-7 text-xs" title={o.description}
                            onClick={() => answer(o.label)}>{o.label}</Button>
                        ))}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">a click types the answer into the desk's terminal · or write your own below{q.multiSelect ? ' · multiple choices allowed: type them comma-separated' : ''}</div>
                    </div>
                  )) : (
                    <div>
                      <pre className="mb-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs">{pane.pending.plan}</pre>
                      <ConfirmationActions className="justify-start">
                        <ConfirmationAction size="sm" className="h-7 text-xs" onClick={() => answer('yes, proceed with this plan')}>Approve</ConfirmationAction>
                        <ConfirmationAction size="sm" variant="outline" className="h-7 text-xs" onClick={() => answer('no, do not proceed yet — wait for me')}>Hold</ConfirmationAction>
                      </ConfirmationActions>
                    </div>
                  )}
                  </ConfirmationRequest>
                </Confirmation>
              </div>
            )}
            {note && <div className="px-6 pb-1 text-xs text-destructive">{note}</div>}
            <div className="mx-auto w-full max-w-3xl px-4 pb-4">
              <PromptInput onSubmit={onSubmit} accept="image/*" multiple globalDrop>
                <PromptInputBody>
                  <PromptInputHeader><AttachChips /></PromptInputHeader>
                  {slashQ && (
                    <div className="max-h-56 overflow-y-auto px-1 pt-1">
                      {/* two honest columns, CLI-style: the NAME gets the room
                          it needs and never hides; the description takes the
                          rest and fades with a truncate, left-aligned */}
                      {commands.filter((c) => c.name.startsWith(slashQ)).slice(0, 12).map((c, i) => (
                        <button key={c.name} type="button" onClick={() => pickCommand(c.name)}
                          className={'grid w-full grid-cols-[minmax(9rem,max-content)_1fr_auto] items-baseline gap-x-3 rounded-md px-2 py-1 text-left text-xs hover:bg-accent ' + (i === 0 ? 'bg-accent/50' : '')}>
                          <span className="whitespace-nowrap text-left font-mono">{c.name}</span>
                          <span className="truncate text-left text-muted-foreground" title={c.desc}>{c.desc}</span>
                          <span className="text-[9px] text-muted-foreground">{i === 0 ? 'tab' : ''}</span>
                        </button>
                      ))}
                      {commands.filter((c) => c.name.startsWith(slashQ)).length === 0 && (
                        <span className="px-1 text-[11px] text-muted-foreground">no matching command — Enter sends it as typed</span>
                      )}
                    </div>
                  )}
                  <PromptInputTextarea placeholder={canSend ? "Message this desk's live terminal — / for commands, drop images anywhere" : 'Read-only on this host (no orca CLI)'} disabled={!canSend} />
                </PromptInputBody>
                <PromptInputFooter>
                  <PromptInputTools>
                    {/* one attach affordance per screen size: the photo
                        button IS the mobile path, the menu is desktop's */}
                    <span className="hidden sm:inline-flex">
                      <PromptInputActionMenu>
                        <PromptInputActionMenuTrigger />
                        <PromptInputActionMenuContent>
                          <PromptInputActionAddAttachments />
                        </PromptInputActionMenuContent>
                      </PromptInputActionMenu>
                    </span>
                    {/* one tap straight to the native picker — MOBILE ONLY:
                        with the + menu also visible on desktop this was a
                        duplicate media button (owner flagged it twice) */}
                    <Button variant="ghost" size="sm" className="h-8 sm:hidden" title="Add a photo"
                      onClick={() => (document.querySelector('input[type=file]') as HTMLInputElement | null)?.click()}>
                      <ImageIcon className="size-4" /></Button>
                    <Button variant="ghost" size="sm" className="h-8 px-2 font-mono text-xs" title="Shift-Tab into this desk's terminal — the CLI cycles its permission mode there; watch the terminal for the result"
                      onClick={async () => { const r = await (await fetch('api/key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: sel, k: 'shift-tab' }) })).json(); setNote(r.ok ? 'Shift-Tab sent · the CLI keeps no live mode file, so the badge reads the recorded mode and refreshes the moment the desk writes' : '⛔ ' + r.why) }}>⇧⇥</Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-8 text-xs">/ commands</Button>} />
                      <DropdownMenuContent className="max-h-72 w-[30rem] max-w-[92vw] overflow-y-auto">
                        {commands.map((c) => (
                          <DropdownMenuItem key={c.name} onSelect={() => pickCommand(c.name)}
                            className="grid grid-cols-[minmax(9rem,max-content)_1fr] items-baseline gap-x-3">
                            <span className="whitespace-nowrap text-left font-mono">{c.name}</span>
                            <span className="truncate text-left text-[11px] text-muted-foreground" title={c.desc}>{c.desc}</span>
                          </DropdownMenuItem>
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
                {tabs.length > 1 && (
                  <div className="flex gap-1 overflow-x-auto border-b border-border/40 px-1 py-1">
                    {tabs.map((t, i) => (
                      <Button key={t.id} variant={(curTab ?? tabs[0]?.id) === t.id ? 'secondary' : 'ghost'} size="sm"
                        className="h-6 max-w-40 flex-none justify-start truncate px-2 text-[11px]" title={t.url}
                        onClick={() => setCurTab(t.id)}>{t.title || 'tab ' + (i + 1)}</Button>
                    ))}
                  </div>
                )}
                <WebPreviewNavigation>
                  <WebPreviewUrl readOnly value={screen.url} />
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
            {(desks.find((d) => d.key === sel)?.jobs?.length ?? 0) > 0 && (
              <div className="border-t border-border/40 px-3 py-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">background</div>
                {desks.find((d) => d.key === sel)!.jobs!.map((j) => (
                  <div key={j.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock className={'size-3 flex-none ' + (j.ageSec < 60 ? 'animate-pulse text-amber-400' : '')} />
                    <span className="truncate" title={j.id}>{j.label || j.id}</span>
                    <span className="ml-auto flex-none">{j.ageSec < 60 ? 'running' : Math.round(j.ageSec / 60) + 'm ago'} · {kb(j.size)}</span>
                  </div>
                ))}
              </div>
            )}
          </ResizablePanel>
          )}
          </ResizablePanelGroup>
        </div>
      </ResizablePanel>
      {isDesktop && <ResizableHandle className="w-0 bg-transparent" />}

      {/* item 4: one rail, a menu to switch what it shows */}
      {isDesktop && <ResizablePanel data-rail="files" defaultSize="22%" minSize="14%" maxSize="34%" collapsible collapsedSize="0%" className="bg-card">
        {railTabs}
      </ResizablePanel>}
      {/* updates live in one corner, folded until wanted: the host's Claude
          Code, and this plugin. Neither touches a running session. */}
      <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
        {fabOpen && (
          <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card p-1.5 shadow-lg">
            <Button variant="ghost" size="sm" className="justify-start gap-2 text-xs" title="claude update — running sessions keep their version until restarted"
              onClick={async () => {
                if (!window.confirm('Run `claude update` on the host?')) return
                setNote('updating Claude Code…'); setFabOpen(false)
                const r = await (await fetch('api/upgrade', { method: 'POST' })).json()
                setNote((r.ok ? '✓ ' : '⛔ ') + (r.before === r.after ? 'Claude Code already latest: ' + r.after : r.before + ' → ' + r.after) + ' — ' + r.note)
              }}><ArrowUpCircle className="size-4" /> update Claude Code</Button>
            <Button variant="ghost" size="sm" className="justify-start gap-2 text-xs" title="claude plugin update office-anything — the board picks it up on its next start"
              onClick={async () => {
                if (!window.confirm('Run `claude plugin update office-anything`?')) return
                setNote('updating the office plugin…'); setFabOpen(false)
                const r = await (await fetch('api/upgrade-plugin', { method: 'POST' })).json()
                setNote((r.ok ? '✓ ' : '⛔ ') + (r.note || r.why || 'done'))
              }}><Building2 className="size-4" /> update the office plugin</Button>
          </div>
        )}
        <Button variant={fabOpen ? 'secondary' : 'outline'} size="sm" className="h-9 w-9 rounded-full p-0 shadow-md" title="updates" onClick={() => setFabOpen((v) => !v)}>
          <ArrowUpCircle className="size-4" />
        </Button>
      </div>
      <Dialog open={hireOpen} onOpenChange={setHireOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Hire a desk</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3">
            <Input ref={hireName} placeholder="name — lowercase-with-hyphens, e.g. tiktok-customer-service" />
            <Input ref={hireDesc} placeholder="what this desk does, in one sentence" />
            <Select defaultValue="channel" onValueChange={(v) => { hireKind.current = v }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent className="max-w-[calc(100vw-4rem)]">
                <SelectItem value="channel" className="whitespace-normal">customer-facing — talks to people on one channel</SelectItem>
                <SelectItem value="knowledge" className="whitespace-normal">internal — holds knowledge, never contacts anyone</SelectItem>
              </SelectContent>
            </Select>
            {hireWhy && <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">⛔ {hireWhy}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setHireOpen(false)}>Cancel</Button>
              <Button onClick={doHire}>Hire</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">The description is double-checked: if it reads like a different kind than the one you picked, the hire is refused and the reason shows here.</p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!file} onOpenChange={(o) => !o && setFile(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex min-w-0 items-center gap-2 pr-6">
              <span className="truncate font-mono text-sm">{file?.path}</span>
              <Button variant="ghost" size="sm" className="h-6 flex-none px-2 text-[11px]" title="Copy path to mention it in chat"
                onClick={async (e) => {
                  e.stopPropagation()
                  if (!file) return
                  const b = e.currentTarget
                  // the Clipboard API needs a secure context; a hidden textarea +
                  // execCommand is the fallback that works everywhere a page does
                  let ok = false
                  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(file.path); ok = true } } catch { ok = false }
                  if (!ok) {
                    try {
                      const ta = document.createElement('textarea'); ta.value = file.path; ta.setAttribute('readonly', '')
                      ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select()
                      ok = document.execCommand('copy'); ta.remove()
                    } catch { ok = false }
                  }
                  b.textContent = ok ? 'copied ✓' : 'copy failed — select the path above'
                  setTimeout(() => { b.textContent = 'copy path' }, ok ? 1200 : 3000)
                }}>copy path</Button>
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] min-h-0 flex-1 overflow-auto">
            {file?.kind === 'loading' && <div className="flex flex-col gap-2 p-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24 w-full" /><Skeleton className="h-4 w-2/3" /></div>}
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
