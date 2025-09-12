angular.module('beamng.apps')
.directive('okAdaptiveCruiseControl', ['$log', function ($log) {
  return {
    template:
      '<div class="ok-adaptive-cruise-control-container">' +
      '  <object id="ccSvg" style="width:100%; height:80%;" type="image/svg+xml" data="/ui/modules/apps/okAdaptiveCruiseControl/okAdaptiveCruiseControl_t01.svg"></object>' +
      '  <div style="text-align:center; margin-top:4px;">' +
      '    <label><input type="checkbox" id="accToggle"> ACC</label>' +
      '    <label style="margin-left:6px;"> <input type="number" id="accTimeGap" value="2" min="0.5" max="5" step="0.1" style="width:50px;"> s</label>' +
      '  </div>' +
      '</div>',
    replace: true,
    restrict: 'EA',
    scope: true,
    link: function (scope, element, attrs) {
      var unitMultiplier = {
        'metric': 3.6,
        'imperial': 2.23694
      }

      let svgObj = angular.element(element[0].querySelector('#ccSvg'))
      let adaptiveToggle = angular.element(element[0].querySelector('#accToggle'))
      let gapInput = angular.element(element[0].querySelector('#accTimeGap'))

      adaptiveToggle.on('change', function () {
        bngApi.activeObjectLua(`extensions.okAdaptiveCruiseControl.setAdaptiveEnabled(${adaptiveToggle[0].checked})`)
        bngApi.activeObjectLua('extensions.okAdaptiveCruiseControl.requestState()')
      })

      gapInput.on('change', function () {
        bngApi.activeObjectLua(`extensions.okAdaptiveCruiseControl.setTimeGap(${gapInput.val()})`)
        bngApi.activeObjectLua('extensions.okAdaptiveCruiseControl.requestState()')
      })

      svgObj.on('load', function () {
        let svg = svgObj[0].contentDocument
        let setBtn = angular.element(svg.getElementById('set_btn'))
        let resBtn = angular.element(svg.getElementById('res_btn'))
        let ccBtn = angular.element(svg.getElementById('cc_btn'))
        let ccIcon = svg.getElementById('cc_icon')
        let upBtn = angular.element(svg.getElementById('up_btn'))
        let downBtn = angular.element(svg.getElementById('down_btn'))
        let speedTxt = svg.getElementById('target_speed_txt')
        let state = null
        let speedStep = 1 / 3.6
        let speedMult = 1
        let offColor = '#949494'
        let onColor = '#FF6600'
        let incSpeed = 1
        let speedChangeDir = 1
        let changeValueIncreaseId

        scope.$on('SettingsChanged', function (event, data) {
          speedStep = 1 / unitMultiplier[data.values.uiUnitLength]
          bngApi.activeObjectLua('extensions.okAdaptiveCruiseControl.requestState()')
        })

        setBtn.on('click', function () {
          bngApi.activeObjectLua('extensions.okAdaptiveCruiseControl.holdCurrentSpeed()')
        })

        resBtn.on('click', function () {
          if (!state.isEnabled && state.targetSpeed > 0.1) {
            bngApi.activeObjectLua('extensions.okAdaptiveCruiseControl.setEnabled(true)')
          }
        })

        ccBtn.on('click', function () {
          bngApi.activeObjectLua(`extensions.okAdaptiveCruiseControl.setEnabled(${!state.isEnabled})`)
          bngApi.activeObjectLua('extensions.okAdaptiveCruiseControl.requestState()')
        })

        function setNewSpeed(newVal) {
          bngApi.activeObjectLua(`extensions.okAdaptiveCruiseControl.setSpeed(${newVal})`)
          bngApi.activeObjectLua('extensions.okAdaptiveCruiseControl.requestState()')
        }

        function changeSpeedInc() {
          if(incSpeed === 0) return
          setNewSpeed(state.targetSpeed + (speedStep * incSpeed * speedMult * speedChangeDir))
          incSpeed *= 1.1
        }

        downBtn.on('mousedown', function () {
          incSpeed = 1
          speedChangeDir = -1
          changeSpeedInc()
          changeValueIncreaseId = setInterval(changeSpeedInc, 150)
        })
        downBtn.on('mouseup', function () {
          incSpeed = 0
          clearTimeout(changeValueIncreaseId)
        })
        downBtn.on('mouseout', function () {
          incSpeed = 0
          clearTimeout(changeValueIncreaseId)
        })

        upBtn.on('mousedown', function () {
          incSpeed = 1
          speedChangeDir = 1
          changeSpeedInc()
          changeValueIncreaseId = setInterval(changeSpeedInc, 150)
        })
        upBtn.on('mouseup', function () {
          incSpeed = 0
          clearTimeout(changeValueIncreaseId)
        })
        upBtn.on('mouseout', function () {
          incSpeed = 0
          clearTimeout(changeValueIncreaseId)
        })


        scope.$on('okAdaptiveCruiseControlState', function (event, data) {
          scope.$evalAsync(function() {
            state = data
            speedTxt.innerHTML = Math.round(state.targetSpeed / speedStep)
            adaptiveToggle[0].checked = state.adaptiveEnabled
            gapInput.val(state.timeGap.toFixed(1))
            if (state.isEnabled) {
              speedTxt.style.fill = onColor
              ccIcon.style.fill = onColor
            } else {
              speedTxt.style.fill = offColor
              ccIcon.style.fill = offColor
            }
          })
        })

        scope.$on('VehicleFocusChanged', function () {
          bngApi.activeObjectLua('extensions.okAdaptiveCruiseControl.requestState()')
        })

        scope.$on('AIStateChange', function (event, data) {
          // bngApi.activeObjectLua(`extensions.okAdaptiveCruiseControl.setEnabled(${!state.isEnabled})`)
          // Some sort of AI control if need in the future!
          bngApi.activeObjectLua('extensions.okAdaptiveCruiseControl.requestState()')
        })

        bngApi.engineLua('settings.notifyUI()')
      })
    }
  }
}])
