// Панель настроек Overtone: кнопка в углу или Ctrl+Shift+O.
(() => {
  const ot = window.__ot;
  if (!ot || ot.settingsReady) return;
  ot.settingsReady = true;
  const { el } = ot;
  const THEMES = [
    ['default', 'Стандартная'], ['amoled', 'AMOLED'], ['glass', 'Стекло'],
    ['contrast', 'Контраст'], ['mica', 'Mica'], ['acrylic', 'Acrylic'],
  ];
  const DELAYS = [3, 5, 7, 10, 15];
  const HEIGHTS = [[480, '480p'], [720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']];
  let panel = null;

  const row = (title, hint, control) =>
    el('div', { className: 'ot-row' }, [
      el('div', { className: 'ot-row-text' }, [el('b', { textContent: title }), el('span', { textContent: hint })]),
      control,
    ]);
  const toggle = (name) => {
    const input = el('input', { type: 'checkbox', className: 'ot-toggle', checked: Boolean(ot.config[name]) });
    input.addEventListener('change', () => ot.set({ [name]: input.checked }));
    return input;
  };
  const CHEVRON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';
  let menu = null;
  let opener = null;
  const closeMenu = () => {
    menu?.remove();
    opener?.setAttribute('aria-expanded', 'false');
    menu = opener = null;
  };
  /** Свой выпадающий список вместо системного select: тот не стилизуется. */
  const select = (name, options) => {
    const same = (value) => String(value) === String(ot.config[name]);
    const button = el('button', { type: 'button', className: 'ot-dropdown' });
    button.append((options.find(([value]) => same(value)) || options[0])[1]);
    button.insertAdjacentHTML('beforeend', CHEVRON);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (opener === button) return closeMenu();
      closeMenu();
      menu = el('div', { className: 'ot-menu' }, options.map(([value, label]) => {
        const item = el('button', { type: 'button', textContent: label });
        item.setAttribute('aria-selected', String(same(value)));
        item.addEventListener('click', () => {
          closeMenu();
          ot.set({ [name]: value });
        });
        return item;
      }));
      document.body.append(menu);
      const box = button.getBoundingClientRect();
      menu.style.top = `${Math.min(box.bottom + 6, innerHeight - menu.offsetHeight - 8)}px`;
      menu.style.left = `${Math.max(8, box.right - menu.offsetWidth)}px`;
      button.setAttribute('aria-expanded', 'true');
      opener = button;
    });
    return button;
  };
  document.addEventListener('click', (event) => menu && !menu.contains(event.target) && closeMenu());

  function build() {
    const pills = el('div', { className: 'ot-pills' }, THEMES.map(([value, label]) => {
      const pill = el('button', { type: 'button', textContent: label, className: 'ot-pill' });
      pill.dataset.active = String(ot.config.theme === value);
      pill.addEventListener('click', () => ot.set({ theme: value }));
      return pill;
    }));
    // Прокси часто с логином и паролем: на экране не показываем.
    const proxy = el('input', { className: 'ot-input', type: 'password', placeholder: 'socks5://127.0.0.1:1080', value: ot.config.proxy || '' });
    proxy.addEventListener('change', () => ot.set({ proxy: proxy.value.trim() }));
    const cache = el('span', { textContent: '…' });
    const clear = el('button', { type: 'button', className: 'ot-pill', textContent: 'Очистить' });
    clear.addEventListener('click', async () => {
      await window.overtone.clearVideo();
      render();
    });
    const wrong = el('button', { type: 'button', className: 'ot-pill', textContent: 'Убрать у этого трека' });
    wrong.addEventListener('click', () => ot.rejectVideo());
    const problem = el('div', { className: 'ot-problem', hidden: true });
    window.overtone.videoStats().then(({ count, bytes, ytdlp, error }) => {
      cache.textContent = `${count} видео, ${(bytes / 1048576).toFixed(0)} МБ`;
      const text = ytdlp ? error : 'yt-dlp не установлен: клипы с YouTube не ищутся.';
      problem.textContent = text;
      problem.hidden = !text;
    });
    const section = (title) => el('h3', { className: 'ot-section', textContent: title });
    const audio = ot.audio || { PRESETS: {}, LOUDNESS: {} };
    const presets = Object.entries(audio.PRESETS).map(([key, value]) => [key, value.name]);
    const loudness = Object.entries(audio.LOUDNESS).map(([key, value]) => [key, value.name]);

    // Таймер сна: не настройка, а действие, поэтому кнопки.
    const left = ot.sleep?.left();
    const sleepNote = left === 'track' ? 'Пауза после текущего трека.' : left ? `Пауза через ${Math.ceil(left / 60000)} мин.` : 'Выключен.';
    const sleep = el('div', { className: 'ot-pills' }, [[15, '15'], [30, '30'], [60, '60'], [90, '90'], ['track', 'После трека'], [0, 'Выкл']].map(([value, label]) => {
      const pill = el('button', { type: 'button', className: 'ot-pill', textContent: label });
      pill.dataset.active = String(left === value || (value === 0 && !left));
      pill.addEventListener('click', () => {
        ot.sleep?.set(value);
        render();
      });
      return pill;
    }));

    const keys = el('span', { textContent: '' });
    window.overtone.hotkeys().then(({ failed }) => {
      keys.textContent = failed.length ? `Заняты другой программой: ${failed.join(', ')}` : '';
    });

    const lastfm = ot.config.lastfm || {};
    const apiKey = el('input', { className: 'ot-input', placeholder: 'API key', value: lastfm.apiKey || '', spellcheck: false });
    const secret = el('input', { className: 'ot-input', type: 'password', placeholder: lastfm.hasSecret ? 'секрет сохранён' : 'Shared secret', spellcheck: false });
    const saveKeys = () => ot.set({ lastfm: { apiKey: apiKey.value.trim(), ...(secret.value.trim() ? { secret: secret.value.trim() } : {}) } });
    apiKey.addEventListener('change', saveKeys);
    secret.addEventListener('change', saveKeys);
    const lastfmNote = el('span', { className: 'ot-note', textContent: lastfm.user ? `Вход выполнен: ${lastfm.user}` : 'Ключ и секрет — на last.fm/api/account/create (бесплатно).' });
    const step = (label, action) => {
      const node = el('button', { type: 'button', className: 'ot-pill', textContent: label });
      node.addEventListener('click', async () => {
        try {
          await action();
        } catch (error) {
          lastfmNote.textContent = String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        }
      });
      return node;
    };
    const lastfmButtons = lastfm.user
      ? [step('Выйти', () => window.overtone.lastfm.logout())]
      : [
          step('Войти', async () => {
            await saveKeys();
            await window.overtone.lastfm.login();
            lastfmNote.textContent = 'Подтверди доступ в браузере, потом нажми «Готово».';
          }),
          step('Готово', async () => {
            const user = await window.overtone.lastfm.finish();
            lastfmNote.textContent = `Вход выполнен: ${user}`;
          }),
        ];

    const close = el('button', { type: 'button', className: 'ot-close', textContent: '×', ariaLabel: 'Закрыть' });
    close.addEventListener('click', toggleOpen);
    return el('div', { id: 'ot-settings' }, [
      el('header', {}, [el('b', { textContent: 'Overtone' }), close]),
      section('Вид'),
      row('Тема', 'Mica и Acrylic работают на Windows 11.', pills),
      row('Живой фон', 'В полноэкранном плеере, когда нет клипа: цвета обложки двигаются под музыку.', toggle('liveBackground')),
      section('Звук'),
      row('Эквалайзер', 'Готовые настройки звука.', select('eqPreset', presets)),
      row('Громкость', 'Ровная — все треки одинаково громкие. Громко и Очень громко — выше 100%, без хрипа.', select('loudness', loudness)),
      section('Видео'),
      row('Видео трека', 'В полноэкранном плеере обложка плавно сменяется клипом. Клик по экрану убирает его.', toggle('video')),
      row('Видео Яндекс Музыки', 'Фоновое видео трека, если оно у него есть.', toggle('videoYm')),
      row('Клипы с YouTube', 'Ищется, когда своего видео у трека нет.', toggle('videoYoutube')),
      row('Задержка перед клипом', 'Секунд от начала трека.', select('videoDelay', DELAYS.map((s) => [s, `${s} с`]))),
      row('Качество клипа', 'Выше качество — дольше загрузка.', select('videoHeight', HEIGHTS)),
      section('SoundCloud'),
      row('Качество SoundCloud', 'Применяется к следующему треку.', select('scQuality', [['high', 'AAC 160'], ['low', 'AAC 96']])),
      row('Замена недоступных', 'Серые треки Яндекса ищутся на SoundCloud и играют оттуда. Только при точном совпадении.', toggle('scReplace')),
      row('Прокси для YouTube', 'Пусто — напрямую.', proxy),
      problem,
      row('Кеш видео', '', el('div', { className: 'ot-inline' }, [cache, clear])),
      row('Не тот клип', 'Удалить клип текущего трека и больше не искать.', wrong),
      section('Управление'),
      row('Глобальные клавиши', 'Ctrl+Alt+P пауза, Ctrl+Alt+←/→ трек, Ctrl+Alt+L лайк, Ctrl+Alt+↑/↓ громкость. Работают в любой программе.', toggle('hotkeysEnabled')),
      keys,
      row('Таймер сна', sleepNote, sleep),
      row('Пауза при блокировке', 'Win+L ставит музыку на паузу.', toggle('pauseOnLock')),
      row('Пауза без наушников', 'Отключил наушники — музыка встала, а не заиграла на весь дом.', toggle('pauseOnHeadphones')),
      row('Без рекламы и слежки', 'Блокирует рекламу, Яндекс Метрику и вебвизор. Рекомендации не страдают.', toggle('blockAds')),
      section('Last.fm'),
      row('Скробблинг', '', el('div', { className: 'ot-stack' }, [apiKey, secret, el('div', { className: 'ot-inline' }, lastfmButtons), lastfmNote])),
    ]);
  }

  function render() {
    closeMenu();
    if (!panel) return;
    const next = build();
    panel.replaceWith(next);
    panel = next;
  }
  function toggleOpen() {
    closeMenu();
    if (panel) {
      panel.remove();
      panel = null;
    } else {
      panel = build();
      document.body.append(panel);
    }
  }

  const button = el('button', { id: 'ot-button', type: 'button', title: 'Overtone (Ctrl+Shift+O)', textContent: 'Overtone' });
  button.addEventListener('click', toggleOpen);
  // Приложение перерисовывает боковую панель, поэтому место кнопки проверяется на каждом тике.
  const place = () => {
    const navbar = document.querySelector('[data-test-id="NAVBAR"]') || document.body;
    if (button.parentNode !== navbar) navbar.append(button);
  };
  ot.on('tick', place);
  place();
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && event.code === 'KeyO') toggleOpen();
    else if (event.key === 'Escape' && panel) toggleOpen();
  });
  // Клик мимо панели всегда её закрывает, где бы она ни была открыта.
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!panel || panel.contains(event.target) || button.contains(event.target) || menu?.contains(event.target)) return;
      toggleOpen();
    },
    true,
  );
  ot.on('config', render);
})();
