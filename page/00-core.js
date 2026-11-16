// Общая основа страничной части: конфиг, события, один таймер на всё.
(() => {
  if (window.__ot || !window.overtone) return;
  const handlers = new Map();
  const ot = (window.__ot = {
    config: window.overtone.config(),
    on(name, handler) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(handler);
    },
    emit(name, data) {
      handlers.get(name)?.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[overtone] ${name}`, error);
        }
      });
    },
    set: (patch) => window.overtone.set(patch),
    el(tag, props = {}, children = []) {
      const node = Object.assign(document.createElement(tag), props);
      node.append(...children);
      return node;
    },
  });
  window.overtone.onConfig((config) => {
    ot.config = config;
    ot.emit('config', config);
  });
  // Модули ниже подписываются на 'tick'; своих таймеров не заводят.
  setInterval(() => ot.emit('tick', performance.now()), 500);
})();
