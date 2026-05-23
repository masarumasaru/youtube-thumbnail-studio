# YouTube Thumbnail Studio

スクショ素材と原稿から、YouTubeサムネの見出し案とデザインパターンを作る静的Webアプリです。

## 使い方

1. `node server.mjs` で起動する
2. ブラウザで `http://localhost:4173/` を開く
3. 画面上部のOpenAI APIキー欄にキーを入れて保存する
4. 掲載先サイトが決まっている場合はURLを入れる
5. Aに雰囲気参考の画像を入れる
6. Bにサムネの元素材画像を入れる
7. テキスト原稿を貼り付ける
8. `生成` を押す
9. 使いたい見出し案を選ぶ。必要なら見出し欄を直接編集する
10. 元のAI生成案に戻したい場合は `元に戻す` を押す
11. 文字デザインのパターンを選ぶ
12. `選択見出しで生成` を押して完成サムネを1枚生成する
13. 気に入ったら `完成サムネPNG保存` を押す
14. 文字だけ欲しい場合は `文字だけ透過PNG生成` を押し、下のプレビューと品質チェックを確認してから `文字だけ透過PNG保存` を押す

APIキーはブラウザの `localStorage` に保存され、次回起動時も使えます。環境変数で使いたい場合は `OPENAI_API_KEY=... node server.mjs` でも動きます。
透明背景の文字レイヤー生成だけ別モデルにしたい場合は `OPENAI_TEXT_LAYER_IMAGE_MODEL=gpt-image-1 node server.mjs` のように、Images APIの編集モデルを指定できます。

## GitHub + Cloudflare Pages

このリポジトリはCloudflare Pages Functionsで `/api/*` が動く構成です。

1. GitHubにこのフォルダをpushする
2. Cloudflare PagesでGitHubリポジトリを選ぶ
3. Build commandは空、Build output directoryは `public`
4. Compatibility flagsに `nodejs_compat` を設定する
5. 必要なら環境変数を設定する

環境変数:

- `OPENAI_API_KEY`: サーバー側に固定APIキーを置きたい場合だけ設定。通常は画面のAPI設定からブラウザに保存したキーを使えます
- `OPENAI_MODEL`: 見出し生成モデル。未設定時は `gpt-5.4-mini`
- `OPENAI_DESIGN_MODEL`: 完成サムネ生成モデル。未設定時は `gpt-5.4-mini`
- `OPENAI_TEXT_LAYER_IMAGE_MODEL`: 文字レイヤー用画像編集モデル。未設定時は `gpt-image-1`

## 現状の仕様

- 画像はブラウザ内だけで処理
- 参考画像からアクセントカラーを簡易抽出
- OpenAI Responses APIで原稿全体とA/B画像の文脈を読んだ見出し候補を生成
- 掲載先URLからタイトル、description、OG情報、theme-colorを読み取りブランド文脈として反映
- 選択した見出しと文字テーマをもとにOpenAIの画像生成ツールで完成サムネを1枚生成
- 完成サムネから、Images APIで文字・影・光彩の白黒マスクを生成し、AIが読み取った文字配色とサーバー側のソフトシャドーで透明PNG化
- 文字だけ透過PNGの生成後に、面積、端の混入、不透明部分、半透明部分、背景混入をもとに品質チェックを表示
- 見出しは直接編集でき、AI生成時の元案へ戻せる
- 文字テーマ案は掲載先URL、参考画像、元素材に合わせてAIが提案
- API未接続時はエラーを表示し、古い簡易生成へ勝手にフォールバックしない
- 生成されたAIデザインをPNG保存

## 次に足せること

- 参考画像Aからレイアウト傾向も推定する
- フォント、文字位置、縁取り幅の手動調整
- 生成履歴とお気に入り管理
