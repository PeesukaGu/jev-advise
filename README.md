# jev-advise

[日本語](README.ja.md)

A Claude Code plugin that shows [Jev](https://docs.typesafe.ai)'s probabilities next to the choices Claude offers you. By default it only displays them and you make the choice. Turn on [`auto_select`](#settings) to let Jev answer AskUserQuestion for you when it is confident.

- **AskUserQuestion**: each option's description starts with `[jev 0.80]`.
- **Plain-text questions** (a grilling round, for one): each option line ends with `` `[jev 0.80]` ``. The plugin adds a short note to the session context that asks Claude to write these questions in a fixed format, and it only tags questions in that format.
- `jev pick` marks Jev's top option, but only when its confidence reaches [`pick_threshold`](#settings), 0.6 by default. On 221 real answers, Jev matched the user 72% of the time above that line and 45–60% below it.

Claude and Jev do not see each other's recommendation:

- The tags are added to what you see only. Claude never reads Jev's output. The one exception is `auto_select`: when it answers for you, Claude receives Jev's pick as the answer, with a note that Jev chose it.
- Jev reads the conversation up to your last prompt, at most the last 3000 characters. It does not see Claude's text from the current turn. `(Recommended)` marks and the `Recommendation:` line are removed before anything is sent to Jev.

## Requirements

- Claude Code (tested on 2.1.308)
- The `jev` CLI on your `PATH`, with a TypeSafe API key. `jev` runs on Node.js 20.12 or newer, which this plugin uses too.

  ```sh
  npm install -g jevctl
  jev auth login
  ```

  Store the key with `jev auth login`, not only in a shell variable. Hooks do not load your shell profile, so a key exported there may be missing when Claude Code is started from an app instead of a terminal. `node` and `jev` must also be on the `PATH` that Claude Code starts with. When `jev` cannot run, options show `[jev failed]`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install jev-advise --marketplace PeesukaGu/jev-advise
```

Answer `y` to add the marketplace, then choose a scope.

From a shell:

```sh
claude plugin install jev-advise --marketplace PeesukaGu/jev-advise
```

## Usage

There is nothing to run. Once the plugin is installed, the tags appear whenever Claude asks you to choose.

### AskUserQuestion

When Claude asks you something like "Which database should we use?", the dialog shows Jev's probability at the start of each description. Claude's own `(Recommended)` mark stays on the label, so you can compare the two:

```
Which database should we use?

❯ 1. SQLite (Recommended)
     [jev pick 0.82] Embedded, no server to run
  2. PostgreSQL
     [jev 0.18] Server-based, built for production
```

When Jev's confidence is below 0.6, no option is marked `jev pick`, and you see the probabilities only:

```
  1. Ship this week
     [jev 0.55] Fix the remaining bugs after release
  2. Wait a week
     [jev 0.45] Release once every known bug is fixed
```

### Plain-text questions

Ask Claude to question you in its reply, for example "Grill me on this plan before we start" or "Ask me what you need to decide the schema". Claude writes each question in the plugin's format, and the tags appear at the end of each option line:

```
**Q1** - **Auth**: How should users sign in?
- A. Email and password: simplest to build `[jev 0.31]`
- B. Google sign-in: no passwords to store `[jev pick 0.69]`

Recommendation: B, since the app already uses Google Workspace
```

A question shows up a moment later than the text around it, because the plugin waits for the `Recommendation:` line before it asks Jev.

## Settings

Change these in `/config`, or under `pluginConfigs` in `~/.claude/settings.json`:

| Setting | Default | What it does |
| --- | --- | --- |
| `auto_select` | `false` | Answers AskUserQuestion with Jev's pick, without showing you the dialog, when Jev picks every question in it. If any question has no pick, or allows several answers, the dialog appears as usual. Claude is told that Jev chose the answers. Plain-text questions are never answered for you. |
| `pick_threshold` | `0.6` | The lowest Jev confidence, from 0 to 1, that counts as a pick. It sets both where `jev pick` appears and what `auto_select` answers. |

On 221 past answers, Jev's pick matched the user's own choice about 70% of the time at every threshold we tried. A higher threshold only makes picks rarer:

| `pick_threshold` | Questions with a pick | Pick matched the user |
| --- | --- | --- |
| 0.5 | 47% | 72% |
| 0.6 | 35% | 71% |
| 0.7 | 27% | 67% |
| 0.8 | 16% | 64% |

With `auto_select` on, expect about one auto-selected answer in three or four to differ from what you would have chosen, whatever the threshold.

```json
"pluginConfigs": {
  "jev-advise@jev-advise": {
    "options": { "auto_select": true, "pick_threshold": 0.8 }
  }
}
```

## What is sent to TypeSafe

Each question sends one request to `api.typesafe.ai`. The request holds the question, its options, and the conversation text described above: what you typed and what Claude wrote. System reminders, tool inputs and outputs, `!` command input and output, slash command output, background task notifications, skill bodies, and compact summaries are not sent.

## Development

```sh
node --test test/jev-advise.test.mjs
claude plugin validate .
```

## License

MIT
