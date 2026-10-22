# jev-advise

[日本語](README.ja.md)

A Claude Code mod that shows [Jev](https://docs.typesafe.ai)'s probabilities next to the choices Claude offers you. It only displays them. You still make the choice.

- **AskUserQuestion**: each option's description starts with `[jev 0.80]`.
- **Plain-text questions** (a grilling round, for one): each option line ends with `` `[jev 0.80]` ``. The mod adds a short system prompt section that asks Claude to write these questions in a fixed format, and it only tags questions in that format.
- `jev 推奨` marks Jev's top option, but only when its confidence is 0.6 or higher. On 221 real answers, Jev matched the user 72% of the time above that line and 51–54% below it.

Claude and Jev never see each other's recommendation:

- The tags are added to what you see only. Claude never reads Jev's output.
- Jev reads the conversation up to your last prompt, at most the last 3000 characters. It does not see Claude's text from the current turn. `(Recommended)` marks and the `推奨:` / `Recommendation:` line are removed before anything is sent to Jev.

## Requirements

- Claude Code 2.1.307 or newer, with function hooks turned on. Add this to the `env` block of `~/.claude/settings.json`:

  ```json
  "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
  ```

- The `jev` CLI on your `PATH`, with a TypeSafe API key:

  ```sh
  npm install -g jevctl
  jev auth login
  ```

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

The repository is private. To install it, you need read access on GitHub and a git credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

## What is sent to TypeSafe

Each question sends one request to `api.typesafe.ai`. The request holds the question, its options, and the conversation text described above. System reminders and tool inputs or outputs are not sent.

## License

MIT
