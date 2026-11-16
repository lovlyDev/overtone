// Ответы SoundCloud создаём в основном мире страницы: у CDP-ответов Electron теряет HTTP-статус.
(() => {
  const ot = window.__ot;
  if (!ot || ot.apiReady) return;
  ot.apiReady = true;
  const original = window.fetch;
  window.fetch = async function (input, options) {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== 'https://api.music.yandex.net') return original.call(this, input, options);
    const method = (options?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    // Родные запросы пропускаем сразу; карточки, статистика и синхронизация требуют проверки тела.
    if (!/50c10ad0-|70\d{11}|\/users\/70\/playlists\//.test(url.href) && !['/tracks', '/plays'].includes(url.pathname)) {
      return original.call(this, input, options);
    }
    const request = new Request(input, options);
    request.signal.throwIfAborted();
    const body = ['GET', 'HEAD'].includes(method) ? '' : await request.clone().text();
    const reply = await window.overtone.api({ url: url.href, method, body });
    request.signal.throwIfAborted();
    if (!reply) return original.call(this, input, options);
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  };
})();
