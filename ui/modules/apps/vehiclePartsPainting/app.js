angular.module('beamng.apps')
.directive('vehiclePartsPainting', ['$injector', function ($injector) {
  function resolveBngApi() {
    if ($injector) {
      try {
        const service = $injector.get('bngApi');
        if (service) { return service; }
      } catch (err) {
        if (typeof window !== 'undefined' && window.console && typeof window.console.warn === 'function') {
          window.console.warn('VehiclePartsPainting: Angular bngApi service unavailable, falling back to global.', err);
        }
      }
    }

    if (typeof window !== 'undefined' && window.bngApi) {
      return window.bngApi;
    }

    if (typeof window !== 'undefined' && window.console && typeof window.console.error === 'function') {
      window.console.error('VehiclePartsPainting: Unable to access bngApi, vehicle highlighting and paint commands will be disabled.');
    }

    const noop = function () { };
    return {
      engineLua: noop
    };
  }

  const bngApi = resolveBngApi();

  return {
    templateUrl: '/ui/modules/apps/vehiclePartsPainting/app.html',
    replace: true,
    restrict: 'EA',
    scope: true,
    controller: ['$scope', function ($scope) {
      const state = {
        vehicleId: null,
        parts: [],
        basePaints: [],
        selectedPartPath: null,
        selectedPart: null,
        highlightSuspended: false
      };

      $scope.state = state;
      $scope.editedPaints = [];

      function clamp01(value) {
        value = parseFloat(value);
        if (isNaN(value)) { return 0; }
        return Math.min(1, Math.max(0, value));
      }

      function componentToHex(component) {
        const value = Math.round(clamp01(component) * 255);
        const hex = value.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      }

      function rgbToHex(r, g, b) {
        return '#' + componentToHex(r) + componentToHex(g) + componentToHex(b);
      }

      function clampColorByte(value) {
        value = parseFloat(value);
        if (!isFinite(value)) { return 0; }
        return Math.min(255, Math.max(0, Math.round(value)));
      }

      function ensureColorObject(paint) {
        if (!paint || typeof paint !== 'object') { return { r: 255, g: 255, b: 255 }; }
        if (!paint.color || typeof paint.color !== 'object') {
          paint.color = { r: 255, g: 255, b: 255 };
        }
        return paint.color;
      }

      function sanitizeColor(paint) {
        const color = ensureColorObject(paint);
        color.r = clampColorByte(color.r);
        color.g = clampColorByte(color.g);
        color.b = clampColorByte(color.b);
        return color;
      }

      function getPaintHex(paint) {
        const color = sanitizeColor(paint);
        return rgbToHex(color.r / 255, color.g / 255, color.b / 255);
      }

      function getPaintCssColor(paint) {
        const color = sanitizeColor(paint);
        const alpha = clamp01(paint && typeof paint.alpha === 'number' ? paint.alpha : 1);
        return 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',' + alpha + ')';
      }

      function toLuaString(str) {
        if (str === undefined || str === null) { return 'nil'; }
        return "'" + String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
      }

      function createViewPaint(paint) {
        paint = paint || {};
        const base = Array.isArray(paint.baseColor) ? paint.baseColor : [];
        const color = {
          r: Math.round(clamp01(typeof base[0] === 'number' ? base[0] : 1) * 255),
          g: Math.round(clamp01(typeof base[1] === 'number' ? base[1] : 1) * 255),
          b: Math.round(clamp01(typeof base[2] === 'number' ? base[2] : 1) * 255)
        };
        return {
          color: color,
          alpha: typeof base[3] === 'number' ? clamp01(base[3]) : 1,
          metallic: clamp01(paint.metallic),
          roughness: clamp01(paint.roughness),
          clearcoat: clamp01(paint.clearcoat),
          clearcoatRoughness: clamp01(paint.clearcoatRoughness)
        };
      }

      function convertPaintsToView(paints) {
        const view = [];
        if (Array.isArray(paints)) {
          for (let i = 0; i < Math.min(3, paints.length); i++) {
            view.push(createViewPaint(paints[i]));
          }
        }
        if (!view.length && state.basePaints.length) {
          return convertPaintsToView(state.basePaints);
        }
        while (view.length && view.length < 3) {
          view.push(angular.copy(view[view.length - 1]));
        }
        return view;
      }

      function viewToPaints(viewPaints) {
        const paints = [];
        if (!Array.isArray(viewPaints)) { return paints; }
        for (let i = 0; i < viewPaints.length; i++) {
          const view = viewPaints[i];
          if (!view) { continue; }
          const color = sanitizeColor(view);
          paints.push({
            baseColor: [
              clamp01(color.r / 255),
              clamp01(color.g / 255),
              clamp01(color.b / 255),
              clamp01(view.alpha)
            ],
            metallic: clamp01(view.metallic),
            roughness: clamp01(view.roughness),
            clearcoat: clamp01(view.clearcoat),
            clearcoatRoughness: clamp01(view.clearcoatRoughness)
          });
        }
        return paints;
      }

      function sendShowAllCommand() {
        bngApi.engineLua('freeroam_vehiclePartsPainting.showAllParts()');
      }

      function highlightPart(partPath) {
        if (!partPath || state.highlightSuspended) { return; }
        const command = 'freeroam_vehiclePartsPainting.highlightPart(' + toLuaString(partPath) + ')';
        bngApi.engineLua(command);
      }

      function updateEditedPaints(part) {
        if (!part) {
          $scope.editedPaints = [];
          return;
        }
        const source = Array.isArray(part.currentPaints) && part.currentPaints.length
          ? part.currentPaints
          : state.basePaints;
        $scope.editedPaints = convertPaintsToView(source);
      }

      $scope.onColorChannelChanged = function (paint) {
        sanitizeColor(paint);
      };

      $scope.getColorPreviewStyle = function (paint) {
        return { background: getPaintCssColor(paint) };
      };

      $scope.getColorHex = function (paint) {
        return getPaintHex(paint);
      };

      $scope.copyFromVehicle = function (index) {
        if (!state.basePaints.length) { return; }
        const paint = state.basePaints[index] || state.basePaints[state.basePaints.length - 1];
        if (!paint) { return; }
        $scope.editedPaints[index] = createViewPaint(paint);
      };

      $scope.selectPart = function (part) {
        if (!part) { return; }
        state.highlightSuspended = false;
        state.selectedPartPath = part.partPath;
        state.selectedPart = part;
        updateEditedPaints(part);
        highlightPart(part.partPath);
      };

      $scope.refresh = function () {
        bngApi.engineLua('freeroam_vehiclePartsPainting.requestState()');
      };

      $scope.applyPaint = function () {
        if (!state.selectedPartPath || !$scope.editedPaints.length) { return; }
        const paints = viewToPaints($scope.editedPaints);
        if (!paints.length) { return; }
        const payload = {
          partPath: state.selectedPartPath,
          paints: paints
        };
        const command = 'freeroam_vehiclePartsPainting.applyPartPaintJson(' + toLuaString(JSON.stringify(payload)) + ')';
        bngApi.engineLua(command);
      };

      $scope.resetPaint = function () {
        if (!state.selectedPartPath) { return; }
        bngApi.engineLua('freeroam_vehiclePartsPainting.resetPartPaint(' + toLuaString(state.selectedPartPath) + ')');
      };

      $scope.showAllParts = function () {
        state.highlightSuspended = true;
        sendShowAllCommand();
      };

      $scope.$on('$destroy', function () {
        sendShowAllCommand();
      });

      $scope.$on('VehiclePartsPaintingState', function (event, data) {
        data = data || {};
        $scope.$evalAsync(function () {
          const previousVehicleId = state.vehicleId;
          state.vehicleId = data.vehicleId || null;
          if (state.vehicleId !== previousVehicleId) {
            state.highlightSuspended = false;
          }
          state.basePaints = Array.isArray(data.basePaints) ? data.basePaints : [];
          state.parts = Array.isArray(data.parts) ? data.parts : [];

          let selectedPath = state.selectedPartPath;
          let selectedPart = null;

          for (let i = 0; i < state.parts.length; i++) {
            if (state.parts[i].partPath === selectedPath) {
              selectedPart = state.parts[i];
              break;
            }
          }

          if (!selectedPart && state.parts.length) {
            selectedPart = state.parts[0];
            selectedPath = selectedPart.partPath;
            state.highlightSuspended = false;
          }

          state.selectedPartPath = selectedPart ? selectedPart.partPath : null;
          state.selectedPart = selectedPart || null;

          updateEditedPaints(selectedPart);

          if (selectedPart) {
            if (!state.highlightSuspended) {
              highlightPart(selectedPart.partPath);
            }
          } else {
            sendShowAllCommand();
          }
        });
      });

      bngApi.engineLua('extensions.load("freeroam_vehiclePartsPainting")');
      $scope.refresh();
    }]
  };
}]);
