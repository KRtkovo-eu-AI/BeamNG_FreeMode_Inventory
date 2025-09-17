(function () {
  'use strict'

  function resolveBngApi($injector, $window) {
    if ($injector && typeof $injector.has === 'function' && $injector.has('bngApi')) {
      try {
        var service = $injector.get('bngApi')
        if (service) { return service }
      } catch (err) {
        if (typeof $window !== 'undefined' && $window.console && typeof $window.console.warn === 'function') {
          $window.console.warn('VehiclePartsPainting menu: unable to resolve Angular bngApi service.', err)
        }
      }
    }

    if ($window && $window.bngApi) { return $window.bngApi }
    return null
  }

  function runLua(api, code) {
    if (!api || typeof api.engineLua !== 'function' || !code) { return }
    try {
      api.engineLua(code)
    } catch (err) {
      if (typeof window !== 'undefined' && window.console && typeof window.console.warn === 'function') {
        window.console.warn('VehiclePartsPainting menu: failed to run Lua command.', code, err)
      }
    }
  }

  angular.module('BeamNG.ui')
    .config(['$stateProvider', function ($stateProvider) {
      $stateProvider.state('menu.vehiclePartsPainting', {
        url: '/vehicle-parts-painting',
        template: '<vehicle-parts-painting ui-sref-opts="{ inherit: true }"></vehicle-parts-painting>',
        controller: angular.noop,
        uiAppsShown: true,
        backState: 'BACK_TO_MENU',
        onEnter: ['$injector', '$window', function ($injector, $window) {
          var api = resolveBngApi($injector, $window)
          if (!api) { return }
          runLua(api, 'extensions.load("freeroam_vehiclePartsPainting")')
          runLua(api, 'freeroam_vehiclePartsPainting.open()')
          runLua(api, 'ui_topBar.setActiveItem("vehiclePartsPainting")')
        }],
        onExit: ['$injector', '$window', function ($injector, $window) {
          var api = resolveBngApi($injector, $window)
          if (!api) { return }
          runLua(api, 'freeroam_vehiclePartsPainting.close()')
        }]
      })
    }])
})()
