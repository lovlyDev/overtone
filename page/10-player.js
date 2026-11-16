// Единственное место, которое знает внутренности приложения: что играет и на какой секунде.
// После обновления Яндекс Музыки чинить нужно здесь.
(() => {
  const ot = window.__ot;
  if (!ot || ot.track) return;
  const ANCHORS = ['[class*="CommonLayout_root"]', '[data-test-id="NAVBAR"]', '[class*="PlayerBar_root"]', '[data-test-id="FULLSCREEN_PLAYER_MODAL"]'];
  let store = null;

  const fiberOf = (element) => {
    const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'));
    return key ? element[key] : null;
  };
  const unbox = (box) => (box && typeof box === 'object' && 'value' in box ? box.value : box);

  /** Корневое хранилище приложения лежит в React-контексте выше плеера. */
  function findStore() {
    if (store) return store;
    for (const selector of ANCHORS) {
      const element = document.querySelector(selector);
      let fiber = element && fiberOf(element);
      for (let depth = 0; fiber && depth < 800; depth += 1, fiber = fiber.return) {
        const value = fiber.memoizedProps?.value;
        if (value && typeof value === 'object' && value.sonataState) return (store = value);
      }
    }
    return null;
  }

  function fromStore() {
    const sonata = findStore()?.sonataState;
    if (!sonata) return null;
    const meta = unbox(sonata.entityMeta) || unbox(sonata.queueState?.currentEntity)?.entityData?.meta;
    if (!meta?.title) return null;
    return {
      id: meta.realId || meta.id,
      title: [meta.title, meta.version && `(${meta.version})`].filter(Boolean).join(' '),
      artist: (meta.artists || []).map((artist) => artist.name).join(', '),
      durationMs: meta.durationMs || 0,
      cover: meta.coverUri ? `https://${meta.coverUri.replace('%%', '400x400')}` : '',
    };
  }

  function fromMediaSession() {
    const meta = navigator.mediaSession?.metadata;
    if (!meta?.title) return null;
    return { id: null, title: meta.title, artist: meta.artist || '', durationMs: 0, cover: meta.artwork?.at(-1)?.src || '' };
  }

  ot.track = () => {
    try {
      return fromStore() || fromMediaSession();
    } catch {
      store = null;
      return fromMediaSession();
    }
  };
  /** Позиция в секундах или null, если узнать не удалось. */
  ot.position = () => {
    try {
      const position = unbox(findStore()?.sonataState?.position);
      return typeof position === 'number' ? position : null;
    } catch {
      return null;
    }
  };

  let lastKey = '';
  const failures = new Map();
  const skipped = new Set();
  let recoverySince = 0;
  let waitingKey = '';
  let waitingSince = 0;
  let noticeTimer;
  function notice(message) {
    let node = document.getElementById('ot-sc-notice');
    if (!node) {
      node = ot.el('div', { id: 'ot-sc-notice', role: 'status' });
      node.setAttribute('aria-live', 'polite');
      document.body.append(node);
    }
    node.textContent = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => node.remove(), 7000);
  }
  const rememberFailure = (failure) => {
    failures.set(String(failure.id), failure);
    if (String(Number(ot.track()?.id) - 7000000000000) === String(failure.id)) notice(failure.message);
  };
  window.overtone.sc.onUnavailable(rememberFailure);
  ot.on('sc-unavailable', rememberFailure);
  function recover(id, message) {
    const bar = document.querySelector('[class*="PlayerBar_root"]');
    const next = bar?.querySelector('[data-test-id="NEXT_TRACK_BUTTON"]');
    const pause = () => [...(bar?.querySelectorAll('button') || [])].find((button) => /пауза|приостанов/i.test(button.ariaLabel || '') || button.dataset.testId === 'PAUSE_BUTTON')?.click();
    if (Date.now() - recoverySince > 60_000) { skipped.clear(); recoverySince = Date.now(); }
    if (skipped.has(id) || skipped.size >= 5 || !next || next.disabled || !findStore()?.sonataState.canMoveForward) {
      pause();
      notice(`${message}. Воспроизведение остановлено — выберите другой трек.`);
      waitingSince = Infinity;
      return;
    }
    skipped.add(id);
    notice(`${message}. Перехожу к следующему треку.`);
    waitingSince = Infinity;
    next.click();
    setTimeout(() => {
      if (String(ot.track()?.id) === id && /buffer|loading|error/i.test(String(unbox(findStore()?.sonataState?.status)))) {
        pause();
        notice('Не удалось перейти дальше. Выберите другой трек.');
      }
    }, 2000);
  }
  ot.on('tick', () => {
    const track = ot.track();
    const id = String(track?.id || '');
    const status = String(unbox(findStore()?.sonataState?.status) || '');
    if (id !== waitingKey) { waitingKey = id; waitingSince = Date.now(); }
    if (/^70\d{11}$/.test(id) && /buffer|loading|error/i.test(status)) {
      const failure = failures.get(String(Number(id) - 7000000000000));
      if (failure && Date.now() - failure.at < 60_000 && waitingSince !== Infinity) recover(id, failure.message);
      else if (Date.now() - waitingSince > 35_000) recover(id, 'SoundCloud не ответил вовремя');
    } else if (/playing/i.test(status) && ot.position() > 1) {
      skipped.clear();
      waitingSince = Date.now();
    }
    const key = track ? `${track.id}|${track.title}|${track.artist}` : '';
    if (key === lastKey) return;
    lastKey = key;
    ot.emit('track', track);
  });
})();
