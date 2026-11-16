// SoundCloud в интерфейсе: пункт в боковой панели и окошко поиска. Всё остальное — страница, плеер,
// очередь, лайки — родное: результаты открываются как обычный плейлист приложения (см. core/api.js).
(() => {
  const ot = window.__ot;
  if (!ot || ot.scReady) return;
  ot.scReady = true;
  const { el } = ot;
  const sc = window.overtone.sc;
  const CLOUD = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.2 4 4 0 0 1 17.5 18H7z"/></svg>';
  let nav = null;
  let pop = null;
  let busy = false;

  /** Переход внутри приложения, без перезагрузки страницы. */
  function open(uuid) {
    const address = `/playlists?playlistUuid=${uuid}`;
    if (window.next?.router?.push) window.next.router.push(address);
    else location.href = address;
    close();
  }

  function close() {
    pop?.remove();
    pop = null;
  }

  async function show() {
    if (pop) return close();
    const input = el('input', { placeholder: 'Поиск или ссылка SoundCloud', spellcheck: false });
    const status = el('p', { className: 'ot-sc-status', textContent: 'Название, исполнитель или ссылка на трек, плейлист, профиль. Enter — искать' });
    const recent = el('div', { className: 'ot-sc-recent ot-scroll' });
    pop = el('div', { id: 'ot-sc-pop' }, [input, status, recent]);
    document.body.append(pop);
    const box = nav.getBoundingClientRect();
    pop.style.left = `${box.right + 12}px`;
    pop.style.top = `${Math.min(box.top, innerHeight - 360)}px`;
    input.focus();
    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Escape') return close();
      if (event.key !== 'Enter' || busy || !input.value.trim()) return;
      busy = true;
      status.dataset.busy = 'true';
      status.textContent = /soundcloud\.com|snd\.sc/i.test(input.value) ? 'Открываю ссылку…' : 'Ищу на SoundCloud…';
      try {
        open(await sc.search(input.value));
      } catch (error) {
        status.textContent = `Не получилось: ${String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`;
      } finally {
        busy = false;
        status.dataset.busy = 'false';
      }
    });
    const items = await sc.recent().catch(() => []);
    recent.replaceChildren(
      ...items.slice(0, 12).map((item) => {
        const node = el('button', { type: 'button', textContent: item.query, title: item.query });
        node.addEventListener('click', () => open(item.uuid));
        return node;
      }),
    );
  }

  function place() {
    if (nav) {
      const active = new URLSearchParams(location.search).get('playlistUuid')?.startsWith('50c10ad0-');
      nav.dataset.active = String(!!active);
      if (active) nav.querySelector('a')?.setAttribute('aria-current', 'page');
      else nav.querySelector('a')?.removeAttribute('aria-current');
    }
    for (const link of document.querySelectorAll('a[href*="trackId="]')) {
      const own = /trackId=70\d{11}(?:&|$)/.test(link.getAttribute('href'));
      const badge = link.querySelector('.ot-sc-badge');
      if (!own) badge?.remove();
      else if (!badge) link.append(el('span', { className: 'ot-sc-badge', textContent: 'SC', title: 'SoundCloud', ariaLabel: 'SoundCloud' }));
    }
    const list = document.querySelector('[class*="NavbarDesktop_navi"]');
    if (!list || nav?.isConnected) return;
    const sample = document.querySelector('[data-test-id="NAVBAR_NAVIGATION_ITEM_CONCERTS"]')?.closest('li');
    if (!sample) return;
    nav = sample.cloneNode(true);
    nav.id = 'ot-sc-nav';
    const link = nav.querySelector('a');
    link.removeAttribute('href');
    link.removeAttribute('data-test-id');
    link.querySelector('svg')?.replaceWith(Object.assign(document.createElement('span'), { className: 'ot-sc-navicon', innerHTML: CLOUD }));
    const label = nav.querySelector('span[title]') || nav.querySelector('span');
    label.textContent = 'SoundCloud';
    label.title = 'SoundCloud';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      show();
    });
    list.append(nav);
  }

  document.addEventListener(
    'pointerdown',
    (event) => pop && !pop.contains(event.target) && !nav?.contains(event.target) && close(),
    true,
  );
  ot.on('tick', place);
  place();
})();
