# jev-advise

[English](README.md)

Claude Code が出す選択肢の横に、[Jev](https://docs.typesafe.ai) の確率を表示するプラグイン。表示するだけで、選ぶのは自分。

- **AskUserQuestion**: 各選択肢の説明の頭に `[jev 0.80]` が付く。
- **本文の質問**（grilling のラウンドなど）: 各選択肢の行末に `` `[jev 0.80]` `` が付く。プラグインはセッション開始時に短い指示を会話に足し、Claude にこの種の質問を決まった書式で書かせる。確率が付くのは、その書式で書かれた質問だけ。
- `jev pick` は Jev の最上位の選択肢に付く。ただし確信度が 0.6 以上のときだけ。実際の回答 221 件で測ると、Jev とユーザーの選択の一致率は 0.6 以上で 72%、それ未満で 45〜60% だった。

Claude と Jev は互いの推奨を見ない。

- 確率は画面の表示にだけ足す。Claude が Jev の出力を読むことはない。
- Jev が読むのは、最後のユーザー入力までの会話（末尾 3000 文字まで）。今のターンの Claude の本文は含まない。`(Recommended)` の印と `Recommendation:` の行は、Jev に送る前に取り除く。

## 必要なもの

- Claude Code（2.1.308 で動作確認）
- `PATH` が通った `jev` CLI と、TypeSafe の API キー。`jev` は Node.js 20.12 以上で動く。このプラグインも同じ Node.js を使う。

  ```sh
  npm install -g jevctl
  jev auth login
  ```

  キーはシェルの環境変数だけでなく、`jev auth login` で保存しておく。hook はシェルのプロファイルを読まないため、Claude Code をターミナル以外のアプリから起動すると、プロファイルで export したキーが見えないことがある。`node` と `jev` も、Claude Code の起動時の `PATH` に入っている必要がある。`jev` を実行できないときは、選択肢に `[jev failed]` と出る。

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

## 使い方

実行するものはない。インストールすれば、Claude が選択を求めるたびに確率が付く。

### AskUserQuestion

Claude が「どのデータベースを使う?」のように聞いてくると、ダイアログの各説明の頭に Jev の確率が付く。Claude 自身の `(Recommended)` はラベルに残るので、両者を見比べられる。

```
Which database should we use?

❯ 1. SQLite (Recommended)
     [jev pick 0.82] Embedded, no server to run
  2. PostgreSQL
     [jev 0.18] Server-based, built for production
```

Jev の確信度が 0.6 未満のときは `jev pick` が付かず、確率だけが出る。

```
  1. Ship this week
     [jev 0.55] Fix the remaining bugs after release
  2. Wait a week
     [jev 0.45] Release once every known bug is fixed
```

### 本文の質問

「始める前にこの計画を詰めて (grill me)」「スキーマを決めるのに必要なことを質問して」のように、本文で質問してもらう。Claude はプラグインの書式で質問を書き、各選択肢の行末に確率が付く。

```
**Q1** - **認証**: ユーザーはどうやってログインする?
- A. メールとパスワード: いちばん作りやすい `[jev 0.31]`
- B. Google ログイン: パスワードを保存しなくて済む `[jev pick 0.69]`

Recommendation: B。アプリはもう Google Workspace を使っているので
```

質問は前後の文章より少し遅れて表示される。プラグインが `Recommendation:` の行を待ってから Jev に聞くため。

## TypeSafe に送るもの

質問 1 つにつき、`api.typesafe.ai` へリクエストを 1 回送る。中身は質問と選択肢、上で書いた範囲の会話テキスト。system reminder とツールの入出力は送らない。

## 開発

```sh
node --test test/jev-advise.test.mjs
claude plugin validate .
```

## ライセンス

MIT
