# e5489 サンライズ出雲・瀬戸 空席ウォッチャー

[e5489（JR西日本ネット予約）](https://e5489.jr-odekake.net/) でサンライズ出雲・瀬戸の空席を定期的に照会し、
**満席だった設備に空きが出たらメールで通知**します。

デフォルトは **2026-09-27 岡山 → 東京** の **サンライズツイン / シングルツイン**（出雲・瀬戸の両方）を監視します。

---

## ログインは要りません

調査の結果、**e5489 の空席照会はログインなしで通ります**。ログインが要るのは予約を確定する段階だけです。

キャンペーンページ [サンライズ出雲・瀬戸](https://www.jr-odekake.net/goyoyaku/campaign/sunriseseto_izumo/form.html)
には「会員ログインして予約」と「**会員ログインせず予約**」の2ルートがあり、後者の検索URLを直接叩いています。

### 表示されるのは本当にリアルタイムか

検証済みです。

1. 同じURLを2回叩くと内部の取引番号 `messageNo` が毎回変わる（= 都度マルスに照会している。静的キャッシュではない）
2. 日付を変えると結果が変わる（9/26土 `×` / 9/29火 `△` / 10/1木 `○`）
3. **別会社の別システムである [JR CYBER STATION](https://www.jr.cyberstation.ne.jp/) と `△` まで含めて完全一致**

なお CyberStation はログイン不要で手軽ですが「個室の空席案内はできない」と明記されており、
ノビノビ座席（普通車指定席）しか分かりません。個室を見るには e5489 が必要です。

---

## なぜ実ブラウザが必要なのか

e5489 は `curl` などの素の HTTP リクエストを **必ず**「混雑中です。…【20100946】」で弾きます。
実 Google Chrome なら通ります。

ただし木人ウォッチャーと違い Cloudflare のチャレンジではないため、**ヘッドレスで動きます**。
つまり **実行のたびに Chrome のウィンドウが出ることはありません**。

実 Chrome でも「混雑中」は返ります。**連続してリクエストを投げると出やすくなる**（単発なら約2秒で通る）ため、
`check.js` は同じページに粘らず **全ページを一巡してから未取得のぶんだけ間を空けて再挑戦**します（最大3巡）。

実測では毎回4ページ中1ページ程度が混雑中になり、1回の実行はおよそ **35〜45秒**です。
巡回間の待ち時間は `check.js` の `jitter(8000 * (round - 1))` で調整できます。長くするほどサイトには優しく、
実行時間は延びます。

---

## セットアップ

### 1. 依存パッケージ（インストール済み）

```bash
cd /PATH/TO/e5489-watch
npm install
```

Google Chrome が必要です（`/Applications/Google Chrome.app`）。
Playwright 同梱の Chromium はダウンロードしません（システムの Chrome を使うため）。

### 2. 設定

**このリポジトリは公開しているため、メールアドレスとアプリパスワードはコミットしません。**
設定は2つに分かれています。

`config.json`（コミットする。監視条件だけ）:

```json
{
  "date": "2026-09-27",
  "departStName": "岡山",
  "arriveStName": "東京",
  "searchHour": "14",
  "searchMinute": "05",
  "trains": ["izumo", "seto"],
  "watchFacilities": ["サンライズツイン", "シングルツイン"],
  "serviceHours": { "start": "05:30", "end": "23:30" }
}
```

`secrets.json`（**gitignore 済み**。ローカル実行用）:

```json
{
  "gmailUser": "you@gmail.com",
  "to": "you@gmail.com",
  "gmailAppPassword": "xxxx xxxx xxxx xxxx"
}
```

Gmail の通常パスワードでは送信できません。2段階認証を有効にしたうえで
[アプリパスワード](https://myaccount.google.com/apppasswords)（16桁）を発行してください。

GitHub Actions で動かす場合は、同じ値をリポジトリの Secrets に登録します
（`Settings > Secrets and variables > Actions`、または `gh secret set`）:

| Secret 名 | 中身 |
| --- | --- |
| `GMAIL_APP_PASSWORD` | アプリパスワード16桁 |
| `GMAIL_USER` | 送信元の Gmail アドレス |
| `MAIL_TO` | 通知先アドレス（省略時は `GMAIL_USER`） |

環境変数 → `secrets.json` → `config.json` の順に探すので、ローカルと CI で同じコードが動きます。

| `config.json` のキー | 説明 |
| --- | --- |
| `date` | 乗車日（`岡山 22:34 発`の日付。東京着は翌朝） |
| `trains` | `izumo` = サンライズ出雲 / `seto` = サンライズ瀬戸。岡山→東京は併結区間なので両方走ります |
| `watchFacilities` | `ノビノビ座席` `シングル` `ソロ` `シングルツイン` `シングルデラックス` `サンライズツイン` から選択 |
| `searchHour` / `searchMinute` | 検索の基準時刻。列車を直接指定しているので結果には影響しません |
| `serviceHours` | この時間帯（JST）の外では照会せずスキップします |

対応駅は `sunrise.js` の `ST_NO` を参照（東京・横浜・熱海・沼津・富士・静岡・浜松・大阪・三ノ宮・姫路・岡山・
児島・坂出・高松・多度津・善通寺・琴平・倉敷・備中高梁・新見・米子・安来・松江・宍道・出雲市）。

**設備は1つのURLに1種類とは限りません。** `シングルツイン` を指定すると開く「標準ページ」には
ノビノビ座席・シングルデラックスも同居しているため、それらを追加しても照会回数は増えません。

### 3. 動作確認

```bash
node check.js --no-email   # 照会するだけ。メールは送らない
node check.js --test-email # メールの疎通確認だけ
node check.js --force      # 営業時間外でも強制実行
```

### 4. 定期実行の登録（30分ごと）

```bash
cp com.e5489.watch.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.e5489.watch.plist
```

停止:

```bash
launchctl unload ~/Library/LaunchAgents/com.e5489.watch.plist
```

間隔を変えるときは plist の `StartInterval`（秒）を編集して unload → load し直してください。

### 5. GitHub Actions で動かす場合

`.github/workflows/watch.yml` が **JST 5:30〜23:30 を30分間隔**で回します（cron は UTC 指定）。
`state.json` はワークフローがリポジトリにコミットして次回に引き継ぐため、通知済みの設備を覚えています。

手動で試すときは Actions タブから「サンライズ空席ウォッチ」→ Run workflow、または:

```bash
gh workflow run watch.yml -f dry_run=true -f force=true
```

`dry_run` はメールを送らず照会だけ、`force` は営業時間外でも実行します。

**実測した所要時間は1回あたり約1分49秒**（うち照会が93秒）です。GitHub Actions は
ジョブ単位で分に切り上げ課金されるため2分/回、30分間隔なら約2,200分/月になります。
**public リポジトリなら実行時間は無制限・無料**ですが、private の無料枠は2,000分/月なので
private で運用するなら間隔を45分以上にしてください。

なお GitHub の cron は混雑時に5〜20分ずれます。寝台のキャンセルは数分で消えるので、
確実性を求めるなら Mac の launchd のほうが有利です（遅延なし・分数消費なし）。

**launchd と GitHub Actions を同時に動かさないでください。** `state.json` が2系統に分かれ、
同じ空席で二重に通知が来ます。

---

## 通知の挙動

- 通知するのは **`×`（満席）→ `○`／`△` に変わった瞬間**だけです。空いている間ずっと鳴り続けることはありません。
- 再び満席になり、その後また空けば改めて通知します。
- メールには **J-WEST ログインを挟んでそのまま予約画面に入れるURL**が設備ごとに入っています。
  寝台のキャンセルは数分で消えるので、メールが来たら即クリックしてください。
- 照会に失敗したページの状態は前回値を保持します（失敗を「満席」と誤認して二重通知しないため）。
- `config.json` の乗車日や区間を変えると、過去の状態は自動的に破棄されます。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `check.js` | 本体。照会・比較・通知 |
| `sunrise.js` | 駅名/列車略称の Shift-JIS エンコード表と URL 組み立て（キャンペーンページの JS から抽出） |
| `config.json` | 設定とメール認証情報（gitignore 済み） |
| `state.json` | 前回の空席状態 |
| `watch.log` | 実行ログ |

## 注意

- 個人の座席確保のための利用にとどめてください。間隔を極端に詰めるとサイトに負荷がかかります。
- e5489 の発売は乗車日の1ヶ月前10時からです。それ以前の日付を指定するとエラーになります。
- サイトの HTML 構造が変わるとパースに失敗します。その場合は「空席情報を1件も取得できませんでした」とログに出ます。
