/*
 * オフライン用のサービスワーカー
 *
 * このアプリを使う場所（ゲームセンター）は地下や電波の悪い建物が多く、
 * ホーム画面のアイコンから開いても通信できないと画面すら出ない、という状態だった。
 * ここで外枠（HTML と JS）をキャッシュしておき、通信ゼロでも起動できるようにする。
 *
 * 方針:
 *   - 画面の遷移は「まずキャッシュ」。圏外でも確実に起動させるため、通信を待たない。
 *   - 裏でこっそり取り直して、次に開いたときに新しい版になるようにする。
 *   - 中身のデータ（プレイ記録）は IndexedDB にあるので、ここでは一切扱わない。
 *   - 曲データ（master.bin。暗号化してある）は外枠と同じく貯める。無いと圏外で曲が出ない。
 *   - **`cache: 'no-store'` を付けた取得は横取りしない。** 「いま通信できるか」を
 *     確かめる用（src/store/appUpdate.web.ts）。横取りすると圏外でも「通信できる」と誤判定する。
 *
 * アドレスはすべて、このファイルが置かれた場所（BASE）からの相対で考える。
 * 公開先の GitHub Pages では `/taiko-kiroku/` のように一段下の階層に置かれ、
 * **同じ住所（qorigame256.github.io）に別のアプリも同居している**ため。
 *   - キャッシュを片付けるときは、名前が PREFIX で始まるものだけを消す。
 *     キャッシュの置き場所は住所ごとに 1 つで、ほかのアプリのぶんも並んでいる。
 *     全部消すと、そのアプリが圏外で起動できなくなる。
 *
 * 書き出し（npm run export:web）のたびに JS のファイル名は変わる。
 * 一覧を手で書くとすぐ古くなるので、install のときに外枠の HTML を読んで
 * その中に書かれている JS・CSS の名前を拾い、まとめて貯める（下の collectShellAssets）。
 * これをしないと「アプリの本体（3MB 超）だけキャッシュされていない」状態になり、
 * ゲーセンの圏外で起動できない。
 *
 * 全部を捨ててやり直したいときは、下の CACHE の番号を上げること。
 * **古い番号のキャッシュは、新しいほうが揃うまで消さない。**
 * 空のまま消すと、圏外で起動できなくなって復旧手段が無い。
 */

/** このアプリのキャッシュの名前の頭。片付けるときはこれで始まるものだけを触る。 */
const PREFIX = 'taiko-kiroku-';
const CACHE = PREFIX + 'v3';

/** このファイルが置かれた場所。例: '/taiko-kiroku/'（一番上に置いたときは '/'）。 */
const BASE = new URL('./', self.location.href).pathname;
const SHELL = BASE;

/** 最初に必ず持っておくもの。ここが無いと圏外で起動できない。 */
const PRECACHE = [
  BASE,
  BASE + 'manifest.json',
  BASE + 'master.bin',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'apple-touch-icon.png',
];

/** このアプリのキャッシュか。 */
function isOwnCache(name) {
  return name.startsWith(PREFIX);
}

/** 中身がファイル名で決まるもの（内容が変わることは無いので取り直さない）。 */
function isImmutable(url) {
  return url.pathname.startsWith(BASE + '_expo/static/');
}

/**
 * 外枠の HTML から、アプリ本体（JS・CSS）の名前を拾う。
 * 名前は書き出しのたびに変わるので、ここで毎回読み直す。
 * 引用符はどちらでも拾えるようにしてある（書き出し側の都合で変わることがある）。
 */
function collectShellAssets(html) {
  const found = new Set();
  const pattern = /(?:src|href)\s*=\s*["']([^"']*\/_expo\/static\/[^"']+)["']/g;
  let match;
  while ((match = pattern.exec(html)) !== null) found.add(match[1]);
  return [...found];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 1 つ失敗しても残りは入れる（アイコンが無いだけで全部諦めない）
      await Promise.allSettled(
        PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
      );

      // 外枠を読んで、アプリ本体もまとめて貯めておく。
      // ファイル名に中身の指紋が入っているので、取り直し（reload）は指定しない
      // ＝ブラウザが持っている分をそのまま使えて、3MB を二度落とさずに済む。
      try {
        const shell = await cache.match(SHELL);
        if (shell) {
          const assets = collectShellAssets(await shell.clone().text());
          await Promise.allSettled(assets.map((url) => cache.add(url)));
        }
      } catch {
        // 圏外。次に開いたときに貯め直す
      }

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const ready = await cache.match(SHELL);

      // **新しいほうに外枠が入っているときだけ、古いものを片付ける。**
      // install の取得が圏外で全部失敗したときに古いキャッシュまで消すと、圏外で二度と起動できなくなる。
      // 消すのはこのアプリのぶん（PREFIX で始まるもの）だけ。同じ住所の別のアプリのぶんは触らない。
      if (ready) {
        const names = await caches.keys();
        await Promise.all(
          names.filter((name) => isOwnCache(name) && name !== CACHE).map((name) => caches.delete(name)),
        );
      }

      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE)) return; // 同じ住所の別のアプリ
  if (request.cache === 'no-store') return; // 通信できるかの確認は必ず素通し

  event.respondWith(request.mode === 'navigate' ? handleNavigate() : handleAsset(request));
});

/**
 * 画面を開くとき。
 * どのアドレスで開いても、キャッシュしておいた外枠を返す。
 * その先の振り分けはアプリ側（expo-router）がアドレスを見て行う。
 *
 * 新しい番号のキャッシュがまだ空でも、古い番号に入っていれば起動できるよう、
 * このアプリのキャッシュを新しい順に全部探す（ownMatch）。
 */
async function handleNavigate() {
  const cached = await ownMatch(SHELL);
  if (cached) {
    void refresh(SHELL);
    return cached;
  }

  try {
    const response = await fetch(SHELL);
    // エラーの画面を貯めると、直ったあとも出続けるので貯めない
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(SHELL, response.clone());
    }
    return response;
  } catch {
    return new Response(
      '<!doctype html><meta charset="utf-8"><body style="background:#12121a;color:#f2f2f7;' +
        'font-family:sans-serif;padding:24px">' +
        '<h1>まだオフラインで開けません</h1>' +
        '<p>電波のあるところで一度開くと、次からは圏外でも開けるようになります。</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

/** JS・アイコンなど。あればキャッシュを返し、無ければ取りにいって貯める。 */
async function handleAsset(request) {
  const cached = await ownMatch(request);
  if (cached) {
    if (!isImmutable(new URL(request.url))) void refresh(request);
    return cached;
  }

  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

/** 裏でこっそり取り直す。圏外なら黙って諦める。 */
async function refresh(request) {
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response);
    }
  } catch {
    // オフライン。次の機会に取り直す
  }
}

/**
 * このアプリのキャッシュだけから探す。
 * `caches.match` は同じ住所の全部のキャッシュを見るので、別のアプリが同じアドレスを
 * 貯めていた場合にそちらを返してしまう。名前で絞って、新しい番号から順に探す。
 */
async function ownMatch(request) {
  const version = (name) => Number(name.slice(PREFIX.length + 1)) || 0; // 'taiko-kiroku-v3' → 3
  const names = (await caches.keys()).filter(isOwnCache).sort((a, b) => version(b) - version(a));
  for (const name of names) {
    const cache = await caches.open(name);
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  return undefined;
}
