# jev-advise

[日本語](README.ja.md)

A Claude Code plugin that shows [Jev](https://docs.typesafe.ai)'s probabilities next to the choices Claude offers you. It only displays them. You still make the choice.

- **AskUserQuestion**: each option's description starts with `[jev 0.80]`.
- **Plain-text questions** (a grilling round, for one): each option line ends with `` `[jev 0.80]` ``. The plugin adds a short note to the session context that asks Claude to write these questions in a fixed format, and it only tags questions in that format.
- `jev pick` marks Jev's top option, but only when its confidence is 0.6 or higher. On 221 real answers, Jev matched the user 72% of the time above that line and 45–60% below it.

Claude and Jev never see each other's recommendation:

- The tags are added to what you see only. Claude never reads Jev's output.
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


## What is sent to TypeSafe

Each question sends one request to `api.typesafe.ai`. The request holds the question, its options, and the conversation text described above. System reminders and tool inputs or outputs are not sent.

## Development

```sh
node --test test/jev-advise.test.mjs
claude plugin validate .
```

## License

MIT
