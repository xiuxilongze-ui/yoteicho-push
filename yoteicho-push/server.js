'use strict';
/*
 予定帖 — YOTEI-CHO  通知サーバー
 ------------------------------------------------
 役割:
   1. アプリ（PWA）を配信する
   2. iPhoneのプッシュ購読（subscription）を保存する
   3. アプリから送られた「通知する時刻」を保持し、その時刻になったら
      Appleのプッシュサービス経由で通知を送る

 これにより、アプリを閉じていても予定時刻に通知が届きます。
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

const CHECK_INTERVAL = 20000;              /* 何ミリ秒ごとに予定時刻を見るか */
const GRACE = 6 * 60 * 1000;               /* 送信が遅れても、この範囲内なら送る */
const KEEP_SENT = 3 * 24 * 3600 * 1000;    /* 送信済み記録の保持期間 */

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');
const KEY_FILE = path.join(DATA_DIR, 'vapid.json');

const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; } };
const writeJSON = (f, o) => { try { fs.writeFileSync(f, JSON.stringify(o, null, 2)); } catch (e) { console.error('[warn] 保存に失敗:', e.message); } };

/* ---------- VAPID鍵（環境変数 > 保存済み > 新規生成） ---------- */
let VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
let VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
(() => {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    const saved = readJSON(KEY_FILE, null);
    if (saved && saved.publicKey && saved.privateKey) {
      VAPID_PUBLIC = saved.publicKey; VAPID_PRIVATE = saved.privateKey;
      console.log('[info] 保存済みのVAPID鍵を使います');
    } else {
      const k = webpush.generateVAPIDKeys();
      VAPID_PUBLIC = k.publicKey; VAPID_PRIVATE = k.privateKey;
      writeJSON(KEY_FILE, k);
      console.log('[info] VAPID鍵を新規生成して ' + KEY_FILE + ' に保存しました');
    }
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:example@example.com',
    VAPID_PUBLIC,
    VAPID_PRIVATE
  );
})();

/* ---------- データ ---------- */
let db = readJSON(DB_FILE, { subs: {}, sent: {} });
db.subs = db.subs || {};
db.sent = db.sent || {};
const save = () => writeJSON(DB_FILE, db);

/* ---------- 送信 ---------- */
function deliver(endpoint, ev) {
  const rec = db.subs[endpoint];
  if (!rec) return;
  const payload = JSON.stringify({
    title: ev.title || '予定',
    body: ev.body || '',
    tag: 'yoteicho-' + ev.id,
    url: './',
    data: { id: ev.id, date: ev.date || '' }
  });
  webpush
    .sendNotification(rec.subscription, payload, { TTL: 3600, urgency: 'high' })
    .then(() => console.log('[push] 送信OK  ' + (ev.fireAt ? new Date(ev.fireAt).toISOString() : '') + '  ' + (ev.title || '')))
    .catch((err) => {
      const code = err && err.statusCode;
      console.error('[push] 送信失敗 ' + (code || '') + ' ' + (err && err.message));
      if (code === 404 || code === 410) {          /* 購読が無効になっていた */
        delete db.subs[endpoint]; save();
      }
    });
}

/* ---------- 定期チェック ---------- */
function tick() {
  const now = Date.now();
  let changed = false;

  for (const endpoint of Object.keys(db.subs)) {
    const list = Array.isArray(db.subs[endpoint].events) ? db.subs[endpoint].events : [];
    for (const ev of list) {
      if (!ev || !ev.id || !ev.fireAt) continue;
      const key = endpoint + '|' + ev.id + '|' + ev.fireAt;
      if (db.sent[key]) continue;
      if (now < ev.fireAt) continue;

      db.sent[key] = now; changed = true;
      if (now - ev.fireAt > GRACE) continue;      /* 大幅に過ぎたものは送らない */
      deliver(endpoint, ev);
    }
  }

  /* 古い記録・過去の予定を掃除 */
  for (const k of Object.keys(db.sent)) {
    if (now - db.sent[k] > KEEP_SENT) { delete db.sent[k]; changed = true; }
  }
  for (const endpoint of Object.keys(db.subs)) {
    const list = db.subs[endpoint].events || [];
    const keep = list.filter((e) => e && e.fireAt > now - 3600 * 1000);
    if (keep.length !== list.length) { db.subs[endpoint].events = keep; changed = true; }
  }

  if (changed) save();
}

