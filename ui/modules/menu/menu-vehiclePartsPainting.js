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
    .run(['$injector', '$window', function ($injector, $window) {
      var api = resolveBngApi($injector, $window)
      if (!api) { return }
      runLua(api, 'extensions.load("ui_topBar_vehiclePartsPainting")')
    }])
    .config(['$stateProvider', function ($stateProvider) {
      $stateProvider.state('menu.vehiclePartsPainting', {
        url: '/vehicle-parts-painting',
        templateUrl: '/ui/modules/menu/menu-vehiclePartsPainting.html',
        controllerAs: '$ctrl',
        controller: ['$state', '$injector', '$window', function ($state, $injector, $window) {
          var api = resolveBngApi($injector, $window)

          function callLua(code) {
            if (!code) { return }
            if (!api) {
              api = resolveBngApi($injector, $window)
            }
            if (!api) { return }
            runLua(api, code)
          }

          this.close = function () {
            callLua('freeroam_vehiclePartsPainting.close()')

            if ($state && typeof $state.go === 'function') {
              try {
                $state.go('^')
                return
              } catch (err) { /* ignore and try fallbacks */ }

              try {
                $state.go('menu')
                return
              } catch (err2) { /* ignore */ }
            }

            if ($window && $window.history && typeof $window.history.back === 'function') {
              $window.history.back()
            }
          }
        }],
        uiAppsShown: true,
        backState: 'BACK_TO_MENU',
        onEnter: ['$injector', '$window', function ($injector, $window) {
          var api = resolveBngApi($injector, $window)
          if (!api) { return }
          runLua(api, 'extensions.load("ui_topBar_vehiclePartsPainting")')
          runLua(api, 'extensions.load("freeroam_vehiclePartsPainting")')
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
