import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const SCRIPT = new URL('../scripts/jev-advise.mjs', import.meta.url).pathname
const ANSWER = { answers: { q: { choice: 'o0', confidence: 0.9, probabilities: { o0: 0.8, o1: 0.2 } } } }

function setup(answer = ANSWER) {
  const dir = mkdtempSync(join(tmpdir(), 'jev-advise-test-'))
  const sent = join(dir, 'sent.log')
  // A stand-in jev that records its arguments and stdin, then answers.
  writeFileSync(join(dir, 'jev'), `#!/bin/sh\nfor a in "$@"; do case "$a" in @*) cat "\${a#@}" >> '${sent}' ;; *) printf '%s\\n' "$a" >> '${sent}' ;; esac; done\ncat >> '${sent}'\nprintf '%s' '${JSON.stringify(answer)}'\n`)
  chmodSync(join(dir, 'jev'), 0o755)
  const transcript = join(dir, 'transcript.jsonl')
  writeFileSync(transcript, [
    { message: { role: 'user', content: 'which db?<system-reminder>secret</system-reminder>' } },
    { message: { role: 'assistant', content: [{ type: 'text', text: 'I recommend SQLite' }] } },
  ].map(e => JSON.stringify(e)).join('\n'))
  const run = (input, options = {}) => {
    const r = spawnSync('node', [SCRIPT], {
      input: JSON.stringify({ transcript_path: transcript, ...input }),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CLAUDE_PLUGIN_DATA: dir, ...options },
    })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null
  }
  return { run, sent: () => { try { return readFileSync(sent, 'utf8') } catch { return '' } } }
}

test('a plain-text question split across batches is shown with jev tags', () => {
  const { run, sent } = setup()
  const base = { hook_event_name: 'MessageDisplay', turn_id: 't', message_id: 'm' }

  const first = run({ ...base, index: 0, final: false, delta: 'intro\n**Q1** - **DB**: which?\n- A. SQLite: embedded\n' })
  assert.equal(first.displayContent, 'intro\n')

  const second = run({ ...base, index: 1, final: true, delta: '- B. PostgreSQL: server\n\nRecommendation: A\n' })
  assert.equal(second.displayContent, '**Q1** - **DB**: which?\n- A. SQLite: embedded `[jev pick 0.80]`\n- B. PostgreSQL: server `[jev 0.20]`\n\nRecommendation: A\n')

  assert.doesNotMatch(sent(), /Recommendation: A/)
  assert.doesNotMatch(sent(), /I recommend SQLite/)
  assert.doesNotMatch(sent(), /secret/)
  assert.match(sent(), /which db\?/)
})

test('text without the question format is left alone', () => {
  const { run, sent } = setup()
  const shown = run({ hook_event_name: 'MessageDisplay', turn_id: 't', message_id: 'n', index: 0, final: true, delta: 'just text\n- A. not a question\n' })
  assert.equal(shown, null)
  assert.equal(sent(), '')
})

test('a low-confidence answer shows probabilities without a pick', () => {
  const { run } = setup({ answers: { q: { choice: 'o0', confidence: 0.3, probabilities: { o0: 0.6, o1: 0.4 } } } })
  const shown = run({ hook_event_name: 'MessageDisplay', turn_id: 't', message_id: 'l', index: 0, final: true, delta: '**Q1** - **X**: y?\n- A. a: b\n- B. c: d\n' })
  assert.match(shown.displayContent, /a: b `\[jev 0\.60\]`/)
  assert.doesNotMatch(shown.displayContent, /pick/)
})

test('AskUserQuestion descriptions get jev tags, labels stay, and the dialog still asks', () => {
  const { run, sent } = setup()
  const out = run({
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question: 'DB?', header: 'DB', multiSelect: false, options: [
      { label: 'SQLite (Recommended)', description: 'embedded' },
      { label: 'PostgreSQL', description: 'server' },
    ] }] },
  })
  assert.equal(out.permissionDecision, 'ask')
  assert.deepEqual(out.updatedInput.questions[0].options, [
    { label: 'SQLite (Recommended)', description: '[jev pick 0.80] embedded' },
    { label: 'PostgreSQL', description: '[jev 0.20] server' },
  ])
  assert.doesNotMatch(sent(), /Recommended/)
})

test('a jev that cannot run is reported on the options', () => {
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', transcript_path: '', tool_input: { questions: [{ question: 'DB?', header: 'DB', options: [{ label: 'A', description: 'x' }, { label: 'B', description: '' }] }] } }),
    encoding: 'utf8',
    env: { ...process.env, PATH: '/nonexistent' },
  })
  const out = JSON.parse(r.stdout).hookSpecificOutput
  assert.deepEqual(out.updatedInput.questions[0].options.map(o => o.description), ['[jev failed] x', '[jev failed]'])
})

const ASK = {
  hook_event_name: 'PreToolUse',
  tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: 'DB?', header: 'DB', multiSelect: false, options: [{ label: 'SQLite', description: 'embedded' }, { label: 'PostgreSQL', description: 'server' }] }] },
}

test('auto-select answers with the pick when Jev picks every question', () => {
  const { run } = setup()
  const out = run(ASK, { CLAUDE_PLUGIN_OPTION_AUTO_SELECT: 'true' })
  assert.equal(out.permissionDecision, 'allow')
  assert.deepEqual(out.updatedInput.answers, { 'DB?': 'SQLite' })
  assert.match(out.additionalContext, /the user did not pick/)
})

test('auto-select leaves the dialog to the user below the threshold', () => {
  const { run } = setup()
  const out = run(ASK, { CLAUDE_PLUGIN_OPTION_AUTO_SELECT: 'true', CLAUDE_PLUGIN_OPTION_PICK_THRESHOLD: '0.95' })
  assert.equal(out.permissionDecision, 'ask')
  assert.equal(out.updatedInput.answers, undefined)
  assert.equal(out.updatedInput.questions[0].options[0].description, '[jev 0.80] embedded')
})

test('auto-select skips multi-select questions', () => {
  const { run } = setup()
  const multi = structuredClone(ASK)
  multi.tool_input.questions[0].multiSelect = true
  assert.equal(run(multi, { CLAUDE_PLUGIN_OPTION_AUTO_SELECT: 'true' }).permissionDecision, 'ask')
})

test('a lower threshold turns a weak answer into a pick', () => {
  const { run } = setup({ answers: { q: { choice: 'o0', confidence: 0.3, probabilities: { o0: 0.6, o1: 0.4 } } } })
  const out = run(ASK, { CLAUDE_PLUGIN_OPTION_PICK_THRESHOLD: '0.2' })
  assert.equal(out.updatedInput.questions[0].options[0].description, '[jev pick 0.60] embedded')
})

test('SessionStart adds the question format to the context', () => {
  const { run } = setup()
  const out = run({ hook_event_name: 'SessionStart', source: 'startup' })
  assert.match(out.additionalContext, /\*\*Q1\*\* - \*\*<title>\*\*/)
})
