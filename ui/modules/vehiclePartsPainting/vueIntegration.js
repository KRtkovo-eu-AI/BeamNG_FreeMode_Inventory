(function () {
  'use strict';

  const ROUTE_NAME = 'menu.vehiclePartsPainting';
  const ROUTE_PATH = '/vehicle-parts-painting';
  const ROUTE_DEFINITION = {
    path: ROUTE_PATH,
    name: ROUTE_NAME,
    meta: {
      topBar: { visible: true },
      uiApps: { shown: true },
      infoBar: { withAngular: true, visible: false, showSysInfo: false },
      clickThrough: true
    }
  };

  const TRANSLATIONS = {
    'en-US': {
      vehiclePartsPainting: {
        topbarLabel: 'Vehicle Parts Painting'
      }
    }
  };

  function mergeTranslations() {
    if (!window.vueI18n || !window.vueI18n.global || typeof window.vueI18n.global.mergeLocaleMessage !== 'function') {
      return false;
    }

    try {
      Object.keys(TRANSLATIONS).forEach(locale => {
        window.vueI18n.global.mergeLocaleMessage(locale, TRANSLATIONS[locale]);
      });

      const currentLocale = window.vueI18n.global.locale && window.vueI18n.global.locale.value;
      if (currentLocale && !TRANSLATIONS[currentLocale]) {
        window.vueI18n.global.mergeLocaleMessage(currentLocale, TRANSLATIONS['en-US']);
      }
      return true;
    } catch (err) {
      console.error('VehiclePartsPainting: failed to merge translations', err);
    }
    return false;
  }

  function getRouter() {
    if (window.bngVue && window.bngVue.router) {
      return window.bngVue.router;
    }
    if (window.$router) {
      return window.$router;
    }
    return null;
  }

  function registerRoute() {
    const router = getRouter();
    if (!router || typeof router.addRoute !== 'function') {
      return false;
    }

    try {
      if (window.bngVue && !window.bngVue.router) {
        window.bngVue.router = router;
      }
      if (typeof router.hasRoute === 'function') {
        if (router.hasRoute(ROUTE_NAME)) { return true; }
      }
      router.addRoute(ROUTE_DEFINITION);
      return true;
    } catch (err) {
      console.error('VehiclePartsPainting: failed to register Vue route', err);
    }
    return false;
  }

  function attemptIntegration() {
    const merged = mergeTranslations();
    const routed = registerRoute();
    return merged && routed;
  }

  function scheduleIntegration() {
    if (attemptIntegration()) {
      return;
    }

    let retries = 0;
    const timer = window.setInterval(function () {
      retries += 1;
      if (attemptIntegration() || retries > 30) {
        window.clearInterval(timer);
      }
    }, 500);
  }

  if (window.bngVue && typeof window.bngVue.start === 'function') {
    const originalStart = window.bngVue.start;
    window.bngVue.start = function (...args) {
      const result = originalStart.apply(this, args);
      window.setTimeout(scheduleIntegration, 0);
      return result;
    };
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    scheduleIntegration();
  } else {
    window.addEventListener('DOMContentLoaded', scheduleIntegration, { once: true });
  }
})();
