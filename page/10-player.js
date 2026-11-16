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
  ot.on('tick', () => {
    const track = ot.track();
    const key = track ? `${track.id}|${track.title}|${track.artist}` : '';
    if (key === lastKey) return;
    lastKey = key;
    ot.emit('track', track);
  });
})();