/* ---------- HTTP ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

function send(res, status, body, type, extra) {
  const headers = Object.assign({
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, extra || {});
  res.writeHead(status, headers);
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');

function readBody(req, cb) {
  let body = '';
  let tooBig = false;
  req.on('data', (c) => {
    body += c;
    if (body.length > 512 * 1024) { tooBig = true; req.destroy(); }
  });
  req.on('end', () => {
    if (tooBig) return cb(new Error('payload too large'));
    try { cb(null, body ? JSON.parse(body) : {}); } catch (e) { cb(e); }
  });
  req.on('error', () => cb(new Error('read error')));
}

/* このサーバー自身の公開URL（プロキシ越しでも正しく取れるように） */
function publicUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || ('localhost:' + PORT);
  return proto + '://' + host + '/';
}

/* スマホ用QRコード（設置後のURLそのものを焼き込む） */
function serveQRImage(req, res, url) {
  const size = Math.min(2048, Math.max(128, parseInt(url.searchParams.get('size'), 10) || 512));
  const target = publicUrl(req);
  QRCode.toBuffer(target, {
    type: 'png', width: size, margin: 2, errorCorrectionLevel: 'M',
    color: { dark: '#14201FFF', light: '#FFFFFFFF' }
  }, (err, buf) => {
    if (err) return send(res, 500, 'qr error', 'text/plain; charset=utf-8');
    const extra = { 'Cache-Control': 'no-store' };
    if (url.searchParams.get('download')) extra['Content-Disposition'] = 'attachment; filename="yoteicho-qr.png"';
    send(res, 200, buf, 'image/png', extra);
  });
}

