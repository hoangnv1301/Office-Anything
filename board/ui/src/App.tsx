// THE OFFICE. Data wiring over registry components, nothing hand-rolled:
// shadcn/ui (resizable, tabs, badge, button, scroll-area) + AI Elements
// (conversation, message, reasoning, tool, task, file-tree, image,
// prompt-input, web-preview). The core stays Claude Code.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { FileTree, FileTreeFolder, FileTreeFile } from '@/components/ai-elements/file-tree'
import { Image as AIImage } from '@/components/ai-elements/image'
import {
  PromptInput, PromptInputBody, PromptInputTextarea, PromptInputFooter, PromptInputSubmit,
  PromptInputTools, PromptInputActionAddAttachments, PromptInputHeader,
  PromptInputActionMenu, PromptInputActionMenuTrigger, PromptInputActionMenuContent,
  usePromptInputAttachments,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { WebPreview, WebPreviewNavigation, WebPreviewUrl } from '@/components/ai-elements/web-preview'
import { Monitor, Plus, Menu, ImageIcon, Flag, CircleHelp, Clock, ArrowUpCircle, ChevronRight, ChevronDown, XCircle, ExternalLink, ArrowLeftRight, ListTodo, LayoutList, PanelRight, X, Moon, Sun, Brain, CheckCircle2, MinusCircle, Building2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { Sources, SourcesTrigger, SourcesContent, Source } from '@/components/ai-elements/sources'
import { chooseTheme, isDark } from '@/lib/theme'

type Desk = { key: string; label: string; sub: string; activeMin: number | null; online?: boolean | null; busy?: boolean | null; status?: string | null; state?: string | null; detail?: string | null; remoteUrl?: string | null; route?: 'inbox' | 'terminal' | null; mode?: string | null; sessionName?: string | null; waiting?: boolean; agents?: { kind?: string; label: string; activeMin: number; turns: number }[]; jobs?: { id: string; ageSec: number; size: number; label?: string }[] }
type Img = { kind: 'b64'; mediaType: string; data: string } | { kind: 'path'; path: string } | { kind: 'marker'; label: string }
export type Msg = { role: 'user' | 'assistant' | 'system' | 'peer'; from?: string; text: string; label?: string; queued?: boolean; at?: string | null; tools?: ToolRow[]; images?: Img[]; reasoning?: string | null }
type WsNode = { dirs: Record<string, WsNode>; files: { name: string; size: number }[]; truncated?: boolean }
type Usage = { turns: number; input: number; output: number; cacheRead: number; cacheWrite: number; model: string | null; sessions?: number; ctxUsed?: number; ctxMax?: number; cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; asOf: string } | null }
type PendingAsk = { id?: string } & ({ type: 'question'; questions: { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string }[] }[] } | { type: 'plan'; plan: string })
type Pane = { ratesAsOf?: string; label: string; model: string | null; count: number; messages: Msg[]; folder: { name: string; size: number; ageMin: number }[]; workspace?: WsNode | null; usage?: Usage | null; turn?: { elapsedSec: number | null; output: number } | null; mode?: string | null; pending?: PendingAsk | null }
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
function DeskAvatar({ name, busy, size = 20, dot }: { name: string; busy?: boolean | null; size?: number; dot?: 'on' | 'off' | 'wait' | null }) {
  const blob = BLOBS[deskHue(name) % BLOBS.length]
  return (
    <span className={'relative flex flex-none items-center justify-center font-semibold text-black ' + (busy ? 'animate-pulse' : '')}
      style={{ width: size, height: size, borderRadius: blob, background: deskColor(name), fontSize: size * 0.45 }}>
      {name[0]?.toUpperCase() ?? '?'}
      {/* the state dot: green online, amber waiting on you, grey offline */}
      {dot && <span data-dot={dot} className={'absolute -bottom-0.5 -right-0.5 size-[11px] rounded-full border-2 border-sidebar ' + (dot === 'on' ? 'bg-ok' : dot === 'wait' ? 'bg-wait' : 'bg-border')} />}
    </span>
  )
}

