# jev-advise

[English](README.md)

Claude Code が出す選択肢の横に、[Jev](https://docs.typesafe.ai) の確率を表示する mod。表示するだけで、選ぶのは自分。

- **AskUserQuestion**: 各選択肢の説明の頭に `[jev 0.80]` が付く。
- **本文の質問**（grilling のラウンドなど）: 各選択肢の行末に `` `[jev 0.80]` `` が付く。mod はシステムプロンプトに短い節を足し、Claude にこの種の質問を決まった書式で書かせる。確率が付くのは、その書式で書かれた質問だけ。
- `jev 推奨` は Jev の最上位の選択肢に付く。ただし確信度が 0.6 以上のときだけ。実際の回答 221 件で測ると、Jev とユーザーの選択の一致率は 0.6 以上で 72%、それ未満で 51〜54% だった。

Claude と Jev は互いの推奨を見ない。

- 確率は画面の表示にだけ足す。Claude が Jev の出力を読むことはない。
- Jev が読むのは、最後のユーザー入力までの会話（末尾 3000 文字まで）。今のターンの Claude の本文は含まない。`(Recommended)` の印と `推奨:` / `Recommendation:` の行は、Jev に送る前に取り除く。

## 必要なもの

- Claude Code 2.1.307 以上で、function hooks を有効にしておく。`~/.claude/settings.json` の `env` に次を足す。

  ```json
  "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
  ```

- `PATH` が通った `jev` CLI と、TypeSafe の API キー。

  ```sh
  npm install -g jevctl
  jev auth login
  ```

## インストール

Claude Code のターミナルセッションのプロンプトで:

```
/plugin install jev-advise --marketplace PeesukaGu/jev-advise
```

マーケットプレイスの追加を聞かれたら `y` で答え、スコープを選ぶ。

シェルから:

```sh
claude plugin install jev-advise --marketplace PeesukaGu/jev-advise
```

このリポジトリは private。インストールするには、GitHub での読み取り権限と、github.com 用の git 認証情報（SSH 鍵、または `gh auth login` のあと `gh auth setup-git`）が手元の PC に要る。

## TypeSafe に送るもの

質問 1 つにつき、`api.typesafe.ai` へリクエストを 1 回送る。中身は質問と選択肢、上で書いた範囲の会話テキスト。system reminder とツールの入出力は送らない。

## ライセンス

MIT
