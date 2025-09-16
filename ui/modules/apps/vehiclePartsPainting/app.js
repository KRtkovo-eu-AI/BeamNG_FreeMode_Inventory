angular.module('beamng.apps')
.directive('vehiclePartsPainting', ['bngApi', function (bngApi) {
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
        selectedPart: null
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

      function hexToRgb(hex) {
        if (!hex || typeof hex !== 'string') { return null; }
        const match = /^#?([a-f\d]{6})$/i.exec(hex.trim());
        if (!match) { return null; }
        const value = parseInt(match[1], 16);
        return [
          ((value >> 16) & 255) / 255,
          ((value >> 8) & 255) / 255,
          (value & 255) / 255
        ];
      }

      function toLuaString(str) {
        if (str === undefined || str === null) { return 'nil'; }
        return "'" + String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
      }

      function createViewPaint(paint) {
        paint = paint || {};
        const base = Array.isArray(paint.baseColor) ? paint.baseColor : [];
        return {
          hex: rgbToHex(base[0] || 1, base[1] || 1, base[2] || 1),
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
          const rgb = hexToRgb(view.hex) || [1, 1, 1];
          paints.push({
            baseColor: [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2]), clamp01(view.alpha)],
            metallic: clamp01(view.metallic),
            roughness: clamp01(view.roughness),
            clearcoat: clamp01(view.clearcoat),
            clearcoatRoughness: clamp01(view.clearcoatRoughness)
          });
        }
        return paints;
      }

      function highlightPart(partPath) {
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

      $scope.onColorHexChanged = function (paint) {
        if (!paint || typeof paint.hex !== 'string') { return; }
        const rgb = hexToRgb(paint.hex);
        if (!rgb) {
          paint.hex = '#ffffff';
        }
      };

      $scope.copyFromVehicle = function (index) {
        if (!state.basePaints.length) { return; }
        const paint = state.basePaints[index] || state.basePaints[state.basePaints.length - 1];
        if (!paint) { return; }
        $scope.editedPaints[index] = createViewPaint(paint);
      };

      $scope.selectPart = function (part) {
        if (!part) { return; }
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

      $scope.clearHighlight = function () {
        bngApi.engineLua('freeroam_vehiclePartsPainting.clearHighlight()');
      };

      $scope.$on('$destroy', function () {
        $scope.clearHighlight();
      });

      $scope.$on('VehiclePartsPaintingState', function (event, data) {
        data = data || {};
        $scope.$evalAsync(function () {
          state.vehicleId = data.vehicleId || null;
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
          }

          state.selectedPartPath = selectedPart ? selectedPart.partPath : null;
          state.selectedPart = selectedPart || null;

          updateEditedPaints(selectedPart);

          if (selectedPart) {
            highlightPart(selectedPart.partPath);
          } else {
            $scope.clearHighlight();
          }
        });
      });

      bngApi.engineLua('extensions.load("freeroam_vehiclePartsPainting")');
      $scope.refresh();
    }]
  };
}]);
