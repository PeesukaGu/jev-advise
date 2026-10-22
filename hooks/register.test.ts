import { expect, test } from 'claude-code/testing'

const JEV_OUT = JSON.stringify({ answers: { q: { choice: 'o0', confidence: 0.9, probabilities: { o0: 0.8, o1: 0.2 } } } })

function standInEngine(on: Parameters<Parameters<typeof test>[1]>[1], sent: string[]) {
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'which db?', toolUses: [] },
      { role: 'assistant', text: 'I recommend SQLite', toolUses: [] },
    ],
  }))
  on('process.run', (_, e) => {
    sent.push(JSON.stringify(e))
    return { value: { exitCode: 0, stdout: JEV_OUT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

test('a plain-text question split across batches is shown with jev tags', async ($, on) => {
  const sent: string[] = []
  standInEngine(on, sent)
  on('classic.MessageDisplay', () => ({}))
  const base = { turn_id: 't', message_id: 'm' }

  const first = await $.classic.MessageDisplay({ ...base, index: 0, final: false, delta: 'intro\n**Q1** - **DB**: which?\n- A. SQLite: embedded\n' })
  expect(first.displayContent).toBe('intro\n')

  const second = await $.classic.MessageDisplay({ ...base, index: 1, final: true, delta: '- B. PostgreSQL: server\n\n推奨: A\n' })
  expect(second.displayContent).toBe('**Q1** - **DB**: which?\n- A. SQLite: embedded `[jev 推奨 0.80]`\n- B. PostgreSQL: server `[jev 0.20]`\n\n推奨: A\n')

  // Neither the recommendation line nor Claude's text of this turn reaches jev.
  expect(sent.join()).not.toContain('推奨: A')
  expect(sent.join()).not.toContain('I recommend SQLite')
})

test('text without the question format is left alone', async ($, on) => {
  standInEngine(on, [])
  on('classic.MessageDisplay', () => ({}))

  const shown = await $.classic.MessageDisplay({ turn_id: 't', message_id: 'n', index: 0, final: true, delta: 'just text\n- A. not a question\n' })
  expect(shown.displayContent).toBeUndefined()
})

test('AskUserQuestion descriptions get jev tags and labels stay', async ($, on) => {
  const sent: string[] = []
  standInEngine(on, sent)
  let drawn: unknown
  on('tool.call', (_, e) => {
    drawn = e
    return { result: {} }
  })

  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: 'DB?', header: 'DB', multiSelect: false, options: [
      { label: 'SQLite (Recommended)', description: 'embedded' },
      { label: 'PostgreSQL', description: 'server' },
    ] }],
  })

  expect(JSON.stringify(drawn)).toContain('"label":"SQLite (Recommended)","description":"[jev 推奨 0.80] embedded"')
  expect(JSON.stringify(drawn)).toContain('"description":"[jev 0.20] server"')
  expect(sent.join()).not.toContain('Recommended')
})
