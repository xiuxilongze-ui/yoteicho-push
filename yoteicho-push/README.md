# 予定帖 — YOTEI-CHO 通知サーバー 設置ガイド

アプリを**開いていなくても**予定時刻にiPhoneへ通知を届けるためのサーバーです。
このファイルの順番どおりに進めれば設置できます。

---

## 0. 全体像

```
 iPhone（ホーム画面に追加した予定帖）
    │ ①通知の許可＋購読の登録        ┌─────────────────────┐
    └───────────────────────────────►│  このサーバー        │
    │ ②「何時に通知するか」を送信      │  ・アプリを配信       │
    │                                │  ・予定時刻を監視     │
    │ ④通知が届く                     │  ・Apple経由で送信    │
    └────────────────────────────────│                     │
                                    └──────────┬──────────┘
                              ③時刻になったら送信 ▼
                                    Apple プッシュ (APNs)
```

サーバーはずっと動かしておく必要があります（常時起動）。
スリープすると、その間の通知は届きません。

---

## 1. 用意するもの

| 必要なもの | 補足 |
|---|---|
| **パソコン** | 下のA・B・Cいずれの方法でも必要です（スマホだけでは設置できません） |
| **iOS 16.4 以降のiPhone** | ホーム画面に追加したWebアプリでのみ通知が使えます |
| **インターネット** | 無料枠で構いません |

---

## 2. まず鍵を作る（どの方法でも共通・5分）

`VAPID鍵` は通知の署名に使う値です。先に作っておくと、あとで再デプロイしても
iPhoneの購読が消えません。

ターミナル（Mac）または PowerShell（Windows）で:

```bash
cd yoteicho-push
npm install
npm run vapid
```

次のように表示されます。**この3行をメモ帳にコピーしておいてください。**

```
VAPID_SUBJECT=mailto:あなたのメールアドレス
VAPID_PUBLIC_KEY=BNsfJqJzz...
VAPID_PRIVATE_KEY=cFy1B6...
```

> `VAPID_SUBJECT` は `mailto:` を付けた自分のメールアドレスに変えてください。
> 秘密鍵は他人に見せないでください。このファイルを配らないでください。

---

## 3-A. 設置方法: Fly.io（いちばんおすすめ）

常時起動できて、無料枠でも小さく動きます。ターミナルを使います。

### 手順

```bash
# 1) Fly.io のコマンドを入れる（Mac）
brew install flyctl

#    Windows の場合（PowerShell）
#   iwr https://fly.io/install.ps1 -useb | iex

#    Mac で Homebrew を使わない場合
#   curl -L https://fly.io/install.sh | sh

# 2) ログイン（ブラウザが開きます）
fly auth signup       # 初めての方
fly auth login        # すでにアカウントがある方

# 3) プロジェクトのフォルダへ移動
cd yoteicho-push

# 4) アプリ名を決める（世界で唯一の名前。半角英数とハイフン）
#    fly.toml を開き、 app = "yoteicho-push-CHANGE-ME" を自分の名前に書き換える
#    例: app = "yoteicho-taro-2026"

# 5) アプリを作る
fly launch --no-deploy --copy-config

# 6) 購読情報を保存するディスクを作る（東京リージョン）
fly volumes create yoteicho_data --size 1 --region nrt

# 7) 鍵を登録する（2章でメモした値に置き換え）
fly secrets set VAPID_SUBJECT="mailto:you@example.com" VAPID_PUBLIC_KEY="（公開鍵）" VAPID_PRIVATE_KEY="（秘密鍵）"

# 8) 公開する
fly deploy

# 9) 状態を確認
fly status
fly logs
```

### 確認

```bash
curl https://あなたのアプリ名.fly.dev/api/health
# → {"ok":true,"subscribers":0,"url":"https://...","time":"..."}
```

`subscribers: 0` が出れば**設置成功**です（購読はiPhone側で行います）。

### ポイント

- `fly.toml` の `auto_stop_machines = false` と `min_machines_running = 1` により**スリープしません**。
- 再デプロイしても鍵は `fly secrets` にあるため、購読が消えません。
- URLは `https://アプリ名.fly.dev` で固定されます。

---

## 3-B. 設置方法: GitHub + Render（ターミナルを使いたくない場合）

ブラウザだけで完結します。

### 手順

1. **GitHub** にログイン → 右上「＋」→ **New repository**
   - 名前: `yoteicho-push`、**Public**、Add a README は**オフ**
2. 作成したリポジトリで **Add file → Upload files**
   - `yoteicho-push` フォルダの中身を**全部**ドラッグ＆ドロップ
   - ⚠️ `node_modules` フォルダは**入れないでください**（重くて失敗します）
   - 「Commit changes」
