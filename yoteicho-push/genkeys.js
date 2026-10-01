#!/usr/bin/env node
/*
 VAPID鍵を作るスクリプト
 --------------------------------
 実行:  npm run vapid

 ここで作った鍵をホスティングの「環境変数」に登録しておくと、
 アプリを再デプロイしても、iPhoneの通知購読が無効にならずに済みます。

 公開鍵はアプリ側に配る用（秘密ではありません）、
 秘密鍵はサーバーだけが持つ値です（他人に見せないでください）。
*/
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log('');
console.log('===== VAPID鍵を作成しました =====');
console.log('');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('');
console.log('------ 登録する環境変数（この3行をコピー）------');
console.log('VAPID_SUBJECT=mailto:あなたのメールアドレス');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('-----------------------------------------------');
console.log('');
console.log('・Fly.io     : fly secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..."');
console.log('・Render     : ダッシュボードの Environment → Add Environment Variable');
console.log('・Railway    : Variables → New Variable');
console.log('');
console.log('※ この画面の値をメモして保管してください。作り直すと、');
console.log('   すでに登録済みのiPhoneの購読が無効になります。');
console.log('');
