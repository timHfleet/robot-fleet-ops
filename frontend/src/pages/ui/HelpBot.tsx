import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Loader2, MessageCircleQuestion, Send, X } from 'lucide-react'
import { callApi } from '../../lib/api'
import { cn } from '../../lib/shadcn/utils'

type Msg = { role: 'user' | 'assistant'; content: string }
type AskResult = { answer: string; configured: boolean }

const SUGGESTIONS: Record<string, string[]> = {
  '/': ['How is the fleet doing this week?', 'Why are the last two days lower?', 'What does goal attainment mean?'],
  '/quality': ['What is the main reason episodes get rejected?', 'Is our pass rate healthy?'],
  '/uptime': ['Which robot is the least reliable right now?', 'What are MTBF and MTTR?'],
  '/efficiency': ['Why is operator utilization below 60%?', 'What drives cost per usable episode?'],
  '/maintenance': ['Which robots should we service first, and why?', 'How is the risk score calculated?'],
  '/coverage': ['Which shift is hardest to staff?', 'What is the shift fill rate?'],
  '/incidents': ['Is the incident rate on target?', 'What are the most common root causes?'],
}
const DEFAULT_SUGGESTIONS = ['What does this page show?', 'How is the fleet doing this week?', 'Is this data real?']

/** Minimal formatting for answers: paragraphs, "- " bullets and **bold**. */
function Rich({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
    )
  const blocks = text.split(/\n{2,}/)
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split('\n')
        if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
          return (
            <ul key={i} className="my-1 list-disc space-y-0.5 pl-5">
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>)}
            </ul>
          )
        }
        return <p key={i} className="my-1 whitespace-pre-wrap">{inline(b)}</p>
      })}
    </>
  )
}

export default function HelpBot() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    const next: Msg[] = [...messages, { role: 'user', content: q }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const r = await callApi<AskResult>('help/ask', { messages: next, page: pathname })
      setMessages([...next, { role: 'assistant', content: r.answer }])
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: `Sorry, something went wrong: ${(e as Error).message}` }])
    } finally {
      setBusy(false)
    }
  }

  const suggestions = SUGGESTIONS[pathname] ?? DEFAULT_SUGGESTIONS

  return (
    <div className="print:hidden">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessageCircleQuestion className="h-4 w-4" aria-hidden />
          Ask about this data
        </button>
      )}
      {open && (
        <section
          aria-label="Help assistant"
          className="fixed bottom-5 right-5 z-40 flex h-[min(560px,calc(100vh-2.5rem))] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-2xl"
        >
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Data help</h2>
              <p className="text-xs text-muted-foreground">Ask what a number means or why it changed.</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close help"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  I know every metric on this dashboard and see today's live numbers. Try:
                </p>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="block w-full rounded-lg border px-3 py-2 text-left hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3 py-2 leading-relaxed',
                    m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
                  )}
                >
                  {m.role === 'user' ? <p className="whitespace-pre-wrap">{m.content}</p> : <Rich text={m.content} />}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Looking at the data…
              </div>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault()
              ask(input)
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  ask(input)
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Ask a question…"
              className="max-h-28 min-h-[38px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          <p className="px-3 pb-2 text-[11px] text-muted-foreground">AI answers can be wrong; check the numbers on the page.</p>
        </section>
      )}
    </div>
  )
}
