import type { EngineInterface, Register } from 'claude-code'

const MAX_CONTEXT_CHARS = 3000
// Measured on 221 past answers: confidence >= 0.6 matched the user 72% of the
// time, below it 51-54%, too close to a coin flip to call a recommendation.
const RECOMMEND_MIN_CONF = 0.6

// Plain-text questions are picked up only in the format FORMAT_SECTION asks for.
const Q_START = /^\s*\**Q\d+\**\s*[-:：]/
const OPTION = /^\s*[-*]\s+([A-Z])\.\s+(.+?)\s*$/
const Q_END = /^\s*\**(推奨|Recommendation)\**\s*[:：]/i
const RECOMMENDED_MARK = /\s*[(（]\s*(Recommended|推奨|おすすめ)\s*[)）]/gi
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

const FORMAT_SECTION = `# Multiple-choice questions in plain text

When you ask the user a multiple-choice question in your reply instead of with AskUserQuestion (a grilling round, for one), write each question in this format, every line starting at the left margin:

**Q1** - **<title>**: <question>
- A. <option>: <description>
- B. <option>: <description>

推奨: <the option you recommend and why>

Write \`Recommendation:\` in place of \`推奨:\` when you reply in a language other than Japanese. Never run \`jev\` yourself or add probabilities to the options: the jev-advise plugin adds them to the display only, so neither your recommendation nor Jev's influences the other.`

type Answer = { choice?: string; confidence?: number; probabilities?: Record<string, number> }
type Option = { label?: string; description?: string }
type Question = { question?: string; options?: Option[] }

async function recentContext($: EngineInterface): Promise<string> {
  const messages = await $.session.messages()
  // Cut at the user's last prompt: Claude's text in this turn may hold its recommendation.
  let lastUser = -1
  messages.forEach((m, i) => {
    if (m.role === 'user' && m.text && !m.toolResults?.length && !m.text.startsWith('Base directory for this skill')) lastUser = i
  })
  return messages
    .slice(0, lastUser + 1)
    .filter(m => m.text)
    .map(m => `${m.role}: ${m.text.replace(REMINDER, '').trim()}`)
    .join('\n')
    .slice(-MAX_CONTEXT_CHARS)
}

async function jevChoose($: EngineInterface, context: string, question: string, options: string[]): Promise<Answer> {
  const criteria = Object.fromEntries(options.map((o, i) => [`o${i}`, o.replace(RECOMMENDED_MARK, '')]))
  const questions = {
    q: { type: 'choice', instructions: `ユーザーが選ぶべき最善の選択肢はどれか。質問: ${question.replace(RECOMMENDED_MARK, '')}`, criteria },
  }
  const ran = await $.process.run(
    ['jev', 'ask', `直近の会話:\n${context}`, '--questions', '-', '--json', '--timeout', '15000'],
    { stdin: JSON.stringify(questions), timeoutMs: 20000 },
  )
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `jev exited ${ran.exitCode}`)
  return JSON.parse(ran.stdout).answers.q
}

function tag(a: Answer, i: number): string {
  const p = (a.probabilities?.[`o${i}`] ?? 0).toFixed(2)
  const isPick = a.choice === `o${i}` && (a.confidence ?? 0) >= RECOMMEND_MIN_CONF
  return `[${isPick ? 'jev 推奨' : 'jev'} ${p}]`
}

async function annotateBlock($: EngineInterface, lines: string[], context: string): Promise<string[]> {
  const opts = lines.flatMap((l, i) => {
    const m = OPTION.exec(l)
    return m?.[2] ? [{ i, text: m[2] }] : []
  })
  if (opts.length < 2) return lines
  // Claude's own recommendation line stays out of what Jev reads.
  const question = lines.filter(l => !OPTION.test(l) && !Q_END.test(l)).join('').trim()
  let a: Answer
  try {
    a = await jevChoose($, context, question, opts.map(o => o.text))
  } catch {
    return [...lines, '[jev 判定失敗]\n']
  }
  const out = [...lines]
  opts.forEach(({ i }, k) => {
    const line = out[i] ?? ''
    const nl = line.endsWith('\n') ? '\n' : ''
    out[i] = `${line.trimEnd()} \`${tag(a, k)}\`${nl}`
  })
  return out
}

// One question can span several display batches, so lines from a question's
// first line to its recommendation line are held back and shown together.
const held = new Map<string, string[]>()

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections, { id: 'jev-advise:format', text: FORMAT_SECTION, scope: 'session' }] }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const qs = e.questions as Question[]
    let context: string
    try {
      context = await recentContext($)
    } catch {
      return next(e)
    }
    const annotated = await Promise.all(qs.map(async q => {
      const options = q.options ?? []
      try {
        const a = await jevChoose($, context, q.question ?? '', options.map(o => `${o.label ?? ''}: ${o.description ?? ''}`))
        // Labels come back to Claude as the answer, so only descriptions change.
        return { ...q, options: options.map((o, i) => ({ ...o, description: o.description ? `${tag(a, i)} ${o.description}` : tag(a, i) })) }
      } catch {
        return q
      }
    }))
    return next({ ...e, questions: annotated } as typeof e)
  })

  on('classic.MessageDisplay', async ($, e, next) => {
    let buf = held.get(e.message_id) ?? null
    let changed = buf !== null
    let context: string | null = null
    const out: string[] = []
    const flush = async (lines: string[]) => {
      context ??= await recentContext($).catch(() => '')
      out.push(...await annotateBlock($, lines, context))
    }
    for (const line of e.delta.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      if (Q_START.test(line)) {
        if (buf) await flush(buf)
        buf = [line]
        changed = true
      } else if (buf) {
        buf.push(line)
        if (Q_END.test(line)) {
          await flush(buf)
          buf = null
        }
      } else {
        out.push(line)
      }
    }
    if (e.final && buf) {
      await flush(buf)
      buf = null
    }
    if (buf) held.set(e.message_id, buf)
    else held.delete(e.message_id)
    return changed ? { displayContent: out.join('') } : next(e)
  })
}
