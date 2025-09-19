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

  function closeToParentState($state, $window) {
    if ($state && typeof $state.go === 'function') {
      if (typeof $state.get === 'function') {
        var preferredStates = ['menu.mainmenu', 'menu.home', 'menu']
        for (var i = 0; i < preferredStates.length; i++) {
          var targetName = preferredStates[i]
          try {
            if ($state.get(targetName)) {
              $state.go(targetName)
              return true
            }
          } catch (err) {
            if ($window && $window.console && typeof $window.console.debug === 'function') {
              $window.console.debug('VehiclePartsPainting menu: unable to navigate to state', targetName, err)
            }
          }
        }
      }

      try {
        $state.go('^')
        return true
      } catch (errParent) {
        if ($window && $window.console && typeof $window.console.debug === 'function') {
          $window.console.debug('VehiclePartsPainting menu: unable to navigate to parent state.', errParent)
        }
      }
    }

    if ($window && $window.history && typeof $window.history.back === 'function') {
      $window.history.back()
      return true
    }

    return false
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
        controller: 'VehiclePartsPaintingInstructionsCtrl as $ctrl',
        uiAppsShown: true,
        backState: 'BACK_TO_MENU',
        onEnter: ['$injector', '$window', function ($injector, $window) {
          var api = resolveBngApi($injector, $window)
          if (!api) { return }
          runLua(api, 'extensions.load("ui_topBar_vehiclePartsPainting")')
          runLua(api, 'extensions.load("freeroam_vehiclePartsPainting")')
          runLua(api, 'freeroam_vehiclePartsPainting.open()')
          runLua(api, 'ui_topBar.setActiveItem("vehiclePartsPainting")')
        }],
        onExit: ['$injector', '$window', function ($injector, $window) {
          var api = resolveBngApi($injector, $window)
          if (!api) { return }
          runLua(api, 'freeroam_vehiclePartsPainting.close()')
          runLua(api, 'ui_topBar.setActiveItem("")')
        }]
      })
    }])
    .controller('VehiclePartsPaintingInstructionsCtrl', [
      '$element',
      '$injector',
      '$scope',
      '$state',
      '$timeout',
      '$window',
      function ($element, $injector, $scope, $state, $timeout, $window) {
        var vm = this
        var hasClosed = false
        var windowElement = angular.element($window)

        vm.onDialogClick = function (event) {
          if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation()
          }
        }

        vm.onBackdropClick = function (event) {
          if (event) {
            if (typeof event.preventDefault === 'function') { event.preventDefault() }
            if (typeof event.stopPropagation === 'function') { event.stopPropagation() }
          }
          vm.close()
        }

        vm.onKeyDown = function (event) {
          if (!event) { return }
          var key = event.key || event.keyCode
          if (key === 'Escape' || key === 'Esc' || key === 27) {
            if (typeof event.preventDefault === 'function') { event.preventDefault() }
            vm.close()
          }
        }

        vm.close = function (event) {
          if (event) {
            if (typeof event.preventDefault === 'function') { event.preventDefault() }
            if (typeof event.stopPropagation === 'function') { event.stopPropagation() }
          }

          if (hasClosed) { return }

          var navigated = closeToParentState($state, $window)
          if (!navigated) { return }

          hasClosed = true

          var api = resolveBngApi($injector, $window)
          runLua(api, 'freeroam_vehiclePartsPainting.close()')
          runLua(api, 'ui_topBar.setActiveItem("")')
        }

        function handleWindowKeyDown(event) {
          vm.onKeyDown(event)
        }

        windowElement.on('keydown', handleWindowKeyDown)

        $scope.$on('$destroy', function () {
          windowElement.off('keydown', handleWindowKeyDown)
        })

        $timeout(function () {
          var focusTarget = $element[0] && $element[0].querySelector('[data-focus-target]')
          if (focusTarget && typeof focusTarget.focus === 'function') {
            try {
              focusTarget.focus()
            } catch (err) {
              if ($window && $window.console && typeof $window.console.debug === 'function') {
                $window.console.debug('VehiclePartsPainting menu: unable to focus dialog container.', err)
              }
            }
          }

          var closeButton = $element[0] && $element[0].querySelector('[data-role="vehicle-parts-painting-close"]')
          if (closeButton && typeof closeButton.focus === 'function') {
            try {
              closeButton.focus()
            } catch (errButton) {
              if ($window && $window.console && typeof $window.console.debug === 'function') {
                $window.console.debug('VehiclePartsPainting menu: unable to focus close button.', errButton)
              }
            }
          }
        }, 0, false)
      }
    ])
})()
