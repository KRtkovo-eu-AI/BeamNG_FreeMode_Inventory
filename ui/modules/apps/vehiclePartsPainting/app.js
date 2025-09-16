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
        partsTree: [],
        filteredTree: [],
        basePaints: [],
        selectedPartPath: null,
        selectedPart: null,
        highlightSuspended: false,
        filterText: '',
        filteredParts: [],
        expandedNodes: {}
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

      function setSelectedPart(part, options) {
        options = options || {};
        const newPath = part ? part.partPath : null;
        const previousPath = state.selectedPartPath;
        const pathChanged = newPath !== previousPath;

        state.selectedPartPath = newPath;
        state.selectedPart = part || null;

        updateEditedPaints(part);

        if (options.skipHighlight) {
          return;
        }

        if (part) {
          if (options.forceHighlight || pathChanged || state.highlightSuspended) {
            state.highlightSuspended = false;
            highlightPart(part.partPath);
          }
        } else {
          state.highlightSuspended = true;
          sendShowAllCommand();
        }
      }

      function matchesFilter(part, filter) {
        if (!filter) { return true; }
        if (!part) { return false; }
        const lowered = filter.toLowerCase();
        const fields = [];
        if (part.displayName) { fields.push(part.displayName); }
        if (part.partName) { fields.push(part.partName); }
        if (part.slotName) { fields.push(part.slotName); }
        for (let i = 0; i < fields.length; i++) {
          const value = fields[i];
          if (typeof value === 'string' && value.toLowerCase().indexOf(lowered) !== -1) {
            return true;
          }
        }
        return false;
      }

      function getPartDepth(part) {
        if (!part || typeof part.depth !== 'number') { return 0; }
        return part.depth;
      }

      function cloneTreeNodes(nodes) {
        if (!Array.isArray(nodes)) { return []; }
        const result = [];
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (!node || !node.part) { continue; }
          result.push({
            part: node.part,
            children: cloneTreeNodes(Array.isArray(node.children) ? node.children : [])
          });
        }
        return result;
      }

      function buildPartsTree(parts) {
        const tree = [];
        const stack = [];
        if (!Array.isArray(parts)) { return tree; }
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const node = { part: part, children: [] };
          const depth = getPartDepth(part);
          while (stack.length && getPartDepth(stack[stack.length - 1].part) >= depth) {
            stack.pop();
          }
          if (part && part.partPath && state.expandedNodes[part.partPath] === undefined) {
            state.expandedNodes[part.partPath] = true;
          }
          if (!stack.length) {
            tree.push(node);
          } else {
            stack[stack.length - 1].children.push(node);
          }
          stack.push(node);
        }
        return tree;
      }

      function filterTreeNodes(nodes, filter) {
        if (!Array.isArray(nodes)) { return []; }
        const result = [];
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (!node || !node.part) { continue; }
          const matchesSelf = matchesFilter(node.part, filter);
          let children = [];
          if (matchesSelf) {
            children = cloneTreeNodes(Array.isArray(node.children) ? node.children : []);
          } else {
            children = filterTreeNodes(Array.isArray(node.children) ? node.children : [], filter);
          }
          if (matchesSelf || children.length) {
            result.push({
              part: node.part,
              children: children
            });
          }
        }
        return result;
      }

      function expandFilteredNodes(nodes) {
        if (!Array.isArray(nodes)) { return; }
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (!node || !node.part) { continue; }
          if (node.part.partPath) {
            state.expandedNodes[node.part.partPath] = true;
          }
          if (node.children && node.children.length) {
            expandFilteredNodes(node.children);
          }
        }
      }

      function computeFilteredParts(options) {
        options = options || {};
        const rawFilter = typeof state.filterText === 'string' ? state.filterText : '';
        const normalized = rawFilter.trim().toLowerCase();
        const parts = Array.isArray(state.parts) ? state.parts.slice() : [];
        let filtered = parts;
        if (normalized) {
          filtered = parts.filter(function (part) {
            return matchesFilter(part, normalized);
          });
        }
        state.filteredParts = filtered;

        if (!normalized) {
          state.filteredTree = state.partsTree;
        } else {
          const tree = filterTreeNodes(state.partsTree, normalized);
          state.filteredTree = tree;
          expandFilteredNodes(tree);
        }

        if (!filtered.length) {
          setSelectedPart(null, { skipHighlight: false });
          return;
        }

        const previousPath = state.selectedPartPath;
        let target = filtered.find(function (part) { return part.partPath === previousPath; });
        const selectionOptions = {};

        if (!target) {
          target = filtered[0];
          selectionOptions.forceHighlight = true;
        } else {
          if (options.forceHighlightOnRefresh) {
            selectionOptions.forceHighlight = true;
          } else if (options.skipHighlightIfSame && previousPath === target.partPath) {
            selectionOptions.skipHighlight = true;
          }
        }

        setSelectedPart(target, selectionOptions);
      }

      $scope.$watch(function () { return state.filterText; }, function () {
        computeFilteredParts({ skipHighlightIfSame: true });
      });

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
        setSelectedPart(part, { forceHighlight: true });
      };

      $scope.toggleNode = function (part, $event) {
        if ($event && typeof $event.stopPropagation === 'function') {
          $event.stopPropagation();
        }
        if (!part || !part.partPath) { return; }
        const path = part.partPath;
        const current = state.expandedNodes[path];
        if (current === undefined) {
          state.expandedNodes[path] = false;
        } else {
          state.expandedNodes[path] = !current;
        }
      };

      $scope.isNodeExpanded = function (part) {
        if (!part || !part.partPath) { return true; }
        const value = state.expandedNodes[part.partPath];
        if (value === undefined) { return true; }
        return !!value;
      };

      $scope.clearFilter = function () {
        state.filterText = '';
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
          partName: state.selectedPart ? state.selectedPart.partName : null,
          slotPath: state.selectedPart ? state.selectedPart.slotPath : null,
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

          if (!state.vehicleId) {
            state.basePaints = [];
            state.parts = [];
            state.partsTree = [];
            state.filteredTree = [];
            state.filteredParts = [];
            state.highlightSuspended = false;
            state.expandedNodes = {};
            setSelectedPart(null, { skipHighlight: true });
            return;
          }

          if (state.vehicleId !== previousVehicleId) {
            state.highlightSuspended = false;
            state.filterText = '';
            state.expandedNodes = {};
          }

          state.basePaints = Array.isArray(data.basePaints) ? data.basePaints : [];
          state.parts = Array.isArray(data.parts) ? data.parts : [];
          state.partsTree = buildPartsTree(state.parts);

          computeFilteredParts({
            skipHighlightIfSame: true,
            forceHighlightOnRefresh: state.vehicleId !== previousVehicleId
          });
        });
      });

      bngApi.engineLua('extensions.load("freeroam_vehiclePartsPainting")');
      $scope.refresh();
    }]
  };
}]);