3. **[Render](https://render.com)** にログイン → **New +** → **Web Service**
4. **Build and deploy from a Git repository** → GitHub の `yoteicho-push` を選ぶ
5. 設定を入力:

   | 項目 | 値 |
   |---|---|
   | Name | `yoteicho-push` |
   | Runtime | **Node** |
   | Build Command | `npm ci --omit=dev` |
   | Start Command | `node server.js` |
   | Instance Type | **Starter**（有料。無料はスリープします）|

6. **Environment** タブで環境変数を追加（2章のメモから）

   | Key | Value |
   |---|---|
   | `VAPID_SUBJECT` | `mailto:you@example.com` |
   | `VAPID_PUBLIC_KEY` | （公開鍵） |
   | `VAPID_PRIVATE_KEY` | （秘密鍵） |
   | `DATA_DIR` | `/var/data` |

7. **Disks** → **Add Disk**: Name `yoteicho-data`、Mount Path `/var/data`、Size 1GB
8. **Create Web Service** → ビルドが終わるまで待つ
9. 発行されたURL（`https://yoteicho-push.onrender.com` など）で確認:

   `https://あなたのURL/api/health`

> ⚠️ **無料プランは15分でスリープ**します。スリープ中は通知が送れません。
> また無料プランではディスクを付けられないため、再デプロイで購読が消えます。
> 本気で使うなら Starter 以上を選んでください。

---

## 3-C. 設置方法: 自分のVPS（一番確実）

さくら / ConoHa / Vultr などのVPSを使っている場合。

```bash
# サーバーにSSHで入ってから
sudo apt update && sudo apt install -y nodejs npm
sudo npm install -g pm2

# ファイルを置く（手元から転送するか、git clone する）
cd /home/your-user/yoteicho-push
npm install

# 起動して常駐させる
pm2 start server.js --name yoteicho
pm2 startup     # 表示されたコマンドをコピーして実行
pm2 save
```

**HTTPS化**（必須）: Nginx + certbot でリバースプロキシします。

```nginx
server {
  listen 443 ssl;
  server_name your-domain.example.com;
  ssl_certificate     /etc/letsencrypt/live/your-domain.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/your-domain.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
  }
}
```

環境変数は `pm2` の `ecosystem.config.js` か `/etc/environment` に設定してください。

---

## 4. iPhone側の設定（共通）

1. iPhoneの **Safari** で `https://あなたのURL/qr` を開く
   → 大きなQRコードと手順が表示されます
2. **iPhoneのカメラ**（またはPC画面のQR）で読み取り → Safariで開く
   - PCのブラウザで開いている場合は、`https://あなたのURL/qr.png?size=1600&download=1` を保存して印刷してもOK
3. 共有ボタン → **「ホーム画面に追加」** → 追加
4. **追加したアイコンから起動**（Safariのタブからでは通知が許可されません）
5. 右パネル「持ち出し」まで下げる → **「サーバー通知を登録」** をタップ
6. 通知を許可 → 数秒で**テスト通知**が届きます

### 成功のサイン

- 状態が **「サーバー通知：登録済み」** に変わる
- ボタンが **「テスト通知を送る」** に変わる
- ロック画面／バナーに「予定帖のテスト通知」が届く

---

## 5. 動作確認コマンド

```bash
# サーバーが生きているか＋購読数
curl https://あなたのURL/api/health
# {"ok":true,"subscribers":1,...}

# QRコードがそのURLを指しているか
curl -s "https://あなたのURL/qr.png?size=400" -o qr.png
# qr.png を写真アプリなどで読み取って、URLが一致すればOK
```

サーバーのログに、送信の成否が出ます。

```
[sub] 登録: https://web.push.apple.com/...   (合計 1)
[schedule] 3件を受け取りました
[push] 送信OK  2026-10-02T01:00:00.000Z  チーム定例
```

`[push] 送信失敗 410` は購読が失効しています（アプリで登録し直し）。

---

## 6. つまずいたときは

| 症状 | 原因と対処 |
|---|---|
| `/api/health` に何も返らない | ビルド失敗 or スリープ。ホストのログを確認 |
| ボタンが「ホーム画面から起動してください」 | Safariのタブで開いています。**追加したアイコン**から起動 |
| ボタンが「HTTPSで開いてください」 | `http://` やファイル直開きです。`https://` のURLで開いてください |
| ボタンが「サーバーに接続できません」 | 静的ホスティングに置いています。サーバーとして起動しているURLで開いてください |
| テスト通知が届かない | ホストがスリープしていないか。`/api/health` がいつでも応答する必要があります |
| 数日後に届かなくなった | 購読が失効（410）。アプリを開いて登録し直してください |
| 通知が2回届く | アプリを開いている間はアプリ内通知も同時に動きます（仕様） |
| 通知の音が鳴らない | 設定 → 通知 → 予定帖 → サウンドをオン |

---

## 7. 制限（正直なところ）

- **繰り返し予定には未対応**です。1件ずつ登録してください。
- **予定を変更したら、アプリを一度開いて同期**が必要です（開けば自動で同期します）。
- ホストがスリープすると、その間の通知は**遅延または欠落**します。
- 通知は**サーバー経由**のため、サーバーが止まると届きません。
  止まっていても気づけるよう、予定の**カレンダー書き出し（アプリ内「持ち出し」）**を
  併用するのがおすすめです。
- **実機での通知到達だけは、設置後にご自分でテスト通知で確認**してください。
