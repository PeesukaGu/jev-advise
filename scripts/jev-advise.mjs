#!/usr/bin/env node
// Adds Jev's probabilities to the choices Claude offers. Display only: it never decides.
//
// - SessionStart: asks Claude to write plain-text questions in the format below
// - PreToolUse(AskUserQuestion): prefixes each option's description
// - MessageDisplay: tags plain-text options on screen only, so Claude never reads them
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MAX_CONTEXT_CHARS = 3000
// Measured on 221 past answers: confidence >= 0.6 matched the user 72% of the
// time, below it 45-60%, too close to a coin flip to call a pick.
const DEFAULT_PICK_THRESHOLD = 0.6
const configured = Number.parseFloat(process.env.CLAUDE_PLUGIN_OPTION_PICK_THRESHOLD ?? '')
const PICK_THRESHOLD = configured >= 0 && configured <= 1 ? configured : DEFAULT_PICK_THRESHOLD
const AUTO_SELECT = ['true', '1'].includes(String(process.env.CLAUDE_PLUGIN_OPTION_AUTO_SELECT).toLowerCase())

const Q_START = /^\s*\**Q\d+\**\s*[-:：]/
const OPTION = /^\s*[-*]\s+([A-Z])\.\s+(.+?)\s*$/
const Q_END = /^\s*\**(Recommendation|推奨)\**\s*[:：]/i
const RECOMMENDED_MARK = /\s*[(（]\s*(Recommended|推奨|おすすめ)\s*[)）]/gi
// Text Claude Code writes into user messages: reminders, `!` command input and
// output, slash command output, and background task notifications. Any of it
// can hold secrets the user printed, so none of it is sent to Jev.
const MACHINE_BLOCK = /<(system-reminder|bash-input|bash-stdout|bash-stderr|local-command-stdout|local-command-stderr|local-command-caveat|command-name|command-message|command-args|task-notification)>[\s\S]*?<\/\1>/g

const FORMAT_RULE = `When you ask the user a multiple-choice question in your reply instead of with AskUserQuestion (a grilling round, for one), write each question in this format, every line starting at the left margin:

**Q1** - **<title>**: <question>
- A. <option>: <description>
- B. <option>: <description>

Recommendation: <the option you recommend and why>

Never run \`jev\` yourself or add probabilities to the options: the jev-advise plugin adds them to the display only, so neither your recommendation nor Jev's influences the other.`

function recentContext(transcriptPath) {
  if (!transcriptPath) return ''
  let lines
  try {
    lines = readFileSync(transcriptPath, 'utf8').split('\n')
  } catch {
    return ''
  }
  const texts = []
  let lastUser = -1
  for (const line of lines) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const msg = entry.message ?? {}
    if (msg.role !== 'user' && msg.role !== 'assistant') continue
    // Skill bodies, images and compact summaries arrive as user messages the user did not type.
    if (entry.isMeta || entry.isCompactSummary) continue
    const content = msg.content
    const parts = (typeof content === 'string'
      ? [content]
      : Array.isArray(content) ? content.filter(c => c?.type === 'text').map(c => c.text) : [])
      .map(p => p.replace(MACHINE_BLOCK, '').trim())
      .filter(Boolean)
    if (msg.role === 'user' && parts.length) lastUser = texts.length
    for (const p of parts) texts.push(`${msg.role}: ${p}`)
  }
  // Claude's text in the current turn may hold its recommendation, so Jev never sees it.
  return texts.slice(0, lastUser + 1).join('\n').slice(-MAX_CONTEXT_CHARS)
}

