// Темы: вся работа в CSS по атрибуту на <html>. Здесь только атрибут и фон из обложки для стекла.
(() => {
  const ot = window.__ot;
  if (!ot || ot.themeReady) return;
  ot.themeReady = true;
  const root = document.documentElement;
  let backdrop = null;
  let front = 0;

  function paint(track) {
    if (!backdrop || !track?.cover) return;
    const image = new Image();
    image.onload = () => {
      front = 1 - front;
      const layers = backdrop.children;
      layers[front].style.backgroundImage = `url("${track.cover}")`;
      layers[front].style.opacity = '1';
      layers[1 - front].style.opacity = '0';
    };
    image.src = track.cover;
  }

  function apply() {
    const theme = ot.config.theme || 'default';
    root.dataset.otTheme = theme;
    if (theme === 'glass' && !backdrop) {
      backdrop = ot.el('div', { id: 'ot-backdrop' }, [ot.el('div'), ot.el('div')]);
      document.body.prepend(backdrop);
      paint(ot.track());
    } else if (theme !== 'glass' && backdrop) {
      backdrop.remove();
      backdrop = null;
    }
    ot.emit('theme', theme);
  }

  ot.on('config', apply);
  ot.on('track', paint);
  apply();
})();