/* 印刷・確認用のQRページ */
function serveQRPage(req, res) {
  const target = publicUrl(req);
  const html = '<!doctype html><html lang="ja"><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>予定帖 スマホ用QRコード</title>'
    + '<style>body{margin:0;padding:32px 20px;background:#EEF2F1;color:#14201F;'
    + 'font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",system-ui,sans-serif;text-align:center}'
    + 'h1{font-size:19px;margin:0 0 6px}p{color:#4B5C5A;font-size:13px;line-height:1.8;margin:6px 0}'
    + '.card{display:inline-block;background:#fff;border:1px solid #C6D3D1;border-radius:4px;padding:22px;'
    + 'box-shadow:0 10px 30px -18px rgba(20,32,31,.5)}'
    + 'img{width:min(320px,72vw);height:auto;display:block;margin:0 auto 14px}'
    + 'code{display:inline-block;font-size:12px;background:#F7F9F8;border:1px solid #C6D3D1;padding:8px 10px;'
    + 'border-radius:3px;word-break:break-all;max-width:90vw}a{color:#C93A2B}ol{text-align:left;max-width:420px;margin:14px auto 0;font-size:13px;color:#4B5C5A;line-height:1.9}'
    + '</style></head><body>'
    + '<div class="card"><img src="qr.png?size=1024" alt="予定帖のスマホ用QRコード" width="1024" height="1024">'
    + '<code>' + target + '</code></div>'
    + '<ol><li>iPhoneの<b>カメラ</b>でこのQRを読み取ります</li>'
    + '<li>Safariで開いたら、共有ボタン → <b>「ホーム画面に追加」</b></li>'
    + '<li>できたアイコンから起動し、「通知」→「サーバー通知を登録」をタップ</li></ol>'
    + '<p>印刷用: <a href="qr.png?size=1600&download=1">大きいQR画像をダウンロード</a></p>'
    + '<p style="margin-top:18px"><a href="./">← 予定帖を開く</a></p>'
    + '</body></html>';
  send(res, 200, html, 'text/html; charset=utf-8');
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain; charset=utf-8');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    const ext = path.extname(file).toLowerCase();
    const noCache = ext === '.html' || ext === '.js' || ext === '.json';
    send(res, 200, fs.readFileSync(file), MIME[ext] || 'application/octet-stream',
      { 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=86400' });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (p === '/.well-known/health' || p === '/api/health') {
    return json(res, 200, { ok: true, subscribers: Object.keys(db.subs).length, url: publicUrl(req), time: new Date().toISOString() });
  }

  /* アプリ側が購読に使う公開鍵 */
  if (p === '/vapid-public-key') return json(res, 200, { key: VAPID_PUBLIC });

  if (p === '/qr.png') return serveQRImage(req, res, url);
  if (p === '/qr') return serveQRPage(req, res);

  if (req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return json(res, 400, { ok: false, error: 'bad json' });

      if (p === '/api/subscribe') {
        const sub = body.subscription;
        if (!sub || !sub.endpoint) return json(res, 400, { ok: false, error: 'subscription required' });
        const prev = db.subs[sub.endpoint] || {};
        db.subs[sub.endpoint] = {
          subscription: sub,
          events: Array.isArray(prev.events) ? prev.events : [],
          updatedAt: new Date().toISOString()
        };
        save();
        console.log('[sub] 登録: ' + sub.endpoint.slice(0, 48) + '…  (合計 ' + Object.keys(db.subs).length + ')');
        return json(res, 200, { ok: true, subscribers: Object.keys(db.subs).length });
      }

      if (p === '/api/schedule') {
        const ep = body.endpoint;
        if (!ep || !db.subs[ep]) return json(res, 404, { ok: false, error: 'not subscribed' });
        const events = (Array.isArray(body.events) ? body.events : [])
          .filter((e) => e && e.id && Number.isFinite(e.fireAt))
          .map((e) => ({
            id: String(e.id),
            title: String(e.title || '予定').slice(0, 80),
            body: String(e.body || '').slice(0, 160),
            date: String(e.date || ''),
            fireAt: Number(e.fireAt)
          }));
        db.subs[ep].events = events;
        db.subs[ep].updatedAt = new Date().toISOString();
        save();
        console.log('[schedule] ' + events.length + '件を受け取りました');
        return json(res, 200, { ok: true, count: events.length, next: events.map(e => e.fireAt).sort()[0] || null });
      }

      if (p === '/api/unsubscribe') {
        const ep = body.endpoint;
        if (ep && db.subs[ep]) { delete db.subs[ep]; save(); }
        return json(res, 200, { ok: true });
      }

      if (p === '/api/test-push') {
        const ep = body.endpoint;
        if (!ep || !db.subs[ep]) return json(res, 404, { ok: false, error: 'not subscribed' });
        deliver(ep, { id: 'test-' + Date.now(), title: '予定帖のテスト通知', body: 'この通知が届いていれば、サーバーからの通知は正常です。', date: '' });
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { ok: false, error: 'unknown endpoint' });
    });
  }

  if (req.method === 'GET') return serveStatic(req, res, p);
  return send(res, 405, 'method not allowed', 'text/plain; charset=utf-8');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('予定帖 通知サーバー 起動  http://0.0.0.0:' + PORT);
  console.log('  公開鍵: ' + VAPID_PUBLIC.slice(0, 24) + '…');
  console.log('  データ: ' + DB_FILE);
  console.log('  購読数: ' + Object.keys(db.subs).length);
  setInterval(tick, CHECK_INTERVAL);
  tick();
});

process.on('SIGTERM', () => { save(); process.exit(0); });
process.on('SIGINT', () => { save(); process.exit(0); });