// the CLI's hook events in LIFECYCLE order, session start to session end;
// an alphabetical list put Stop before UserPromptSubmit
const HOOK_ORDER = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure', 'TeammateIdle', 'TaskCompleted', 'PreCompact', 'SessionEnd']
// a hook's NAME is its script file when it has one, else its first word;
// splitting a quoted shell command on "/" left a stray quote and, for
// if [ -f '/Users/… ] wrappers, a bare path fragment
const hookName = (cmd: string) => {
  const file = /([\w.-]+\.(?:sh|mjs|cjs|js|ts|py|rb|cmd))\b/.exec(cmd)?.[1]
  if (file) return file
  const first = cmd.trim().replace(/^["']+|["']+$/g, '').split(/\s+/)[0] ?? cmd
  return first.length > 40 ? first.slice(0, 40) + '…' : first
}
// ⛔ BUILT-INS THAT OPEN A PICKER IN THE TERMINAL. The picker is a TUI the
// transcript never records: sent bare from the board it opens a menu nobody
// is watching and the desk sits "waiting" on it. So the board completes the
// ARGUMENT inline and refuses to send the bare form.
const PICKERS: Record<string, string[]> = {
  // aliases first (they follow each new release), then today's full ids
  '/model': ['opus', 'sonnet', 'haiku', 'fable', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  '/effort': ['low', 'medium', 'high', 'xhigh', 'max'],
  '/config': [], '/permissions': [], '/resume': [], '/agents': [], '/hooks': [], '/mcp': [], '/plugin': [], '/memory': [],
}
const kb = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'
const age = (m: number) => (m < 60 ? `${m}m` : `${Math.round(m / 60)}h`) + ' ago'

// ONE QUIET SHAPE FOR EVERYTHING THAT IS NOT A MESSAGE: reasoning, a tool run,
// a system event, a hand-off. A pill that says what happened in one line and
// opens to the whole of it. Errors are the only loud ones.
function Chip({ icon, label, tone, under, children, testid }: { icon?: React.ReactNode; label: React.ReactNode; tone?: 'err'; under?: React.ReactNode; children?: React.ReactNode; testid?: string }) {
  return (
    <Collapsible className="max-w-full self-start" data-testid={testid}>
      <CollapsibleTrigger className={'inline-flex max-w-full cursor-pointer items-center gap-2 rounded-full border py-1 pl-2 pr-3 text-[13px] transition-colors [&[data-panel-open]_.chev]:rotate-90 '
        + (tone === 'err' ? 'border-err/70 bg-err-soft text-err hover:border-err' : 'border-border bg-background text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground')}>
        {icon}<span className="min-w-0 truncate text-left">{label}</span>
        <ChevronRight className="chev size-3.5 flex-none transition-transform" />
      </CollapsibleTrigger>
      {under && <div className="ml-3 mt-1 max-w-[min(560px,78vw)] truncate text-[12.5px] text-muted-foreground">{under}</div>}
      {children && <CollapsibleContent className="mt-2 border-l-2 border-border py-1 pl-3.5 text-[13.5px]">{children}</CollapsibleContent>}
    </Collapsible>
  )
}

const MsgBlock = memo(function MsgBlock({ m, rich, replied }: { m: Msg; rich: boolean; replied?: boolean }) {
  if (m.role === 'system') {
    const isErr = /error/i.test(m.label ?? '')
    return (
      <Chip tone={isErr ? 'err' : undefined} icon={isErr ? <XCircle className="size-3.5 flex-none" /> : <Flag className="size-3.5 flex-none" />} label={m.label ?? 'system'}>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{m.text}</pre>
      </Chip>
    )
  }
  if (m.role === 'peer') {
    // a message from another desk is a HAND-OFF: who, one line of what, and
    // the whole of it one click away. "replied" only when this desk wrote to
    // that one first, otherwise it is somebody else's opening ask.
    const from = m.from ?? '?'
    return (
      <Chip testid="handoff" icon={<DeskAvatar name={from} size={18} />} label={from + (replied ? ' replied' : ' wrote')} under={m.text.replace(/\s+/g, ' ').trim().slice(0, 180)}>
        {rich ? <MessageResponse>{m.text}</MessageResponse> : <span className="whitespace-pre-wrap break-words">{m.text}</span>}
      </Chip>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      {m.reasoning && (
        <Chip icon={<Brain className="size-3.5 flex-none" />} label="Thinking">
          <div className="whitespace-pre-wrap text-[13px] text-muted-foreground">{m.reasoning}</div>
        </Chip>
      )}
      {/* ⛔ boolean, not number: `text || images?.length` leaked a literal
          0 into the chat for every empty-text, empty-images turn */}
      {(m.text !== '' || (m.images?.length ?? 0) > 0) && (
        <Message from={m.role} className="max-w-[88%]">
          <MessageContent className="rounded-2xl bg-bubble px-4 py-2.5 text-[15px] leading-relaxed group-[.is-user]:rounded-2xl group-[.is-user]:bg-brand-soft group-[.is-user]:px-4 group-[.is-user]:py-2.5">
            {m.text && (rich ? <MessageResponse>{m.text}</MessageResponse> : <span className="whitespace-pre-wrap break-words">{m.text}</span>)}
            <Pictures images={m.images} />
          </MessageContent>
        </Message>
      )}
    </div>
  )
}, (a, b) => a.m.text === b.m.text && a.rich === b.rich && a.replied === b.replied && a.m.reasoning === b.m.reasoning && (a.m.images?.length ?? 0) === (b.m.images?.length ?? 0))

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
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border-l-2 border-err bg-err-soft p-2 font-mono text-foreground">{input.old_string.slice(0, 1500)}</pre>
    )}
    {typeof input.new_string === 'string' && (
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border-l-2 border-ok bg-ok-soft p-2 font-mono text-foreground">{input.new_string.slice(0, 1500)}</pre>
    )}
    {typeof input.content === 'string' && (
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border-l-2 border-ok bg-ok-soft p-2 font-mono text-foreground">{input.content.slice(0, 1500)}</pre>
    )}
  </div>
)

// the desks a run of tool calls wrote to, with what each was asked and when it
// counts as done ("Done when: …", if the message says so)
export type Sent = { to: string; text: string; doneWhen: string | null }
export function sentIn(tools: { name: string; input: unknown }[]): Sent[] {
  const out: Sent[] = []
  for (const t of tools) {
    if (t.name !== 'SendMessage' || typeof t.input !== 'object' || t.input === null) continue
    const inp = t.input as Record<string, unknown>
    if (typeof inp.to !== 'string' || typeof inp.message !== 'string' || !inp.message.trim()) continue
    const done = /\bdone when:?\s*([^\n]+)/i.exec(inp.message)?.[1]?.trim() ?? null
    out.push({ to: inp.to, text: inp.message, doneWhen: done })
  }
  return out
}
// a cross-session address (uds:/…, bridge:…) is not a desk name: say so plainly
const toName = (to: string) => /^[a-z]+:/i.test(to) ? 'another session' : to

const ToolsBlock = memo(function ToolsBlock({ tools }: { tools: ToolRow[] }) {
  const failed = tools.filter((t) => t.isError).length
  const names = [...new Set(tools.map((t) => {
    const to = t.name === 'SendMessage' && typeof t.input === 'object' && t.input !== null ? (t.input as Record<string, unknown>).to : null
    return typeof to === 'string' ? 'SendMessage → ' + toName(to) : t.name
  }))].join(', ')
  return (
    <Chip tone={failed ? 'err' : undefined} icon={failed ? <XCircle className="size-3.5 flex-none" /> : undefined}
      label={tools.length + ' tool call' + (tools.length > 1 ? 's' : '') + ' — ' + names + (failed ? ' · ' + failed + ' failed' : '')}>
      <div className="flex flex-col gap-1">
        {tools.map((t, k) => {
          const isDiff = (t.name === 'Edit' || t.name === 'Write') && typeof t.input === 'object' && t.input !== null
          return (
            <Tool key={k} className="mb-0 rounded-lg border-border/70">
              <ToolHeader className="p-2" type="dynamic-tool" state={t.isError ? 'output-error' : t.output ? 'output-available' : 'input-available'} toolName={t.name} />
              <ToolContent className="space-y-2 p-2">
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
      </div>
    </Chip>
  )
}, (a, b) => a.tools.length === b.tools.length && a.tools[0]?.name === b.tools[0]?.name
  && a.tools.map((t) => (t.output ? 1 : 0) + (t.isError ? 2 : 0)).join() === b.tools.map((t) => (t.output ? 1 : 0) + (t.isError ? 2 : 0)).join())

// a message this desk sent to another one, surfaced beside the tool list: the
// hand-off is the thing the owner wants to see, not the tool that carried it
const SentChip = ({ s }: { s: Sent }) => (
  <Chip testid="sent" icon={<DeskAvatar name={toName(s.to)} size={18} />} label={'Sent to ' + toName(s.to)} under={s.doneWhen ? 'Done when: ' + s.doneWhen : undefined}>
    <div className="whitespace-pre-wrap break-words">{s.text}</div>
  </Chip>
)

// the line under a desk's name: what it is doing, always, in the CLI's words.
// A working desk with a detail says the detail ("Writing a reply").
export function rowLine(d: Pick<Desk, 'state' | 'detail' | 'online' | 'busy' | 'waiting' | 'activeMin'>): string {
  const working = (d.state === 'working' || d.busy) && !(d.state === 'waiting' || d.waiting)
  const s = working && d.detail ? d.detail : deskStatusLine(d) || (d.online === true || (d.online == null && d.activeMin != null && d.activeMin < 30) ? 'idle' : d.online === false ? 'offline' : 'no live session')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

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


// what a desk is doing, in the CLI's own words, for its row and its header.
// Every status the session registry writes has a line; none is guessed.
export function deskStatusLine(d: Pick<Desk, 'state' | 'detail' | 'online' | 'busy' | 'waiting'> | undefined): string {
  if (!d) return ''
  if (d.state === 'waiting' || d.waiting) return 'waiting on you' + (d.detail ? ' · ' + d.detail : '')
  if (d.state === 'shell') return 'running a command'
  if (d.state === 'working' || d.busy) return 'working'
  if (d.state === 'idle') return 'idle'
  if (d.state) return d.state
  return d.online === false ? 'offline' : ''
}

// how a message would reach this desk, said before anyone types
export function composerHint(d: Pick<Desk, 'label' | 'route'> | undefined): string {
  if (!d) return ''
  if (d.route === 'inbox') return 'Message ' + d.label + ' — straight to its session inbox · / for commands'
  if (d.route === 'terminal') return 'Message ' + d.label + ' — typed into its terminal · / for commands'
  return d.label + ' cannot be reached from here — open it in the Claude app'
}

type TimelineItem = { from: string; to: string; text: string; at: string | null; unanswered?: boolean }
const when = (at: string | null) => at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

// the office's own conversation: every desk-to-desk message, newest last,
// the open asks marked. Read-only, re-read on every open.
function OfficeTimeline({ onPick }: { onPick: (desk: string) => void }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null)
  const [openOnly, setOpenOnly] = useState(false)
  useEffect(() => {
    let alive = true
    const go = () => fetch('api/timeline').then((r) => r.json()).then((j) => { if (alive) setItems(j.items ?? []) }).catch(() => { if (alive) setItems([]) })
    go(); const t = setInterval(go, 8000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  const shown = (items ?? []).filter((x) => !openOnly || x.unanswered)
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-2 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{items === null ? '…' : items.length + ' desk-to-desk messages · newest first · from each desk’s recent record'}</span>
          <Button variant={openOnly ? 'secondary' : 'ghost'} size="sm" className="ml-auto h-6 px-2 text-[11px]" onClick={() => setOpenOnly((v) => !v)}>
            {openOnly ? 'show all' : 'open asks only (' + (items ?? []).filter((x) => x.unanswered).length + ')'}</Button>
        </div>
        {items !== null && shown.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">{openOnly ? 'No open asks between desks.' : 'No desk-to-desk messages yet.'}</div>}
        {shown.slice().reverse().map((x, i) => (
          <div key={i} className={'rounded-lg border px-3 py-2 ' + (x.unanswered ? 'border-wait/50 bg-wait-soft/50' : 'border-border/50')}>
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              <button type="button" className="flex items-center gap-1 hover:underline" onClick={() => onPick(x.from)}><DeskAvatar name={x.from} size={14} />{x.from}</button>
              <span className="text-muted-foreground">→</span>
              <button type="button" className="flex items-center gap-1 hover:underline" onClick={() => onPick(x.to)}><DeskAvatar name={x.to} size={14} />{x.to}</button>
              <span className="ml-auto text-muted-foreground">{when(x.at)}</span>
              {x.unanswered && <Badge className="h-4 bg-wait-soft px-1 text-[9px] text-wait">no reply yet</Badge>}
            </div>
            <div className="line-clamp-4 whitespace-pre-wrap break-words text-sm" title={x.text}>{x.text}</div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

type TaskRow = { id: string; title: string; said: string; state: string; assigned: string; due: string | null; age: string; idle: string; overdue: boolean; stale: boolean; notes: { at: number; by: string; text: string }[]; evidence: { evidence: string; proof: string; at: number }[]; reason?: string }
type QueueData = { totals: { open: number; working: number; waiting: number; done: number; overdue: number; stale: number }; assignees: { name: string; counts: Record<string, number>; overdue: number; stale: number; tasks: TaskRow[] }[]; closed: TaskRow[]; ownerWords?: { open: number; alarms: number; sessions: { session: string; open: number; alarms: number; oldest: string }[] } }
type Evidence = { kind: string; content?: string; url?: string; why?: string; path?: string }
// the office-wide queue: the lead's task list, read-only, from the same fold the lead uses
function TasksView() {
  const [q, setQ] = useState<QueueData | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [ev, setEv] = useState<Record<string, Evidence>>({})
  useEffect(() => {
    let alive = true
    const go = () => fetch('api/tasks').then((r) => r.json()).then((j) => { if (alive) setQ(j) }).catch(() => {})
    go(); const t = setInterval(go, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  const showEvidence = (id: string, n: number) => fetch('api/task-evidence?id=' + encodeURIComponent(id) + '&n=' + n).then((r) => r.json()).then((j) => setEv((m) => ({ ...m, [id + ':' + n]: j }))).catch(() => {})
  const stateTone = (t: TaskRow) => t.overdue ? 'border-destructive/60 bg-destructive/5' : t.stale ? 'border-wait/50 bg-wait-soft/50' : 'border-border/50'
  const Row = ({ t }: { t: TaskRow }) => (
    <div className={'rounded-lg border px-3 py-2 ' + stateTone(t)} data-testid="task-row">
      <button type="button" className="flex w-full flex-wrap items-center gap-1.5 text-left text-sm" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
        <span className="font-mono text-[11px] text-muted-foreground">{t.id}</span>
        <Badge variant="secondary" className="h-4 px-1 text-[9px]">{t.state}</Badge>
        {t.overdue && <Badge className="h-4 bg-destructive px-1 text-[9px] text-white">OVERDUE</Badge>}
        {t.stale && !t.overdue && <Badge className="h-4 bg-wait-soft px-1 text-[9px] text-wait">quiet {t.idle}</Badge>}
        <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
        <span className="flex-none text-[11px] text-muted-foreground">{t.age}{t.due ? ' · due ' + t.due : ''}</span>
      </button>
      {open === t.id && (
        <div className="mt-2 space-y-1.5 text-xs">
          <div className="whitespace-pre-wrap text-muted-foreground">“{t.said}”</div>
          {t.reason && <div>dropped: {t.reason}</div>}
          {t.notes.map((n, i) => <div key={i} className="text-muted-foreground">{when(new Date(n.at).toISOString())} · {n.by}: {n.text}</div>)}
          {t.evidence.map((e, i) => (
            <div key={i}>
              <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => showEvidence(t.id, i)}>evidence: {e.evidence}</button> — {e.proof}
              {ev[t.id + ':' + i]?.kind === 'link' && <a className="ml-2 underline" href={ev[t.id + ':' + i].url} target="_blank" rel="noreferrer">open link</a>}
              {ev[t.id + ':' + i] && ev[t.id + ':' + i].kind !== 'link' && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2">{ev[t.id + ':' + i].content ?? ev[t.id + ':' + i].why}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 py-3">
        {q === null && <Skeleton className="h-10 w-2/3" />}
        {q && (
          <div className="flex flex-wrap gap-1.5 text-xs" aria-live="polite">
            <Badge variant="secondary">{q.totals.open} open</Badge><Badge variant="secondary">{q.totals.working} working</Badge><Badge variant="secondary">{q.totals.waiting} waiting</Badge><Badge variant="secondary">{q.totals.done} done, not verified</Badge>
            {q.totals.overdue > 0 && <Badge className="bg-destructive text-white">{q.totals.overdue} overdue</Badge>}
            {q.totals.stale > 0 && <Badge className="bg-wait-soft text-wait">{q.totals.stale} quiet 24h+</Badge>}
            {q.ownerWords && q.ownerWords.open > 0 && <Badge variant="secondary" title={q.ownerWords.sessions.map((s) => s.session + ': ' + s.open + ' open, oldest ' + s.oldest).join('\n')}>{q.ownerWords.open} owner words open</Badge>}
            {q.ownerWords && q.ownerWords.alarms > 0 && <Badge className="bg-destructive text-white">{q.ownerWords.alarms} owner words open 24h+</Badge>}
          </div>
        )}
        {q && q.assignees.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Nothing open. The lead puts the owner’s requests here.</div>}
        {q?.assignees.map((a) => (
          <section key={a.name} className="space-y-1.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><DeskAvatar name={a.name} size={16} />{a.name}
              <span className="text-[11px] font-normal text-muted-foreground">{a.counts.open} open · {a.counts.working} working · {a.counts.waiting} waiting · {a.counts.done} done</span></h3>
            {a.tasks.map((t) => <Row key={t.id} t={t} />)}
          </section>
        ))}
        {q && q.closed.length > 0 && (
          <section className="space-y-1.5"><h3 className="text-sm font-semibold text-muted-foreground">Closed recently</h3>{q.closed.map((t) => <Row key={t.id} t={t} />)}</section>
        )}
      </div>
    </ScrollArea>
  )
}

type PanelData = { ok?: boolean; title?: string; note?: string | null; items?: { title: string; detail?: string | null; url?: string | null; at?: string | null }[]; why?: string }
// a panel the PROJECT declared in office.json; the board shows its items as given
function PanelView({ id }: { id: string }) {
  const [d, setD] = useState<PanelData | null>(null)
  useEffect(() => {
    let alive = true
    setD(null)
    const go = () => fetch('api/panel?id=' + encodeURIComponent(id), { method: 'POST' }).then((r) => r.json()).then((j) => { if (alive) setD(j) }).catch(() => { if (alive) setD({ ok: false, why: 'the board did not answer' }) })
    go(); const t = setInterval(go, 30000)
    return () => { alive = false; clearInterval(t) }
  }, [id])
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-2 px-4 py-3">
        {d === null && <Skeleton className="h-10 w-2/3" />}
        {d && (d.note || d.why || d.ok === false) && <div className={'text-xs ' + (d.ok === false ? 'text-destructive' : 'text-muted-foreground')}>{d.ok === false ? '⛔ ' : ''}{d.note ?? d.why ?? 'the panel command failed'}</div>}
        {d?.items?.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Nothing here right now.</div>}
        {d?.items?.map((x, i) => (
          <div key={i} className="rounded-lg border border-border/50 px-3 py-2">
            <div className="flex items-baseline gap-2 text-sm">
              {x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{x.title}</a> : <span className="font-medium">{x.title}</span>}
              {x.at && <span className="ml-auto flex-none text-[11px] text-muted-foreground">{when(x.at)}</span>}
            </div>
            {x.detail && <div className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{x.detail}</div>}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

export default function App() {
  const [desks, setDesks] = useState<Desk[]>([])
  const [canSend, setCanSend] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  // the office's own views beside the desks: the desk-to-desk timeline, and
  // any panel the project declared. null = the selected desk's conversation.
  const [view, setView] = useState<string | null>(null)
  const [panels, setPanels] = useState<{ id: string; title: string }[]>([])
  const [openAsks, setOpenAsks] = useState(0)
  useEffect(() => { fetch('api/panels').then((r) => r.json()).then((j) => setPanels(j.panels ?? [])).catch(() => setPanels([])) }, [])
  useEffect(() => {
    const go = () => fetch('api/timeline').then((r) => r.json()).then((j) => setOpenAsks(j.unanswered ?? 0)).catch(() => {})
    go(); const t = setInterval(go, 30000); return () => clearInterval(t)
  }, [])
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
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; setFile({ path: d.name ?? 'image', kind: 'imageurl', content: d.src }) }
    window.addEventListener('office-lightbox', h)
    return () => window.removeEventListener('office-lightbox', h)
  }, [])
  // typing "/" in the box suggests inline, the way the CLI does — the
  // dropdown button was a second place to look for a first-class behavior
  const [slashQ, setSlashQ] = useState<string | null>(null)
  const [slashIdx, setSlashIdx] = useState(0)
  const slashIdxRef = useRef(0)
  useEffect(() => {
    const h = (e: Event) => {
      const ta = e.target as HTMLTextAreaElement
      if (ta?.tagName !== 'TEXTAREA') return
      const v = ta.value
      const argOpen = /^(\/[a-z-]+)\s+(\S*)$/i.exec(v)
      setSlashQ((v.startsWith('/') && !v.includes(' ') && v.length < 40) || (argOpen && PICKERS[argOpen[1]]?.length) ? v : null)
      slashIdxRef.current = 0; setSlashIdx(0)
    }
    document.addEventListener('input', h, true)
    return () => document.removeEventListener('input', h, true)
  }, [])

  const pickCommand = useCallback((c: string) => {
    const ta = document.querySelector('textarea')
    if (ta) { ta.value = c + ' '; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus() }
    // a bare picker keeps its argument list open; anything else closes the menu
    if (!Object.prototype.hasOwnProperty.call(PICKERS, c.trim()) || !PICKERS[c.trim()].length) setSlashQ(null)
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
    // a file chosen on a phone should be visible, not behind a slide-over
    setDrawerOpen(false)
    if (!window.matchMedia('(min-width: 768px)').matches) setDrawer(null)
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
  const [outbox, setOutbox] = useState<{ text: string; at: number; via?: string }[]>([])
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
    const recent = (p?.messages ?? []).slice(-12).filter((m: Msg) => m.role === 'user' || (m.role === 'peer' && m.from === 'office board')).map((m: Msg) => norm(m.text))
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
  // the office's own checks (checks/run.mjs, live): fetched for the footer and
  // the drawer's Checks tab. A slow walk, so every five minutes, not per poll.
  useEffect(() => {
    const go = () => fetch('api/checks').then((r) => r.json()).then(setChecks).catch(() => {})
    go(); const t = setInterval(go, 300000); return () => clearInterval(t)
  }, [])
  // the Tasks count in the sidebar: what is not done yet
  const [taskCount, setTaskCount] = useState<{ n: number; title: string } | null>(null)
  useEffect(() => {
    const go = () => fetch('api/tasks').then((r) => r.json()).then((j: QueueData) => {
      const t = j?.totals
      if (t) setTaskCount({ n: t.open + t.working + t.waiting, title: t.open + ' open · ' + t.working + ' working · ' + t.waiting + ' waiting' + (t.overdue ? ' · ' + t.overdue + ' overdue' : '') })
    }).catch(() => {})
    go(); const t = setInterval(go, 60000); return () => clearInterval(t)
  }, [])
  // THE DETAILS DRAWER, closed by default: one drawer, two modes. "desk" reads
  // the selected desk (usage, workspace, agents, skills, plugins, hooks);
  // "office" reads the office (loops, checks, updates).
  const [drawer, setDrawer] = useState<null | 'desk' | 'office'>(null)
  const [drawerTab, setDrawerTab] = useState<string>('workspace')
  const openDrawer = useCallback((mode: 'desk' | 'office', tab?: string) => {
    setDrawer(mode); setDrawerTab(tab ?? (mode === 'desk' ? 'workspace' : 'loops'))
  }, [])
  // NEW: the first message since you last looked at this desk, kept per desk
  // in this browser. Read once per desk switch; written as you read.
  const [newSince, setNewSince] = useState<number | null>(null)
  useEffect(() => {
    if (!sel) return
    let v: number | null = null
    try { const s = localStorage.getItem('office-seen-' + sel); v = s ? Number(s) : null } catch { v = null }
    setNewSince(v != null && Number.isFinite(v) ? v : null)
  }, [sel])
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

  const pickDesk = (label: string) => { const d = desks.find((x) => x.label === label); if (d) { setSel(d.key); setView(null) } }
  const selDesk = desks.find((d) => d.key === sel)
  // mark this desk read up to its newest message, while the tab is in view
  useEffect(() => {
    if (!sel || !pane) return
    const d = desks.find((x) => x.key === sel)
    if (!d || pane.label !== d.label || document.visibilityState !== 'visible') return
    const last = pane.messages.reduce((a, m) => Math.max(a, m.at ? Date.parse(m.at) || 0 : 0), 0)
    if (last) try { localStorage.setItem('office-seen-' + sel, String(last)) } catch { /* a convenience */ }
  }, [sel, pane, desks])
  // ONE SIDEBAR, TWO HOMES: the desktop column and the phone's slide-over.
  // Each desk is a row: its blob with a state dot, its name, and ALWAYS one
  // line of what it is doing; teammates and background jobs fold under it.
  const deskRow = (d: Desk) => {
    const online = d.online ?? (d.activeMin != null && d.activeMin < 30)
    const waiting = !!(d.waiting || d.state === 'waiting')
    const crew = (d.agents?.length ?? 0) + (d.jobs?.length ?? 0)
    const crewActive = (d.agents ?? []).some((a) => a.activeMin < 2) || (d.jobs ?? []).some((j) => j.ageSec < 60)
    return (
      <div key={d.key}>
        <button type="button" onClick={() => { setSel(d.key); setView(null); setDrawerOpen(false) }} title={d.sub}
          aria-current={sel === d.key && !view ? 'true' : undefined} data-testid="desk-row"
          className="grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-bubble aria-[current=true]:bg-bubble">
          <DeskAvatar name={d.label} size={34} dot={waiting ? 'wait' : online ? 'on' : 'off'} />
          <span className="min-w-0">
            <span className={'block truncate text-sm font-semibold ' + (online ? '' : 'text-muted-foreground')}>{d.label}</span>
            <span className={'block truncate text-[12.5px] ' + (waiting ? 'text-wait' : 'text-muted-foreground')}>{rowLine(d)}</span>
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {d.sub.includes('LIVE') && <Badge variant="outline" className="h-4 px-1 text-[9px]">LIVE</Badge>}
            {(d.jobs?.length ?? 0) > 0 && <span className="flex items-center gap-0.5" title={d.jobs!.length + ' background job(s)'}><Clock className="size-3" />{d.jobs!.length}</span>}
            {waiting && <span className="rounded-full bg-wait-soft px-1.5 font-semibold text-wait" title="waiting on your answer">1</span>}
            {d.busy && <Spinner className="size-3.5 text-brand" />}
          </span>
        </button>
        {crew > 0 && (
          <details open={crewActive} className="mb-1 ml-[52px] mr-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer list-none py-0.5 hover:text-foreground [&::-webkit-details-marker]:hidden">
              {crew} {crew === 1 ? 'teammate' : 'teammates'}{crewActive ? ' working' : ''}
            </summary>
            <ul className="mt-0.5 space-y-1">
              {d.agents?.map((a, i) => (
                <li key={'a' + i} className="flex items-center gap-1.5" title={(a.kind === 'session' ? 'teammate session: ' : 'subagent: ') + a.label}>
                  <DeskAvatar name={a.label} size={16} />
                  <span className="truncate">{a.label} · {a.kind === 'session' ? 'teammate' : 'subagent'}, {a.activeMin < 2 ? 'now' : age(a.activeMin)}</span>
                </li>
              ))}
              {d.jobs?.map((j) => (
                <li key={j.id} className="flex items-center gap-1.5" title={'background job ' + j.id + ' · output ' + j.size + 'B'}>
                  <Clock className={'size-3.5 flex-none ' + (j.ageSec < 60 ? 'animate-pulse text-wait' : '')} />
                  <span className="truncate">{j.label || 'background · ' + j.id} · {j.ageSec < 60 ? 'running' : Math.round(j.ageSec / 60) + 'm ago'}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    )
  }
  const officeItem = (id: string, icon: React.ReactNode, label: string, count?: React.ReactNode, title?: string) => (
    <button key={id} type="button" title={title} aria-current={view === id ? 'true' : undefined}
      onClick={() => { setView(id); setDrawerOpen(false) }}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-bubble aria-[current=true]:bg-bubble">
      <span className="flex w-5 justify-center text-muted-foreground">{icon}</span><span className="min-w-0 flex-1 truncate">{label}</span>{count}
    </button>
  )
  const checkPass = checks ? checks.rows.filter((r) => r.applicable && r.code === 0).length : 0
  const checkApplies = checks ? checks.rows.filter((r) => r.applicable).length : 0
  const loopsLine = beat?.declared ? (() => {
    const m = /(\d+)\s*\/\s*(\d+)/.exec(beat.last ?? '')
    return m ? m[1] + '/' + m[2] + ' loops' + (beat.ok ? '' : ' — attention') : (beat.ok ? 'office up' : 'office needs attention')
  })() : null
  const health: 'ok' | 'wait' | 'err' = (beat?.declared && !beat.ok) || checks?.code === 4 ? 'err' : checks?.code === 7 ? 'wait' : 'ok'
  const [dark, setDark] = useState(isDark)
  const sidebar = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h1 className="text-[17px] font-semibold tracking-tight">The office</h1>
        <Button variant="ghost" size="sm" className="size-8 p-0 text-muted-foreground" title="Hire a desk" onClick={() => { setDrawerOpen(false); setHireOpen(true) }}><Plus className="size-4" /></Button>
      </div>
      <ScrollArea className="min-h-0 flex-1"><div className="px-2 pb-3">{desks.map(deskRow)}</div></ScrollArea>
      <div className="border-t border-border p-2">
        {officeItem('timeline', <ArrowLeftRight className="size-4" />, 'Between desks', openAsks > 0 ? <span className="rounded-full bg-wait-soft px-2 text-[11px] font-semibold text-wait">{openAsks} open</span> : undefined, 'every desk-to-desk message, open asks marked')}
        {officeItem('tasks', <ListTodo className="size-4" />, 'Tasks', taskCount ? <span className="rounded-full bg-bubble px-2 text-[11px] text-muted-foreground" title={taskCount.title}>{taskCount.n}</span> : undefined, 'the office-wide task queue: who is working on what, what is overdue')}
        {panels.map((p) => officeItem('panel:' + p.id, <LayoutList className="size-4" />, p.title))}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-[12.5px] text-muted-foreground">
        <span className={'size-2 flex-none rounded-full ' + (health === 'ok' ? 'bg-ok' : health === 'wait' ? 'bg-wait' : 'bg-err')} />
        <button type="button" className={'min-w-0 truncate text-left hover:text-foreground ' + (health === 'err' ? 'text-err' : '')} data-testid="health"
          title={(beat?.lines?.join('\n') || beat?.last || '') + (checks ? '\n' + checkPass + ' of ' + checkApplies + ' checks pass' : '')}
          onClick={() => openDrawer('office', loopsLine ? 'loops' : 'checks')}>
          {[loopsLine, checks ? checkPass + '/' + checkApplies + ' checks' : null].filter(Boolean).join(' · ') || 'office'}
        </button>
        <button type="button" className="ml-auto flex-none hover:text-foreground" title={dark ? 'Light mode' : 'Dark mode'} onClick={() => { chooseTheme(!dark); setDark(!dark) }}>
          {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}</button>
        <button type="button" className="flex-none hover:text-foreground" onClick={() => { setDrawerOpen(false); openDrawer('office', 'loops') }}>Office</button>
      </div>
    </div>
  )

  // shell-style history: ArrowUp in an EMPTY box recalls, per desk, surviving
  // reloads via localStorage. Not full CLI parity — that is written down as
  // remaining work, not implied away.
  const histIdx = useRef(-1)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const ta = e.target as HTMLTextAreaElement
      if (ta?.tagName !== 'TEXTAREA' || !sel) return
      // Tab completes the top slash suggestion, exactly like the CLI
      const v = ta.value
      const cmdOpen = v.startsWith('/') && !v.includes(' ')
      const argM = /^(\/[a-z-]+)\s+(\S*)$/i.exec(v)
      const argOpen = !!(argM && PICKERS[argM[1]]?.length)
      if (cmdOpen || argOpen) {
        const list = cmdOpen
          ? commandsRef.current.filter((c) => c.name.startsWith(v)).slice(0, 12).map((c) => c.name)
          : PICKERS[argM![1]].filter((a) => a.startsWith(argM![2])).slice(0, 12)
        const complete = () => {
          const pick = list[Math.min(slashIdxRef.current, Math.max(list.length - 1, 0))]
          if (!pick) return
          ta.value = cmdOpen ? pick + ' ' : argM![1] + ' ' + pick + ' '
          ta.dispatchEvent(new Event('input', { bubbles: true })); slashIdxRef.current = 0; setSlashIdx(0)
        }
        if (e.key === 'ArrowDown' && list.length) { slashIdxRef.current = (slashIdxRef.current + 1) % list.length; setSlashIdx(slashIdxRef.current); e.preventDefault(); e.stopPropagation(); return }
        if (e.key === 'ArrowUp' && list.length) { slashIdxRef.current = (slashIdxRef.current - 1 + list.length) % list.length; setSlashIdx(slashIdxRef.current); e.preventDefault(); e.stopPropagation(); return }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && list.length && (cmdOpen ? !list.includes(v) : !list.includes(argM![2])))) {
          // Enter on a PARTIAL completes; it never submits half a command
          complete(); e.preventDefault(); e.stopPropagation(); return
        }
        if (e.key === 'Escape') { setSlashQ(null); e.preventDefault(); e.stopPropagation(); return }
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

  // an option is answered with the keystroke the CLI's dialog takes (its
  // number), server-side, or refused with where it CAN be answered
  const answer = useCallback(async (option: number, label: string) => {
    if (!sel) return
    // the answer names the question it answers; a different one on screen by now is refused
    const r = await (await fetch('api/answer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: sel, option, ask: paneRef.current?.pending?.id }),
    })).json()
    setNote(r.ok ? '' : '⛔ ' + r.why)
    if (r.ok) { setOutbox((o) => [...o, { text: label, at: Date.now() }]); setTimeout(poll, 900) }
  }, [sel, poll])

  const onSubmit = useCallback(async (m: PromptInputMessage, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSend || !sel || !desks.find((d) => d.key === sel)?.route) return
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
    // ⛔ a bare picker command would open a terminal menu nobody is watching and
    // park the desk on it. Refused here, with the inline form offered instead.
    const bare = text.trim().split(/\s+/)[0]
    if (text.trim() === bare && Object.prototype.hasOwnProperty.call(PICKERS, bare)) {
      setNote('⛔ ' + bare + ' opens an interactive picker in the desk\'s terminal, which the board cannot show. Give the value inline' + (PICKERS[bare].length ? ', e.g. ' + bare + ' ' + PICKERS[bare][0] : ', or run it in the terminal itself') + '.')
      // the component form.reset()s BEFORE calling us, so a refusal hands the
      // text back right here, synchronously; a deferred restore raced the reader
      { const ta = document.querySelector('textarea'); if (ta) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })) } }
      return
    }
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
      setOutbox((o) => [...o, { text, at: Date.now(), via: r.via }])
      setSlashQ(null) // the form clears without an input event; the menu must follow
      setTimeout(poll, 800)
    }
  }, [canSend, sel, poll, desks])

  // one drawer body, two homes: the desktop column and the phone's slide-over.
  // Every tab is a READ: the desk's .claude, its usage, the office's checks.
  const bySource = <T extends { source: string }>(xs: T[]) => [...new Set(xs.map((x) => x.source))].map((src) => [src, xs.filter((x) => x.source === src)] as const)
  const empty = (t: string) => <div className="px-1 py-2 text-xs text-muted-foreground">{t}</div>
  const groupHead = (t: string) => <div className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t}</div>
  const tabPanel = (value: string, body: React.ReactNode) => (
    <TabsContent key={value} value={value} className="min-h-0 flex-1 data-[state=inactive]:hidden">
      <ScrollArea className="h-full"><div className="px-3 pb-4">{body}</div></ScrollArea>
    </TabsContent>
  )
  const u = pane?.usage ?? null
  const tok = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n)
  const usd = (n: number) => '$' + (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3))
  const ctxPct = Math.round(((u?.ctxUsed ?? 0) / (u?.ctxMax ?? 200000)) * 100)
  const modeWord = (m: string | null | undefined) => !m ? null : m === 'bypassPermissions' ? 'bypass' : m === 'acceptEdits' ? 'accept edits' : m
  const usageRow = (label: string, value: React.ReactNode, strong = false) => (
    <div className={'flex justify-between gap-3 py-1 text-[13px] ' + (strong ? 'font-semibold' : '')}><span className={strong ? '' : 'text-muted-foreground'}>{label}</span><span className="text-right">{value}</span></div>
  )
  const deskTabs: [string, React.ReactNode][] = [
    ['usage', pane ? (<div className="pt-2">
      <div className="mb-1 text-[13px] font-semibold">This session</div>
      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-bubble"><div className="h-full rounded-full bg-brand" style={{ width: Math.min(100, ctxPct) + '%' }} /></div>
      {usageRow('Model', pane.model ?? '—')}
      {usageRow('Context', tok(u?.ctxUsed ?? 0) + ' of ' + tok(u?.ctxMax ?? 200000) + ' · ' + ctxPct + '%')}
      {u && <>
        {usageRow('Turns', u.turns)}
        {usageRow('Input (fresh)', tok(u.input) + ' tok' + (u.cost ? ' · ' + usd(u.cost.input) : ''))}
        {usageRow('Output', tok(u.output) + ' tok' + (u.cost ? ' · ' + usd(u.cost.output) : ''))}
        {usageRow('Cache read', tok(u.cacheRead) + ' tok' + (u.cost ? ' · ' + usd(u.cost.cacheRead) : ''))}
        {usageRow('Cache write', tok(u.cacheWrite) + ' tok' + (u.cost ? ' · ' + usd(u.cost.cacheWrite) : ''))}
        {usageRow('Estimated total', u.cost ? usd(u.cost.total) : 'no rate for this model', true)}
      </>}
      {/* a dollar always carries its date */}
      <div className="mt-2 text-xs leading-relaxed text-muted-foreground" data-testid="rates-asof">
        {u?.cost ? 'Rates as of ' + u.cost.asOf + ' · cache read 0.1×, write 1.25× the input rate.' : 'Rates as of ' + (pane.ratesAsOf ?? '—') + '.'} An unknown model gets tokens only, never a guessed dollar.</div>
      {pane.mode && <><div className="mt-4 text-[13px] font-semibold">Permission mode</div><div className="text-[13px]">{modeWord(pane.mode)} (as recorded in the transcript)</div></>}
    </div>) : empty('no session yet')],
    ['workspace', pane?.workspace ? <WorkspaceTree ws={pane.workspace} onOpen={openFile} /> : empty('…')],
    ['agents', agents === null ? empty('…') : agents.length === 0 ? empty('no agents defined for this desk') : bySource(agents).map(([src, xs]) => (
      <div key={src} className="mb-2">{groupHead(src)}
        {xs.map((a, i) => (
          <div key={i} className="flex items-start gap-2 px-1 py-1.5" title={a.description}>
            <DeskAvatar name={a.name} size={18} />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 text-[13px] font-medium"><span className="truncate">{a.name}</span>
                {a.model && <span className="flex-none font-mono text-[11px] text-muted-foreground">{a.model.replace('claude-', '')}{a.effort ? ' · ' + a.effort : ''}</span>}</div>
              <div className="line-clamp-2 text-xs text-muted-foreground">{a.description}</div>
            </div>
          </div>
        ))}
      </div>))],
    ['skills', skills === null ? empty('…') : skills.length === 0 ? empty('no skills or commands for this desk') : bySource(skills).map(([src, xs]) => (
      <div key={src} className="mb-2">{groupHead(src)}
        {xs.map((k, i) => (
          <button key={i} type="button" className="grid w-full grid-cols-[minmax(6rem,max-content)_1fr] items-baseline gap-x-2 rounded-md px-1 py-1 text-left hover:bg-bubble" title={k.description + ' — click to type it'}
            onClick={() => pickCommand(k.name)}>
            <span className="whitespace-nowrap font-mono text-xs">{k.name}</span>
            <span className="truncate text-xs text-muted-foreground">{k.description}</span>
          </button>
        ))}
      </div>))],
    ['plugins', plugins === null ? empty('…') : plugins.length === 0 ? empty('no plugins installed') : plugins.map((pl) => (
      <div key={pl.marketplace + '/' + pl.name} className="flex items-start gap-2 px-1 py-2" title={pl.description}>
        <DeskAvatar name={pl.name} size={18} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-[13px] font-medium"><span className="truncate">{pl.name}</span><span className="flex-none font-mono text-[11px] text-muted-foreground">{pl.version}</span></div>
          {pl.description && <div className="line-clamp-2 text-xs text-muted-foreground">{pl.description}</div>}
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {[pl.agents && pl.agents + ' agents', pl.skills && pl.skills + ' skills', pl.commands && pl.commands + ' commands', pl.hooks && pl.hooks + ' hooks'].filter(Boolean).join(' · ') || 'no agents, skills, commands or hooks'} · {pl.marketplace}
          </div>
        </div>
      </div>))],
    ['hooks', hooks === null ? empty('…') : hooks.length === 0 ? empty('no hooks configured for this desk')
      : [...new Set(hooks.map((h) => h.event))].sort((a, b) => HOOK_ORDER.indexOf(a) - HOOK_ORDER.indexOf(b)).map((event) => (
        <div key={event} className="mb-1">{groupHead(event)}
          {hooks.filter((h) => h.event === event).map((h, i) => (
            <div key={i} className="px-1 py-0.5 text-xs" title={h.command}>
              <div className="truncate font-mono">{hookName(h.command)}</div>
              <div className="truncate text-muted-foreground">{h.matcher !== '*' ? h.matcher + ' · ' : ''}{h.source}</div>
            </div>
          ))}
        </div>))],
  ]
  const checkIcon = (r: { code: number; applicable: boolean }) => !r.applicable ? <MinusCircle className="size-3.5 flex-none text-muted-foreground" />
    : r.code === 0 ? <CheckCircle2 className="size-3.5 flex-none text-ok" /> : r.code === 7 ? <CircleHelp className="size-3.5 flex-none text-wait" /> : <XCircle className="size-3.5 flex-none text-err" />
  const officeTabs: [string, React.ReactNode][] = [
    ['loops', beat === null ? empty('…') : !beat.declared ? empty('This office declares no heartbeat (desk.json "heartbeat" at the root), so the board shows no loop count rather than a green light nobody earned.') : (
      <div className="pt-2 text-[13px]">
        <div className={'mb-2 font-semibold ' + (beat.ok ? '' : 'text-err')}>{loopsLine}</div>
        {(beat.lines?.length ? beat.lines : [beat.last ?? '']).map((l, i) => <div key={i} className="whitespace-pre-wrap break-words py-0.5 font-mono text-xs text-muted-foreground">{l}</div>)}
      </div>)],
    ['checks', checks === null ? empty('…') : (
      <div className="pt-2">
        <div className="mb-2 text-[13px]">{checkPass} pass · {checks.rows.filter((r) => r.applicable && r.code === 4).length} fail · {checks.rows.filter((r) => r.applicable && r.code === 7).length} unknown · {checks.rows.filter((r) => !r.applicable).length} not applicable</div>
        {[...checks.rows].sort((a, b) => Number(b.applicable) - Number(a.applicable) || (b.code === 0 ? 0 : 1) - (a.code === 0 ? 0 : 1)).map((r) => (
          <div key={r.name} className="flex items-start gap-2 py-1 text-xs" data-testid="check-row">
            <span className="pt-0.5">{checkIcon(r)}</span>
            <div className="min-w-0"><div className={'font-mono ' + (r.applicable ? '' : 'text-muted-foreground')}>{r.name}</div>{r.why && <div className="text-muted-foreground">{r.why}</div>}</div>
          </div>
        ))}
      </div>)],
    ['updates', (
      <div className="flex flex-col gap-2 pt-2 text-[13px]">
        <p className="text-xs text-muted-foreground">Neither touches a running desk: each keeps its version until it restarts.</p>
        {/* updates moved here from the floating button: same calls, same confirm */}
        <Button variant="outline" size="sm" className="justify-start gap-2" title="claude update — running desks keep their version until restarted"
          onClick={async () => {
            if (!window.confirm('Run `claude update` on the host?')) return
            setNote('updating Claude Code…')
            const r = await (await fetch('api/upgrade', { method: 'POST' })).json()
            setNote((r.ok ? '✓ ' : '⛔ ') + (r.before === r.after ? 'Claude Code already latest: ' + r.after : r.before + ' → ' + r.after) + ' — ' + r.note)
          }}><ArrowUpCircle className="size-4" /> Update Claude Code</Button>
        <Button variant="outline" size="sm" className="justify-start gap-2" title="claude plugin update office-anything — the board picks it up on its next start"
          onClick={async () => {
            if (!window.confirm('Run `claude plugin update office-anything`?')) return
            setNote('updating the office plugin…')
            const r = await (await fetch('api/upgrade-plugin', { method: 'POST' })).json()
            setNote((r.ok ? '✓ ' : '⛔ ') + (r.note || r.why || 'done'))
          }}><Building2 className="size-4" /> Update the office plugin</Button>
      </div>)],
  ]
  const drawerTabs = drawer === 'office' ? officeTabs : deskTabs
  const drawerBody = drawer && (
    <div className="flex h-full min-h-0 flex-col" data-rail="files">
      <div className="flex items-center gap-2 px-4 pb-1 pt-4">
        <span className="min-w-0 flex-1 truncate font-semibold">{drawer === 'office' ? 'The office' : (selDesk?.label ?? '…') + ' · details'}</span>
        <div className="flex flex-none rounded-lg bg-bubble p-0.5 text-xs">
          {(['desk', 'office'] as const).map((mo) => (
            <button key={mo} type="button" onClick={() => openDrawer(mo)} aria-pressed={drawer === mo}
              className="rounded-md px-2 py-0.5 text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground">{mo === 'desk' ? 'Desk' : 'Office'}</button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="size-7 flex-none p-0 text-muted-foreground" title="Close" onClick={() => setDrawer(null)}><X className="size-4" /></Button>
      </div>
      <Tabs value={drawerTabs.some(([v]) => v === drawerTab) ? drawerTab : drawerTabs[0][0]} onValueChange={(v) => setDrawerTab(String(v))} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList variant="line" className="mx-2 my-1 h-auto flex-wrap justify-start">
          {drawerTabs.map(([v]) => <TabsTrigger key={v} value={v} className="flex-none px-2 text-[13px] capitalize">{v}</TabsTrigger>)}
        </TabsList>
        {drawerTabs.map(([v, body]) => tabPanel(v, body))}
      </Tabs>
    </div>
  )

  // the conversation's own tail: blocks, the NEW divider, hand-off chips
  const convo = (() => {
    const tail = blocks.slice(-60)
    const out: React.ReactNode[] = []
    const wroteTo = new Set<string>()
    let newShown = false
    tail.forEach((b, i) => {
      if (b.kind === 'msg') {
        const at = b.m.at ? Date.parse(b.m.at) : NaN
        if (!newShown && newSince != null && b.m.role !== 'user' && at > newSince) {
          out.push(<div key="new" data-testid="new-divider" className="flex items-center gap-3 text-xs font-semibold tracking-wide text-brand before:h-px before:flex-1 before:bg-brand/35 after:h-px after:flex-1 after:bg-brand/35">NEW</div>)
          newShown = true
        }
        out.push(<MsgBlock key={'m' + i} m={b.m} rich replied={b.m.role === 'peer' && wroteTo.has(b.m.from ?? '')} />)
      } else {
        out.push(<ToolsBlock key={'t' + i} tools={b.tools} />)
        sentIn(b.tools).forEach((s, k) => { wroteTo.add(s.to); out.push(<SentChip key={'s' + i + '-' + k} s={s} />) })
      }
    })
    return out
  })()
  const crewAgents = selDesk?.agents ?? []
  const crewJobs = selDesk?.jobs ?? []
  const crewNow = crewAgents.some((a) => a.activeMin < 2) || crewJobs.some((j) => j.ageSec < 60)
  const turnLine = pane?.turn?.elapsedSec != null
    ? (pane.turn.elapsedSec >= 60 ? Math.floor(pane.turn.elapsedSec / 60) + 'm ' + (pane.turn.elapsedSec % 60) + 's' : pane.turn.elapsedSec + 's')
      + ' · ↓ ' + (pane.turn.output >= 1000 ? (pane.turn.output / 1000).toFixed(1) + 'k' : pane.turn.output) + ' tokens'
    : ''
  const outboxState = (via?: string) => via === 'inbox' ? (selDesk?.busy ? 'in its inbox — read at its next step' : 'in its inbox') : selDesk?.status === 'waiting' ? 'queued — the desk is waiting on a prompt in its terminal' : selDesk?.busy ? 'queued' : 'delivering…'

  return (
    <div className="flex h-dvh bg-background text-foreground">
      {isDesktop && <aside className="flex w-[248px] flex-none flex-col border-r border-border bg-sidebar">{sidebar}</aside>}
      {!isDesktop && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="w-[86vw] max-w-80 gap-0 bg-sidebar p-0">
            <SheetTitle className="sr-only">The office</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 px-3 py-3 md:px-7">
          {!isDesktop && <Button variant="ghost" size="sm" className="size-8 p-0" title="Desks" onClick={() => setDrawerOpen(true)}><Menu className="size-4" /></Button>}
          {view ? (<>
            {view === 'timeline' ? <ArrowLeftRight className="size-4 text-muted-foreground" /> : view === 'tasks' ? <ListTodo className="size-4 text-muted-foreground" /> : <LayoutList className="size-4 text-muted-foreground" />}
            <span className="min-w-0 truncate whitespace-nowrap text-[17px] font-semibold">{view === 'timeline' ? 'Between desks' : view === 'tasks' ? 'Tasks' : panels.find((p) => 'panel:' + p.id === view)?.title ?? view.slice(6)}</span>
            <span className="ml-auto" />
          </>) : (<>
            {pane?.label && <DeskAvatar name={pane.label} size={22} />}
            <span className="min-w-0 truncate whitespace-nowrap text-[17px] font-semibold">{pane?.label ?? '…'}</span>
            {/* live status, in the CLI's own words */}
            {selDesk && <span className={'hidden truncate whitespace-nowrap text-[13px] sm:inline ' + (selDesk.state === 'waiting' || selDesk.waiting ? 'text-wait' : 'text-muted-foreground')} data-testid="desk-status">{rowLine(selDesk)}</span>}
            <span className="ml-auto" />
            {selDesk?.remoteUrl && (
              <a href={selDesk.remoteUrl} target="_blank" rel="noreferrer" title="open this desk in the Claude app (Remote Control)"
                className={buttonVariants({ variant: 'ghost', size: 'sm' }) + ' h-8 text-[13px] text-muted-foreground'} data-testid="open-in-claude"><ExternalLink className="size-3.5 sm:mr-1" /><span className="hidden sm:inline">Claude app</span></a>
            )}
            <Button variant="ghost" size="sm" aria-pressed={showComputer} className="h-8 text-[13px] text-muted-foreground aria-pressed:bg-bubble aria-pressed:text-foreground"
              onClick={() => setShowComputer(v => !v)}><Monitor className="size-3.5 sm:mr-1" /><span className="hidden sm:inline">Computer</span></Button>
          </>)}
          <Button variant="ghost" size="sm" aria-pressed={!!drawer} className="h-8 text-[13px] text-muted-foreground aria-pressed:bg-bubble aria-pressed:text-foreground" data-testid="open-details"
            onClick={() => drawer ? setDrawer(null) : openDrawer(view ? 'office' : 'desk')}><PanelRight className="size-3.5 sm:mr-1" /><span className="hidden sm:inline">Details</span></Button>
        </header>
        {view === 'timeline' && <OfficeTimeline onPick={pickDesk} />}
        {view === 'tasks' && <TasksView />}
        {view?.startsWith('panel:') && <PanelView id={view.slice(6)} />}

        {/* ⛔ SIDE BY SIDE, owner's ruling: the mirror opens NEXT TO the
            conversation, resizable, never instead of it. On a phone the
            same pair stacks vertically — still both visible, still resizable. */}
        {!view && <ResizablePanelGroup orientation={isDesktop ? 'horizontal' : 'vertical'} className="min-h-0 flex-1">
        <ResizablePanel defaultSize={showComputer ? '55%' : '100%'} minSize="30%" className="flex min-h-0 flex-col">
          <Conversation key={sel ?? 'none'} className="flex-1">
            <ConversationContent className="mx-auto w-full max-w-[680px] gap-3.5 px-4 py-5 md:px-7">
              {!pane && (
                <div className="flex flex-col gap-3 py-4">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-16 w-4/5" />
                  <Skeleton className="h-4 w-1/3 self-end" />
                  <Skeleton className="h-10 w-3/5" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              )}
              {pane && blocks.length === 0 && <ConversationEmptyState title="Nothing yet" description="This desk has no conversation yet." />}
              {/* markdown for the WHOLE tail: memoized blocks parse once
                  per message, so the old last-15 cutoff protected nothing
                  and left older turns reading as raw asterisks */}
              {convo}
              {/* what YOU sent, faded, until the transcript shows it */}
              {outbox.map((x, i) => (
                <div key={'ob' + i} className="flex max-w-[88%] items-center justify-end gap-2 self-end text-[13px] text-muted-foreground" data-testid="outbox">
                  <span className="line-clamp-2 rounded-2xl bg-brand-soft px-3 py-1.5 text-foreground opacity-70">{x.text}</span>
                  <span className="flex-none">{outboxState(x.via)}</span>
                </div>
              ))}
              {(selDesk?.busy || crewNow) && (
                <details className="group/crew self-start" data-testid="crew">
                  <summary className="flex cursor-pointer list-none items-center gap-2.5 py-1 text-[13.5px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span className="flex">
                      {(crewAgents.length ? crewAgents.slice(0, 3).map((a) => a.label) : [selDesk?.label ?? '?']).map((n, i) => (
                        <span key={i} className={'rounded-full ring-2 ring-background ' + (i ? '-ml-1.5' : '')}><DeskAvatar name={n} size={18} /></span>))}
                    </span>
                    {(() => { const words = (crewAgents.length ? 'Teammates working' : 'Working') + (turnLine ? ' · ' + turnLine : ''); return selDesk?.busy ? <Shimmer>{words}</Shimmer> : <span>{words}</span> })()}
                    {(crewAgents.length + crewJobs.length) > 0 && <ChevronDown className="size-3.5 transition-transform group-open/crew:rotate-180" />}
                  </summary>
                  {(crewAgents.length + crewJobs.length) > 0 && (
                    <ul className="ml-1 mt-1 space-y-1 text-[13px] text-muted-foreground">
                      {crewAgents.map((a, i) => (
                        <li key={'a' + i} className="flex items-center gap-2"><DeskAvatar name={a.label} size={16} /><span className="truncate">{a.label} · {a.kind === 'session' ? 'teammate' : 'subagent'} · {a.activeMin < 2 ? 'active now' : age(a.activeMin)} · {a.turns} turns</span></li>
                      ))}
                      {crewJobs.map((j) => (
                        <li key={j.id} className="flex items-center gap-2"><Clock className={'size-3.5 flex-none ' + (j.ageSec < 60 ? 'animate-pulse text-wait' : '')} /><span className="truncate">{j.label || 'background · ' + j.id} · {j.ageSec < 60 ? 'running' : Math.round(j.ageSec / 60) + 'm ago'} · {kb(j.size)}</span></li>
                      ))}
                    </ul>
                  )}
                </details>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {pane?.pending && (
            <div className="mx-auto w-full max-w-[680px] px-4 pb-2 md:px-7">
              <div className="max-h-[40vh] overflow-y-auto rounded-2xl border border-wait bg-wait-soft px-4 py-3.5" data-testid="pending-ask">
                {pane.pending.type === 'question' ? pane.pending.questions.map((q, i) => (
                  <div key={i} className="mb-1">
                    <div className="mb-2.5 font-semibold leading-snug">{i === 0 ? 'This desk is waiting on your answer: ' : ''}{q.question}</div>
                    {pane.pending?.type === 'question' && pane.pending.questions.length === 1 && !q.multiSelect ? (<>
                      <div className="flex flex-wrap gap-2">
                        {q.options.map((o, k) => (
                          <button key={k} type="button" title={o.description} onClick={() => answer(k, o.label)}
                            className="rounded-full border border-border bg-background px-3 py-1.5 text-[13.5px] transition-colors hover:border-wait">{o.label}</button>
                        ))}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">A click picks that option in the desk's own dialog.</div>
                    </>) : (
                      <div className="text-xs text-muted-foreground">
                        {q.options.map((o) => o.label).join(' · ')}
                        <div className="mt-1">{q.multiSelect ? 'This one takes several choices' : 'This form has several questions'}, which the board does not drive. {selDesk?.remoteUrl ? <a className="underline" href={selDesk.remoteUrl} target="_blank" rel="noreferrer">Answer it in the Claude app</a> : 'Answer it in the desk\'s terminal'}.</div>
                      </div>
                    )}
                  </div>
                )) : (
                  <div>
                    <div className="mb-2 font-semibold">This desk is waiting for plan approval</div>
                    <pre className="mb-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-background/60 p-2 text-xs">{pane.pending.plan}</pre>
                    {/* a plan approval is a dialog of its own; the board does not press its keys */}
                    <div className="text-xs text-muted-foreground">{selDesk?.remoteUrl ? <a className="underline" href={selDesk.remoteUrl} target="_blank" rel="noreferrer">Approve or hold it in the Claude app</a> : 'Approve or hold it in the desk\'s terminal'}.</div>
                  </div>
                )}
              </div>
            </div>
          )}
          {note && <div className={'mx-auto w-full max-w-[680px] px-4 pb-1 text-xs md:px-7 ' + (note.startsWith('⛔') ? 'text-err' : 'text-muted-foreground')}>{note}</div>}
          <div className="mx-auto w-full max-w-[680px] px-4 pb-4 md:px-7">
            <PromptInput onSubmit={onSubmit} accept="image/*" multiple globalDrop className="[&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:bg-background [&_[data-slot=input-group]]:shadow-sm">
              <PromptInputBody>
                <PromptInputHeader><AttachChips /></PromptInputHeader>
                {slashQ && (() => {
                  const argM = /^(\/[a-z-]+)\s+(\S*)$/i.exec(slashQ)
                  const bareCmd = slashQ.trim().split(/\s+/)[0]
                  const isPicker = Object.prototype.hasOwnProperty.call(PICKERS, bareCmd)
                  if (argM && PICKERS[argM[1]]?.length) {
                    const args = PICKERS[argM[1]].filter((a) => a.startsWith(argM[2])).slice(0, 12)
                    return (
                      <div className="max-h-56 overflow-y-auto px-1 pt-1">
                        <div className="px-2 py-0.5 text-[10px] text-muted-foreground">{argM[1]} opens a picker in the terminal that the board cannot show — pick the value here instead</div>
                        {args.map((a, i) => (
                          <button key={a} type="button" onClick={() => pickCommand(argM[1] + ' ' + a)}
                            className={'grid w-full grid-cols-[1fr_auto] items-baseline gap-x-3 rounded-md px-2 py-1 text-left text-xs hover:bg-accent ' + (i === slashIdx ? 'bg-accent/50' : '')}>
                            <span className="whitespace-nowrap text-left font-mono">{a}</span>
                            <span className="text-[9px] text-muted-foreground">{i === slashIdx ? 'enter' : ''}</span>
                          </button>
                        ))}
                      </div>
                    )
                  }
                  const list = commands.filter((c) => c.name.startsWith(slashQ)).slice(0, 12)
                  return (
                    <div className="max-h-56 overflow-y-auto px-1 pt-1">
                      {/* two honest columns, CLI-style: the NAME gets the room
                          it needs and never hides; the description takes the
                          rest and fades with a truncate, left-aligned */}
                      {list.map((c, i) => (
                        <button key={c.name} type="button" onClick={() => pickCommand(c.name)}
                          className={'grid w-full grid-cols-[minmax(9rem,max-content)_1fr_auto] items-baseline gap-x-3 rounded-md px-2 py-1 text-left text-xs hover:bg-accent ' + (i === slashIdx ? 'bg-accent/50' : '')}>
                          <span className="whitespace-nowrap text-left font-mono">{c.name}</span>
                          <span className="truncate text-left text-muted-foreground" title={c.desc}>{c.desc}</span>
                          <span className="text-[9px] text-muted-foreground">{i === slashIdx ? '↵ / tab' : ''}</span>
                        </button>
                      ))}
                      {list.length === 0 && !isPicker && (
                        <span className="px-1 text-[11px] text-muted-foreground">no matching command — Enter sends it as typed</span>
                      )}
                      {isPicker && list.length <= 1 && (
                        <div className="px-2 py-1 text-[11px] text-wait">{bareCmd} opens an interactive picker in the desk's terminal. The board cannot show it, so give the value inline (e.g. {bareCmd} {PICKERS[bareCmd]?.[0] ?? '<value>'}).</div>
                      )}
                    </div>
                  )
                })()}
                <PromptInputTextarea placeholder={canSend ? composerHint(selDesk) : 'Read-only on this host: no desk inbox and no terminal reachable'} disabled={!canSend || !selDesk?.route} />
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
                </PromptInputTools>
                <PromptInputSubmit className="rounded-full" disabled={!canSend || !selDesk?.route} />
              </PromptInputFooter>
            </PromptInput>
            {/* the CLI shows mode and context at the prompt, so the board
                does too: one quiet line under the box, never in the header */}
            {pane && (
              <div className="mt-1.5 flex items-center gap-1 px-1 text-xs text-muted-foreground" data-testid="composer-status">
                <button type="button" className="rounded px-1 py-0.5 font-mono hover:text-foreground" title="Shift-Tab into this desk's terminal — the CLI cycles its permission mode there; watch the terminal for the result"
                  onClick={async () => { const r = await (await fetch('api/key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: sel, k: 'shift-tab' }) })).json(); setNote(r.ok ? 'Shift-Tab sent · the CLI keeps no live mode file, so the line reads the recorded mode and refreshes the moment the desk writes' : '⛔ ' + r.why) }}>
                  ⇧⇥</button>
                {pane.mode && <span className="whitespace-nowrap" title="permission mode, as recorded (⇧⇥ cycles it)">mode · {modeWord(pane.mode)}</span>}
                <DropdownMenu>
                  <DropdownMenuTrigger render={<button type="button" className="ml-2 rounded px-1 py-0.5 hover:text-foreground">/ commands</button>} />
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
                {pane.model && (
                  <button type="button" className="ml-auto min-w-0 truncate rounded px-1 py-0.5 text-right hover:text-foreground" title="tokens, cost and the rates' date: Details → Usage"
                    onClick={() => openDrawer('desk', 'usage')}>
                    {pane.model} · {ctxPct}% context{u?.cost ? <span className="hidden sm:inline"> · est. {usd(u.cost.total)} (rates {u.cost.asOf})</span> : null}
                  </button>
                )}
              </div>
            )}
          </div>
        </ResizablePanel>
        {showComputer && <ResizableHandle className="w-px bg-border" />}
        {showComputer && (
        <ResizablePanel defaultSize="45%" minSize="25%" className="flex min-h-0 flex-col bg-paper">
          {screen.src ? (
            <WebPreview className="min-h-0 flex-1 rounded-none border-0">
              {tabs.length > 1 && (
                <div className="flex gap-1 overflow-x-auto border-b border-border px-1 py-1">
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
              <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-bubble p-2">
                <img src={screen.src} alt="desk browser display" className="h-auto max-w-full rounded-md" />
              </div>
            </WebPreview>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">{screen.why}</div>
          )}
          {crewJobs.length > 0 && (
            <div className="border-t border-border px-3 py-2">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">background</div>
              {crewJobs.map((j) => (
                <div key={j.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className={'size-3 flex-none ' + (j.ageSec < 60 ? 'animate-pulse text-wait' : '')} />
                  <span className="truncate" title={j.id}>{j.label || j.id}</span>
                  <span className="ml-auto flex-none">{j.ageSec < 60 ? 'running' : Math.round(j.ageSec / 60) + 'm ago'} · {kb(j.size)}</span>
                </div>
              ))}
            </div>
          )}
        </ResizablePanel>
        )}
        </ResizablePanelGroup>}
      </main>

      {isDesktop && drawer && <aside className="flex w-[340px] flex-none flex-col border-l border-border bg-paper">{drawerBody}</aside>}
      {!isDesktop && (
        <Sheet open={!!drawer} onOpenChange={(o) => { if (!o) setDrawer(null) }}>
          <SheetContent side="right" className="w-[90vw] max-w-96 gap-0 bg-paper p-0">
            <SheetTitle className="sr-only">Details</SheetTitle>
            {drawerBody}
          </SheetContent>
        </Sheet>
      )}
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
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle className="flex min-w-0 items-center gap-2 pr-6">
              <span className="truncate font-mono text-sm select-all" title="long-press or triple-click selects the whole path">{file?.path}</span>
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
                    // iOS Safari: execCommand copies only from an editable,
                    // explicitly-ranged selection made inside the gesture
                    try {
                      const ta = document.createElement('textarea'); ta.value = file.path
                      ta.contentEditable = 'true'; ta.readOnly = false
                      ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '0'; ta.style.opacity = '0'; ta.style.fontSize = '16px'
                      document.body.appendChild(ta)
                      const range = document.createRange(); range.selectNodeContents(ta)
                      const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range)
                      ta.setSelectionRange(0, file.path.length)
                      ok = document.execCommand('copy'); ta.remove(); sel?.removeAllRanges()
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
    </div>
  )
}
