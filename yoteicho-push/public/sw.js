/* 予定帖 — YOTEI-CHO
   Service Worker
   iOS（16.4以降）のホーム画面Webアプリでは new Notification() が使えないため、
   通知はこの Service Worker の showNotification() 経由で表示します。 */

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

/* サーバーからのプッシュ通知を受け取る（アプリを閉じていてもここが動く） */
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { try { data = { title: '予定', body: event.data.text() }; } catch (e2) { data = {}; } }
  var opts = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag || 'yoteicho',
    lang: 'ja',
    data: data.data || {}
  };
  event.waitUntil(self.registration.showNotification(data.title || '予定帖', opts));
});

/* 通知をタップしたら、開いているアプリを前面にして該当の予定を開く */
self.addEventListener('notificationclick', function (event) {
  var n = event.notification;
  var data = n.data || {};
  n.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c && 'focus' in c) {
          try {
            c.postMessage({ type: 'open-event', id: data.id || '', date: data.date || '' });
          } catch (e) {}
          if ('navigate' in c && data.url) { try { c.navigate(data.url); } catch (e) {} }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(data.url || './');
    })
  );
});

/* 通知を閉じたときの後始末（何もしなくてよいが、明示しておく） */
self.addEventListener('notificationclose', function () {});

/* 予定時刻が近いことをバッジ（対応環境のみ）に反映するためのメッセージ受け口 */
self.addEventListener('message', function (event) {
  var d = event.data || {};
  if (d.type === 'badge' && 'setAppBadge' in self) {
    try { self.setAppBadge(d.count || 0); } catch (e) {}
  }
});
