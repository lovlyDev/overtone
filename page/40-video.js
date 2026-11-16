// Видео трека в полноэкранном плеере: через несколько секунд обложка мигает и плавно уступает клипу.
// Клик по свободному месту убирает клип до следующего трека.
(() => {
  const ot = window.__ot;
  if (!ot || ot.videoReady) return;
  ot.videoReady = true;
  const MODAL = '[data-test-id="FULLSCREEN_PLAYER_MODAL"]';
  const CONTROLS = 'button, a, input, [role="slider"], [role="button"], [class*="slider" i], #ot-settings';
  const CUE_MS = 2200; // сколько обложка мигает перед появлением клипа
  const DRIFT = 0.6; // допустимое расхождение клипа и трека, секунды
  const SAME_LENGTH = 4; // клип считается «тем же треком», если длина отличается не больше
  const root = document.documentElement;

  let layer = null;
  let player = null;
  let key = '';
  let since = 0;
  let request = 0;
  let source = null; // { url, kind }
  let ready = false;
  let dismissed = false;
  let lastPosition = null;

  const phase = (value) => (value ? (root.dataset.otVideo = value) : delete root.dataset.otVideo);

  function drop() {
    request += 1;
    phase(null);
    ready = false;
    if (player) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    if (source) window.overtone.releaseVideo(source.url);
    source = null;
  }

  function unmount() {
    drop();
    layer?.remove();
    layer = player = null;
    key = '';
  }

  function mount(modal) {
    if (layer?.isConnected && layer.parentNode === modal) return;
    // Плеер закрыли и открыли заново: слой новый, видео нужно запросить ещё раз.
    drop();
    layer?.remove();
    key = '';
    player =ot.el('video', { muted: true, playsInline: true, loop: true, preload: 'auto' });
    player.addEventListener('canplay', () => (ready = true));
    layer = ot.el('div', { id: 'ot-video' }, [player]);
    modal.prepend(layer);
  }

  async function load(track) {
    const mine = (request += 1);
    const found = await window.overtone.video(track).catch(() => null);
    if (mine !== request || !player) {
      if (found) window.overtone.releaseVideo(found.url);
      return;
    }
    if (!found) return;
    source = found;
    player.src = found.url;
  }

  function follow(track) {
    const position = ot.position();
    const playing = position === null || position !== lastPosition;
    lastPosition = position;
    if (!playing) return player.pause();
    if (player.paused) player.play().catch(() => {});
    const length = (track.durationMs || 0) / 1000;
    const synced = source.kind === 'yt' && position !== null && length && Math.abs(player.duration - length) <= SAME_LENGTH;
    if (synced && Math.abs(player.currentTime - position) > DRIFT) player.currentTime = position;
  }

  ot.on('tick', (now) => {
    const modal = ot.config.video && document.querySelector(MODAL);
    if (!modal) return layer && unmount();
    const track = ot.track();
    if (!track) return;
    mount(modal);
    const current = `${track.id}|${track.title}|${track.artist}`;
    if (current !== key) {
      key = current;
      drop();
      dismissed = false;
      since = now;
      load(track);
      return;
    }
    if (dismissed || !ready) return;
    const state = root.dataset.otVideo;
    if (state === 'on') return follow(track);
    if (state === 'cue' || now - since < (Number(ot.config.videoDelay) || 7) * 1000) return;
    phase('cue');
    const mine = request;
    setTimeout(() => {
      if (mine !== request || dismissed) return;
      phase('on');
      player.play().catch(() => {});
    }, CUE_MS);
  });

  document.addEventListener(
    'click',
    (event) => {
      if (!root.dataset.otVideo || !event.target.closest?.(MODAL) || event.target.closest(CONTROLS)) return;
      dismissed = true;
      phase(null);
      setTimeout(() => dismissed && player?.pause(), 1600);
    },
    true,
  );

  /** «Не тот клип»: убрать сейчас и больше для этого трека не показывать. */
  ot.rejectVideo = () => {
    const track = ot.track();
    if (!track) return;
    dismissed = true;
    drop();
    window.overtone.rejectVideo(track);
  };
  ot.on('config', () => !ot.config.video && layer && unmount());
})();