function jevChoose(context, question, options) {
  const criteria = Object.fromEntries(options.map((o, i) => [`o${i}`, o.replace(RECOMMENDED_MARK, '')]))
  const questions = {
    q: { type: 'choice', instructions: `Which option should the user choose? Question: ${question.replace(RECOMMENDED_MARK, '')}`, criteria },
  }
  // Conversation text goes through a file, never argv: on Windows jev is a .cmd
  // shim that needs a shell, and cmd.exe would interpret the text.
  const dir = mkdtempSync(join(tmpdir(), 'jev-advise-'))
  const stateFile = join(dir, 'state.txt')
  writeFileSync(stateFile, `Recent conversation:\n${context}`)
  const isWindows = process.platform === 'win32'
  let ran
  try {
    ran = spawnSync('jev', [
      'ask', isWindows ? `"@${stateFile}"` : `@${stateFile}`, '--questions', '-', '--json', '--timeout', '15000',
    ], { input: JSON.stringify(questions), encoding: 'utf8', timeout: 20000, shell: isWindows })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  if (ran.error) throw ran.error
  if (ran.status !== 0) throw new Error(ran.stderr.trim() || `jev exited ${ran.status}`)
  return JSON.parse(ran.stdout).answers.q
}

function tag(answer, i) {
  const p = (answer.probabilities?.[`o${i}`] ?? 0).toFixed(2)
  const isPick = answer.choice === `o${i}` && isPicked(answer)
  return `[${isPick ? 'jev pick' : 'jev'} ${p}]`
}

function isPicked(answer) {
  return (answer.confidence ?? 0) >= PICK_THRESHOLD
}

function adviseQuestions(data) {
  const context = recentContext(data.transcript_path)
  const answers = {}
  let isEveryQuestionPicked = true
  const questions = (data.tool_input.questions ?? []).map(q => {
    const options = q.options ?? []
    let answer
    try {
      answer = jevChoose(context, q.question ?? '', options.map(o => `${o.label ?? ''}: ${o.description ?? ''}`))
    } catch {
      isEveryQuestionPicked = false
      return { ...q, options: options.map(o => ({ ...o, description: o.description ? `[jev failed] ${o.description}` : '[jev failed]' })) }
    }
    const picked = options[Number(answer.choice?.slice(1))]
    if (!q.multiSelect && picked && isPicked(answer)) answers[q.question] = picked.label
    else isEveryQuestionPicked = false
    // Labels come back to Claude as the answer, so only descriptions change.
    return { ...q, options: options.map((o, i) => ({ ...o, description: o.description ? `${tag(answer, i)} ${o.description}` : tag(answer, i) })) }
  })
  // Auto-select answers only when Jev picked every question; otherwise the user answers them all.
  return { input: { ...data.tool_input, questions }, answers: AUTO_SELECT && isEveryQuestionPicked ? answers : null }
}

function annotateBlock(lines, context) {
  const opts = lines.flatMap((l, i) => {
    const m = OPTION.exec(l)
    return m ? [{ i, text: m[2] }] : []
  })
  if (opts.length < 2) return lines
  // Claude's own recommendation line stays out of what Jev reads.
  const question = lines.filter(l => !OPTION.test(l) && !Q_END.test(l)).join('').trim()
  let answer
  try {
    answer = jevChoose(context, question, opts.map(o => o.text))
  } catch {
    return [...lines, '[jev failed]\n']
  }
  const out = [...lines]
  opts.forEach(({ i }, k) => {
    const nl = out[i].endsWith('\n') ? '\n' : ''
    out[i] = `${out[i].trimEnd()} \`${tag(answer, k)}\`${nl}`
  })
  return out
}

function displayMessage(data) {
  // One question can span several display batches, so lines from its first
  // line to its recommendation line are held back and shown together.
  const dir = join(process.env.CLAUDE_PLUGIN_DATA || tmpdir(), 'jev-advise-held')
  const heldPath = join(dir, `${String(data.message_id).replace(/[^\w-]/g, '_')}.json`)
  let held = null
  try {
    held = JSON.parse(readFileSync(heldPath, 'utf8'))
  } catch {}
  let changed = held !== null
  let context = null
  const out = []
  const flush = lines => {
    context ??= recentContext(data.transcript_path)
    out.push(...annotateBlock(lines, context))
  }
  for (const line of data.delta.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (Q_START.test(line)) {
      if (held) flush(held)
      held = [line]
      changed = true
    } else if (held) {
      held.push(line)
      if (Q_END.test(line)) {
        flush(held)
        held = null
      }
    } else {
      out.push(line)
    }
  }
  if (data.final && held) {
    flush(held)
    held = null
  }
  if (held) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(heldPath, JSON.stringify(held))
  } else {
    rmSync(heldPath, { force: true })
  }
  return changed ? out.join('') : null
}

function main() {
  const data = JSON.parse(readFileSync(0, 'utf8'))
  const reply = output => process.stdout.write(JSON.stringify({ hookSpecificOutput: output }))
  switch (data.hook_event_name) {
    case 'SessionStart':
      reply({ hookEventName: 'SessionStart', additionalContext: FORMAT_RULE })
      break
    case 'PreToolUse':
      if (data.tool_name !== 'AskUserQuestion') break
    {
      const { input, answers } = adviseQuestions(data)
      if (answers) {
        reply({
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: { ...input, answers },
          additionalContext: 'jev-advise auto-select chose these answers with Jev; the user did not pick them.',
        })
      } else {
        // "allow" without answers would skip the dialog and answer nothing, so "ask" shows the rewritten questions.
        reply({ hookEventName: 'PreToolUse', permissionDecision: 'ask', updatedInput: input })
      }
      break
    }
    case 'MessageDisplay': {
      const shown = displayMessage(data)
      if (shown !== null) reply({ hookEventName: 'MessageDisplay', displayContent: shown })
      break
    }
  }
}

main()
