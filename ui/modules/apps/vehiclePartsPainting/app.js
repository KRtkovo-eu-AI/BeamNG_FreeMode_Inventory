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
  const testHooks = (typeof window !== 'undefined' && window.__vehiclePartsPaintingTestHooks)
    ? window.__vehiclePartsPaintingTestHooks
    : null;

  return {
    templateUrl: '/ui/modules/apps/vehiclePartsPainting/app.html',
    replace: true,
    restrict: 'EA',
    scope: true,
    controller: ['$scope', '$interval', function ($scope, $interval) {
      const state = {
        vehicleId: null,
        parts: [],
        partsTree: [],
        filteredTree: [],
        basePaints: [],
        selectedPartPath: null,
        selectedPart: null,
        hoveredPartPath: null,
        hasUserSelectedPart: false,
        filterText: '',
        filteredParts: [],
        expandedNodes: {},
        minimized: false,
        basePaintCollapsed: true,
        configToolsCollapsed: true,
        savedConfigs: [],
        selectedSavedConfig: null,
        configNameInput: '',
        isSavingConfig: false,
        isSpawningConfig: false,
        saveErrorMessage: null,
        showReplaceConfirmation: false,
        pendingConfigName: null,
        pendingSanitizedName: null,
        pendingExistingConfig: null,
        colorPresets: []
      };

      $scope.state = state;
      $scope.editedPaints = [];
      $scope.basePaintEditors = [];

      const CUSTOM_BADGE_REFRESH_INTERVAL_MS = 750;
      let customBadgeRefreshPromise = null;
      let partLookup = Object.create(null);
      let partIndexLookup = Object.create(null);
      let treeNodesByPath = Object.create(null);
      let partsTreeDirty = false;
      let customPaintStateByPath = Object.create(null);

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
        return ('#' + componentToHex(r) + componentToHex(g) + componentToHex(b)).toUpperCase();
      }

      function parseHtmlColor(value) {
        if (typeof value !== 'string') { return null; }
        let hex = value.trim();
        if (!hex) { return null; }
        if (hex.charAt(0) === '#') {
          hex = hex.substring(1);
        }
        if (hex.length === 3) {
          hex = hex.charAt(0) + hex.charAt(0) +
            hex.charAt(1) + hex.charAt(1) +
            hex.charAt(2) + hex.charAt(2);
        } else if (hex.length !== 6) {
          return null;
        }
        if (!/^[0-9a-fA-F]{6}$/.test(hex)) { return null; }
        return {
          r: parseInt(hex.substring(0, 2), 16),
          g: parseInt(hex.substring(2, 4), 16),
          b: parseInt(hex.substring(4, 6), 16)
        };
      }

      function syncHtmlColor(paint) {
        if (!paint) { return; }
        const color = sanitizeColor(paint);
        paint.htmlColor = rgbToHex(color.r / 255, color.g / 255, color.b / 255);
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

      function sanitizePresetEntry(preset) {
        if (!preset || typeof preset !== 'object') { return null; }
        const rawName = typeof preset.name === 'string' ? preset.name.trim() : '';
        const valueArray = Array.isArray(preset.value) ? preset.value : [];
        const valueObject = preset.value && typeof preset.value === 'object' ? preset.value : {};
        const paintSource = preset.paint && typeof preset.paint === 'object' ? preset.paint : {};
        const paintBase = Array.isArray(paintSource.baseColor) ? paintSource.baseColor : (Array.isArray(preset.baseColor) ? preset.baseColor : null);

        const rawR = paintBase && paintBase[0] !== undefined ? paintBase[0] : (valueArray[0] !== undefined ? valueArray[0] : valueObject.r);
        const rawG = paintBase && paintBase[1] !== undefined ? paintBase[1] : (valueArray[1] !== undefined ? valueArray[1] : valueObject.g);
        const rawB = paintBase && paintBase[2] !== undefined ? paintBase[2] : (valueArray[2] !== undefined ? valueArray[2] : valueObject.b);
        let rawA;
        if (paintBase && paintBase[3] !== undefined) {
          rawA = paintBase[3];
        } else if (valueArray[3] !== undefined) {
          rawA = valueArray[3];
        } else if (valueObject.a !== undefined) {
          rawA = valueObject.a;
        } else if (valueObject.alpha !== undefined) {
          rawA = valueObject.alpha;
        }

        const r = clamp01(rawR);
        const g = clamp01(rawG);
        const b = clamp01(rawB);
        const a = clamp01(rawA !== undefined ? rawA : 1);
        const hex = rgbToHex(r, g, b);

        function resolveNumeric(primary, fallback) {
          if (typeof primary === 'number' && isFinite(primary)) { return clamp01(primary); }
          if (typeof fallback === 'number' && isFinite(fallback)) { return clamp01(fallback); }
          return 0;
        }

        const paint = {
          baseColor: [r, g, b, a],
          metallic: resolveNumeric(paintSource.metallic, preset.metallic),
          roughness: resolveNumeric(paintSource.roughness, preset.roughness),
          clearcoat: resolveNumeric(paintSource.clearcoat, preset.clearcoat),
          clearcoatRoughness: resolveNumeric(paintSource.clearcoatRoughness, preset.clearcoatRoughness)
        };

        return {
          name: rawName || hex,
          value: paint.baseColor.slice(),
          paint: paint,
          cssColor: 'rgba(' + Math.round(r * 255) + ',' + Math.round(g * 255) + ',' + Math.round(b * 255) + ',' + a + ')',
          title: rawName ? (rawName + ' (' + hex + ')') : hex
        };
      }

      function updateColorPresets(rawPresets) {
        if (!Array.isArray(rawPresets)) {
          state.colorPresets = [];
          return;
        }
        const presets = [];
        for (let i = 0; i < rawPresets.length; i++) {
          const preset = sanitizePresetEntry(rawPresets[i]);
          if (preset) {
            presets.push(preset);
          }
        }
        state.colorPresets = presets;
      }

      function getPresetStyle(preset) {
        if (!preset || !preset.cssColor) { return { background: 'transparent' }; }
        return { background: preset.cssColor };
      }

      function getPresetTitle(preset) {
        if (!preset) { return ''; }
        if (preset.title) { return preset.title; }
        if (preset.name) { return preset.name; }
        return '';
      }

      function applyPresetToPaint(paint, preset) {
        if (!paint || !preset) { return; }
        const presetPaint = preset.paint && typeof preset.paint === 'object' ? preset.paint : null;
        const base = presetPaint && Array.isArray(presetPaint.baseColor) ? presetPaint.baseColor : (Array.isArray(preset.value) ? preset.value : null);
        if (!Array.isArray(base)) { return; }

        const color = ensureColorObject(paint);
        color.r = Math.round(clamp01(base[0]) * 255);
        color.g = Math.round(clamp01(base[1]) * 255);
        color.b = Math.round(clamp01(base[2]) * 255);

        const alphaSource = base[3] !== undefined ? base[3] : paint.alpha;
        paint.alpha = clamp01(alphaSource !== undefined ? alphaSource : 1);

        function applyNumericField(targetKey, primary, fallback) {
          if (typeof primary === 'number' && isFinite(primary)) {
            paint[targetKey] = clamp01(primary);
          } else if (typeof fallback === 'number' && isFinite(fallback)) {
            paint[targetKey] = clamp01(fallback);
          }
        }

        if (presetPaint) {
          applyNumericField('metallic', presetPaint.metallic, preset.metallic);
          applyNumericField('roughness', presetPaint.roughness, preset.roughness);
          applyNumericField('clearcoat', presetPaint.clearcoat, preset.clearcoat);
          applyNumericField('clearcoatRoughness', presetPaint.clearcoatRoughness, preset.clearcoatRoughness);
        } else {
          applyNumericField('metallic', preset.metallic, paint.metallic);
          applyNumericField('roughness', preset.roughness, paint.roughness);
          applyNumericField('clearcoat', preset.clearcoat, paint.clearcoat);
          applyNumericField('clearcoatRoughness', preset.clearcoatRoughness, paint.clearcoatRoughness);
        }

        syncHtmlColor(paint);
      }

      function toLuaString(str) {
        if (str === undefined || str === null) { return 'nil'; }
        return "'" + String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
      }

      function sanitizeConfigFileName(name) {
        if (typeof name !== 'string') { return null; }
        let sanitized = name.replace(/[<>:"/\\|?*]/g, '_');
        sanitized = sanitized.replace(/\s+/g, ' ').trim();
        return sanitized ? sanitized : null;
      }

      function resolveExistingConfig(name) {
        const sanitized = sanitizeConfigFileName(name);
        if (!sanitized) { return { sanitized: null, existing: null }; }
        const lower = sanitized.toLowerCase();
        const configs = Array.isArray(state.savedConfigs) ? state.savedConfigs : [];
        for (let i = 0; i < configs.length; i++) {
          const cfg = configs[i];
          if (!cfg) { continue; }
          const candidate = typeof cfg.fileName === 'string' ? cfg.fileName.trim() : '';
          if (candidate && candidate.toLowerCase() === lower) {
            return { sanitized: sanitized, existing: cfg };
          }
        }
        return { sanitized: sanitized, existing: null };
      }

      function clearPendingReplacement() {
        state.showReplaceConfirmation = false;
        state.pendingConfigName = null;
        state.pendingSanitizedName = null;
        state.pendingExistingConfig = null;
      }

      function performSaveConfiguration(name) {
        clearPendingReplacement();
        state.saveErrorMessage = null;
        state.isSavingConfig = true;
        const command = 'freeroam_vehiclePartsPainting.saveCurrentConfiguration(' + toLuaString(name) + ')';
        bngApi.engineLua(command);
        requestSavedConfigs();
      }

      function createViewPaint(paint) {
        paint = paint || {};
        const base = Array.isArray(paint.baseColor) ? paint.baseColor : [];
        const color = {
          r: Math.round(clamp01(typeof base[0] === 'number' ? base[0] : 1) * 255),
          g: Math.round(clamp01(typeof base[1] === 'number' ? base[1] : 1) * 255),
          b: Math.round(clamp01(typeof base[2] === 'number' ? base[2] : 1) * 255)
        };
        const viewPaint = {
          color: color,
          alpha: typeof base[3] === 'number' ? clamp01(base[3]) : 1,
          metallic: clamp01(paint.metallic),
          roughness: clamp01(paint.roughness),
          clearcoat: clamp01(paint.clearcoat),
          clearcoatRoughness: clamp01(paint.clearcoatRoughness)
        };
        syncHtmlColor(viewPaint);
        return viewPaint;
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

      function clonePaint(paint) {
        if (!paint || typeof paint !== 'object') { return null; }
        const baseColor = Array.isArray(paint.baseColor) ? paint.baseColor : [];
        const clone = {
          baseColor: [
            clamp01(baseColor[0] !== undefined ? baseColor[0] : 1),
            clamp01(baseColor[1] !== undefined ? baseColor[1] : 1),
            clamp01(baseColor[2] !== undefined ? baseColor[2] : 1),
            clamp01(baseColor[3] !== undefined ? baseColor[3] : 1)
          ],
          metallic: clamp01(paint.metallic !== undefined ? paint.metallic : 0),
          roughness: clamp01(paint.roughness !== undefined ? paint.roughness : 0),
          clearcoat: clamp01(paint.clearcoat !== undefined ? paint.clearcoat : 0),
          clearcoatRoughness: clamp01(paint.clearcoatRoughness !== undefined ? paint.clearcoatRoughness : 0)
        };

        const reservedKeys = {
          baseColor: true,
          metallic: true,
          roughness: true,
          clearcoat: true,
          clearcoatRoughness: true
        };
        if (paint && typeof paint === 'object') {
          Object.keys(paint).forEach(function (key) {
            if (reservedKeys[key]) { return; }
            const value = paint[key];
            if (Array.isArray(value)) {
              clone[key] = value.slice();
            } else if (value && typeof value === 'object') {
              clone[key] = Object.assign({}, value);
            } else {
              clone[key] = value;
            }
          });
        }

        return clone;
      }

      function clonePaints(paints) {
        if (!Array.isArray(paints)) { return []; }
        const result = [];
        for (let i = 0; i < paints.length; i++) {
          const clone = clonePaint(paints[i]);
          if (clone) {
            result.push(clone);
          }
        }
        return result;
      }

      function syncBasePaintEditorsFromState() {
        if (!Array.isArray(state.basePaints) || !state.basePaints.length) {
          $scope.basePaintEditors = [];
          return;
        }
        $scope.basePaintEditors = convertPaintsToView(state.basePaints);
      }

      function getBasePaintEditorPaints() {
        return viewToPaints($scope.basePaintEditors);
      }

      function updatePartsWithBasePaint(basePaints) {
        if (!Array.isArray(state.parts) || !state.parts.length) { return; }
        const baseClone = clonePaints(basePaints);
        const hasBase = baseClone.length > 0;
        let changed = false;
        for (let i = 0; i < state.parts.length; i++) {
          const part = state.parts[i];
          if (!part || part.hasCustomPaint) { continue; }
          const updatedPart = Object.assign({}, part, {
            hasCustomPaint: false,
            customPaints: null,
            currentPaints: hasBase ? clonePaints(baseClone) : []
          });
          applyPartReplacement(updatedPart, i);
          changed = true;
        }
        if (changed) {
          computeFilteredParts();
        }
      }

      function applyBasePaintsLocally(paints) {
        const baseClone = clonePaints(paints);
        state.basePaints = baseClone;
        syncBasePaintEditorsFromState();
        updatePartsWithBasePaint(baseClone);
        refreshCustomBadgeVisibility();
      }

      syncBasePaintEditorsFromState();

      function resetPartLookup() {
        partLookup = Object.create(null);
        partIndexLookup = Object.create(null);
      }

      function registerPart(part, index) {
        if (!part || typeof part !== 'object' || !part.partPath) { return; }
        const path = part.partPath;
        partLookup[path] = part;
        if (typeof index === 'number' && index >= 0) {
          partIndexLookup[path] = index;
        }
      }

      function rebuildPartLookup() {
        resetPartLookup();
        if (!Array.isArray(state.parts)) { return; }
        for (let i = 0; i < state.parts.length; i++) {
          registerPart(state.parts[i], i);
        }
      }

      function findPartIndex(partPath) {
        if (!partPath) { return -1; }
        const stored = partIndexLookup[partPath];
        const partsArray = Array.isArray(state.parts) ? state.parts : null;
        if (typeof stored === 'number' && stored >= 0 && partsArray && partsArray[stored] && partsArray[stored].partPath === partPath) {
          return stored;
        }
        if (!partsArray) { return -1; }
        for (let i = 0; i < partsArray.length; i++) {
          const candidate = partsArray[i];
          if (candidate && candidate.partPath === partPath) {
            registerPart(candidate, i);
            return i;
          }
        }
        return -1;
      }

      function getPartEntry(partPath) {
        if (!partPath) { return { part: null, index: -1 }; }
        const partsArray = Array.isArray(state.parts) ? state.parts : null;
        let index = findPartIndex(partPath);
        let part = null;
        if (index !== -1 && partsArray) {
          part = partsArray[index];
        }
        if (!part) {
          part = partLookup[partPath] || null;
        }
        if (!part && state.selectedPart && state.selectedPart.partPath === partPath) {
          part = state.selectedPart;
        }
        if (part && index === -1 && partsArray) {
          index = findPartIndex(partPath);
          if (index !== -1 && partsArray[index]) {
            part = partsArray[index];
          }
        }
        return { part: part, index: index };
      }

      function clearCustomPaintState() {
        customPaintStateByPath = Object.create(null);
      }

      function setCustomPaintState(path, value) {
        if (!path) { return false; }
        const normalized = !!value;
        if (customPaintStateByPath[path] === normalized) { return false; }
        customPaintStateByPath[path] = normalized;
        return true;
      }

      function getCustomPaintState(path) {
        if (!path) { return false; }
        const value = customPaintStateByPath[path];
        if (value === undefined) { return false; }
        return !!value;
      }

      function resetTreeNodeLookup() {
        treeNodesByPath = Object.create(null);
      }

      function registerTreeNode(part, node) {
        if (!node || !part || !part.partPath) { return; }
        const path = part.partPath;
        if (!treeNodesByPath[path]) {
          treeNodesByPath[path] = [];
        }
        if (treeNodesByPath[path].indexOf(node) === -1) {
          treeNodesByPath[path].push(node);
        }
      }

      function indexTreeNodes(nodes) {
        if (!Array.isArray(nodes)) { return; }
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (!node || !node.part) { continue; }
          registerTreeNode(node.part, node);
          if (Array.isArray(node.children) && node.children.length) {
            indexTreeNodes(node.children);
          }
        }
      }

      function rebuildPartsTreeWithIndex(parts) {
        const tree = buildPartsTree(parts);
        resetTreeNodeLookup();
        indexTreeNodes(tree);
        return tree;
      }

      function markPartsTreeDirty() {
        partsTreeDirty = true;
      }

      function rebuildCurrentPartsTree() {
        state.partsTree = rebuildPartsTreeWithIndex(state.parts);
        partsTreeDirty = false;
      }

      function ensurePartsTreeCurrent() {
        if (!partsTreeDirty) { return; }
        rebuildCurrentPartsTree();
      }

      function syncTreeNodesWithPart(part) {
        if (!part || !part.partPath) { return; }
        const nodes = treeNodesByPath[part.partPath];
        if (!Array.isArray(nodes)) { return; }
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (node) {
            node.part = part;
          }
        }
      }

      function applyPartReplacement(part, index, options) {
        if (!part || !part.partPath) { return; }
        options = options || {};
        let resolvedIndex = typeof index === 'number' && index >= 0 ? index : -1;
        const partsArray = Array.isArray(state.parts) ? state.parts : null;
        if (resolvedIndex === -1 && partsArray) {
          resolvedIndex = findPartIndex(part.partPath);
        }
        if (partsArray && resolvedIndex >= 0 && resolvedIndex < partsArray.length) {
          partsArray[resolvedIndex] = part;
          partIndexLookup[part.partPath] = resolvedIndex;
        }
        registerPart(part, resolvedIndex);
        syncTreeNodesWithPart(part);
        if (Array.isArray(state.filteredParts)) {
          for (let i = 0; i < state.filteredParts.length; i++) {
            const filteredPart = state.filteredParts[i];
            if (filteredPart && filteredPart.partPath === part.partPath) {
              state.filteredParts[i] = part;
            }
          }
        }
        if (state.selectedPart && state.selectedPart.partPath === part.partPath) {
          state.selectedPart = part;
          if (options.updateEditor !== false) {
            updateEditedPaints(part);
          }
        }

        markPartsTreeDirty();
      }

      function hasPaintEntries(paints) {
        if (!Array.isArray(paints)) { return false; }
        for (let i = 0; i < paints.length; i++) {
          const entry = paints[i];
          if (entry && typeof entry === 'object') {
            return true;
          }
        }
        return false;
      }

      function numbersClose(a, b, epsilon) {
        if (typeof a !== 'number' || typeof b !== 'number') { return a === b; }
        const difference = Math.abs(a - b);
        if (!isFinite(difference)) { return false; }
        return difference <= (epsilon !== undefined ? epsilon : 0.0005);
      }

      function viewPaintsEqual(paintA, paintB) {
        if (!paintA && !paintB) { return true; }
        if (!paintA || !paintB) { return false; }
        const viewA = createViewPaint(paintA);
        const viewB = createViewPaint(paintB);
        const colorA = viewA && viewA.color ? viewA.color : {};
        const colorB = viewB && viewB.color ? viewB.color : {};
        if (colorA.r !== colorB.r || colorA.g !== colorB.g || colorA.b !== colorB.b) { return false; }
        if (!numbersClose(viewA.alpha, viewB.alpha)) { return false; }
        if (!numbersClose(viewA.metallic, viewB.metallic)) { return false; }
        if (!numbersClose(viewA.roughness, viewB.roughness)) { return false; }
        if (!numbersClose(viewA.clearcoat, viewB.clearcoat)) { return false; }
        if (!numbersClose(viewA.clearcoatRoughness, viewB.clearcoatRoughness)) { return false; }
        return true;
      }

      function paintCollectionsEqual(paintsA, paintsB) {
        const lengthA = Array.isArray(paintsA) ? paintsA.length : 0;
        const lengthB = Array.isArray(paintsB) ? paintsB.length : 0;
        const maxLen = Math.max(lengthA, lengthB);
        if (maxLen === 0) { return true; }
        for (let i = 0; i < maxLen; i++) {
          const paintA = lengthA > i ? paintsA[i] : null;
          const paintB = lengthB > i ? paintsB[i] : null;
          if (!viewPaintsEqual(paintA, paintB)) {
            return false;
          }
        }
        return true;
      }

      function computePartHasCustomPaint(part) {
        if (!part || typeof part !== 'object') { return false; }
        if (hasPaintEntries(part.customPaints)) { return true; }
        const currentPaints = Array.isArray(part.currentPaints) ? part.currentPaints : [];
        if (!currentPaints.length) { return false; }
        const basePaints = Array.isArray(state.basePaints) ? state.basePaints : [];
        if (!basePaints.length) { return part.hasCustomPaint === true; }
        return !paintCollectionsEqual(currentPaints, basePaints);
      }

      function refreshCustomBadgeVisibility() {
        if (!Array.isArray(state.parts) || !state.parts.length) { return; }
        let changed = false;
        let mapChanged = false;
        for (let i = 0; i < state.parts.length; i++) {
          const part = state.parts[i];
          if (!part || typeof part !== 'object') { continue; }
          const computed = computePartHasCustomPaint(part);
          mapChanged = setCustomPaintState(part.partPath, computed) || mapChanged;
          if (part.hasCustomPaint !== computed) {
            const updatedPart = Object.assign({}, part, {
              hasCustomPaint: computed
            });
            applyPartReplacement(updatedPart, i);
            changed = true;
          }
        }
        if (changed || mapChanged) {
          computeFilteredParts();
        }
      }

      $scope.hasBasePaintChanges = function () {
        if (!$scope.basePaintEditors || !$scope.basePaintEditors.length) { return false; }
        const paints = getBasePaintEditorPaints();
        return !paintCollectionsEqual(state.basePaints, paints);
      };

      $scope.applyBasePaints = function () {
        if (!$scope.basePaintEditors || !$scope.basePaintEditors.length) { return; }
        const paints = getBasePaintEditorPaints();
        if (!paints.length) { return; }
        applyBasePaintsLocally(paints);
        const payload = { paints: paints };
        const command = 'freeroam_vehiclePartsPainting.setVehicleBasePaintsJson(' + toLuaString(JSON.stringify(payload)) + ')';
        bngApi.engineLua(command);
      };

      $scope.resetBasePaintEditors = function () {
        syncBasePaintEditorsFromState();
      };

      $scope.hasCustomBadge = function (part) {
        if (!part || !part.partPath) { return false; }
        const path = part.partPath;
        if (Object.prototype.hasOwnProperty.call(customPaintStateByPath, path)) {
          return !!customPaintStateByPath[path];
        }
        return !!part.hasCustomPaint;
      };

      if (testHooks && typeof testHooks.registerController === 'function') {
        testHooks.registerController({
          getState: function () { return state; },
          getTreeNodesByPath: function () { return treeNodesByPath; },
          refreshCustomBadges: refreshCustomBadgeVisibility,
          computeFilteredParts: computeFilteredParts,
          markPartsTreeDirty: markPartsTreeDirty,
          getCustomPaintState: function () { return customPaintStateByPath; }
        });
      }

      function sendShowAllCommand() {
        bngApi.engineLua('freeroam_vehiclePartsPainting.showAllParts()');
      }

      function requestSavedConfigs() {
        bngApi.engineLua('freeroam_vehiclePartsPainting.requestSavedConfigs()');
      }

      function highlightPart(partPath) {
        if (!partPath) { return; }
        const command = 'freeroam_vehiclePartsPainting.highlightPart(' + toLuaString(partPath) + ')';
        bngApi.engineLua(command);
      }

      function beginPartHover(part) {
        if (!part || !part.partPath) { return; }
        const path = part.partPath;
        if (state.hoveredPartPath === path) { return; }
        state.hoveredPartPath = path;
        highlightPart(path);
      }

      function endPartHover(part) {
        if (!state.hoveredPartPath) {
          return;
        }
        if (part && part.partPath && state.hoveredPartPath !== part.partPath) {
          return;
        }
        state.hoveredPartPath = null;
        sendShowAllCommand();
      }

      function updateEditedPaints(part) {
        if (!part) {
          $scope.editedPaints = [];
          return;
        }
        const candidates = [
          part.currentPaints,
          part.customPaints,
          part.paints
        ];
        let source = null;
        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          if (Array.isArray(candidate) && candidate.length) {
            source = candidate;
            break;
          }
        }
        if (!source || !source.length) {
          source = state.basePaints;
        }
        $scope.editedPaints = convertPaintsToView(source);
      }

      function setSelectedPart(part, options) {
        options = options || {};
        const previousPath = state.selectedPartPath;
        const newPath = part ? part.partPath : null;

        state.selectedPartPath = newPath;
        state.selectedPart = part || null;

        if (!part) {
          state.hasUserSelectedPart = false;
        } else if (options.userSelected) {
          state.hasUserSelectedPart = true;
        }

        updateEditedPaints(part);

        if (newPath !== previousPath && !state.hoveredPartPath) {
          sendShowAllCommand();
        }
      }

      function findPartByPath(partPath) {
        const entry = getPartEntry(partPath);
        return entry.part;
      }

      function updateLocalPartPaintState(partPath, paints, hasCustomPaint) {
        if (!partPath) { return false; }
        const entry = getPartEntry(partPath);
        const originalPart = entry.part;
        let index = entry.index;
        if (!originalPart) { return false; }

        const updatedPart = Object.assign({}, originalPart);

        if (hasCustomPaint) {
          const clonedPaints = clonePaints(paints);
          if (!clonedPaints.length) { return false; }
          updatedPart.hasCustomPaint = true;
          updatedPart.customPaints = clonedPaints;
          updatedPart.currentPaints = clonePaints(clonedPaints);
        } else {
          updatedPart.hasCustomPaint = false;
          updatedPart.customPaints = null;
          const baseClone = clonePaints(state.basePaints);
          updatedPart.currentPaints = baseClone.length ? baseClone : [];
        }

        if (index === -1) {
          index = findPartIndex(partPath);
        }

        applyPartReplacement(updatedPart, index);

        return true;
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

      function normalizeSlotPath(slotPath) {
        if (slotPath === undefined || slotPath === null) { return ''; }
        let normalized = String(slotPath);
        normalized = normalized.replace(/\\/g, '/');
        normalized = normalized.trim();
        if (!normalized) { return ''; }
        normalized = normalized.replace(/\/+/g, '/');
        normalized = normalized.replace(/^\/+/g, '');
        normalized = normalized.replace(/\/+$/g, '');
        return normalized;
      }

      function getParentSlotKey(normalizedSlotPath) {
        if (!normalizedSlotPath) { return null; }
        const index = normalizedSlotPath.lastIndexOf('/');
        if (index === -1) { return ''; }
        return normalizedSlotPath.substring(0, index);
      }

      function compareTreeNodes(a, b) {
        const orderA = typeof a._order === 'number' ? a._order : Number.POSITIVE_INFINITY;
        const orderB = typeof b._order === 'number' ? b._order : Number.POSITIVE_INFINITY;
        if (orderA !== orderB) { return orderA - orderB; }

        const slotA = a.part && a.part.slotName ? String(a.part.slotName).toLowerCase() : '';
        const slotB = b.part && b.part.slotName ? String(b.part.slotName).toLowerCase() : '';
        if (slotA && slotB && slotA !== slotB) { return slotA < slotB ? -1 : 1; }

        const nameA = a.part && a.part.displayName ? String(a.part.displayName).toLowerCase() : '';
        const nameB = b.part && b.part.displayName ? String(b.part.displayName).toLowerCase() : '';
        if (nameA !== nameB) { return nameA < nameB ? -1 : 1; }

        const pathA = a.part && a.part.partPath ? String(a.part.partPath) : '';
        const pathB = b.part && b.part.partPath ? String(b.part.partPath) : '';
        return pathA < pathB ? -1 : (pathA > pathB ? 1 : 0);
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
        if (!Array.isArray(parts)) { return []; }

        const nodesBySlotPath = Object.create(null);
        const roots = [];

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (!part || typeof part !== 'object') { continue; }
          const normalizedSlotPath = normalizeSlotPath(part.slotPath);
          const node = {
            part: part,
            children: [],
            _normalizedSlotPath: normalizedSlotPath,
            _order: i
          };

          nodesBySlotPath[normalizedSlotPath] = node;
        }

        const slotKeys = Object.keys(nodesBySlotPath);
        for (let i = 0; i < slotKeys.length; i++) {
          const slotKey = slotKeys[i];
          const node = nodesBySlotPath[slotKey];
          const parentKey = getParentSlotKey(node._normalizedSlotPath);
          if (parentKey === null) {
            roots.push(node);
            continue;
          }
          const parent = nodesBySlotPath[parentKey];
          if (parent) {
            parent.children.push(node);
          } else {
            roots.push(node);
          }
        }

        function sortNodes(list) {
          list.sort(compareTreeNodes);
          for (let i = 0; i < list.length; i++) {
            const childNode = list[i];
            if (childNode.children && childNode.children.length) {
              sortNodes(childNode.children);
            }
          }
        }

        sortNodes(roots);

        function cleanupMetadata(list) {
          for (let i = 0; i < list.length; i++) {
            const entry = list[i];
            delete entry._normalizedSlotPath;
            delete entry._order;
            if (entry.children && entry.children.length) {
              cleanupMetadata(entry.children);
            }
          }
        }

        cleanupMetadata(roots);

        return roots;
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

      function setExpansionForNodes(nodes, expanded) {
        if (!Array.isArray(nodes)) { return; }
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (!node || !node.part || !node.part.partPath) { continue; }
          state.expandedNodes[node.part.partPath] = !!expanded;
          if (node.children && node.children.length) {
            setExpansionForNodes(node.children, expanded);
          }
        }
      }

      function computeFilteredParts() {
        ensurePartsTreeCurrent();
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

        const hoveredPath = state.hoveredPartPath;
        if (hoveredPath && !filtered.some(function (part) { return part.partPath === hoveredPath; })) {
          state.hoveredPartPath = null;
          sendShowAllCommand();
        }

        const previousPath = state.selectedPartPath;
        const hadHover = !!hoveredPath;

        if (!filtered.length) {
          state.hoveredPartPath = null;
          setSelectedPart(null);
          if (hadHover && !previousPath) {
            sendShowAllCommand();
          }
          return;
        }

        let target = filtered.find(function (part) { return part.partPath === previousPath; });

        if (!target) {
          if (state.hasUserSelectedPart) {
            target = filtered[0];
          } else {
            const hoverBeforeClear = !!state.hoveredPartPath;
            state.hoveredPartPath = null;
            setSelectedPart(null);
            if (hoverBeforeClear && !previousPath) {
              sendShowAllCommand();
            }
            return;
          }
        }

        if (target) {
          setSelectedPart(target);
        }
      }

      $scope.$watch(function () { return state.filterText; }, function () {
        computeFilteredParts();
      });

      $scope.onColorChannelChanged = function (paint) {
        sanitizeColor(paint);
        syncHtmlColor(paint);
      };

      $scope.onHtmlColorInputChanged = function (paint) {
        if (!paint) { return; }
        const parsed = parseHtmlColor(paint.htmlColor);
        if (!parsed) { return; }
        const color = ensureColorObject(paint);
        color.r = parsed.r;
        color.g = parsed.g;
        color.b = parsed.b;
        syncHtmlColor(paint);
      };

      $scope.onHtmlColorInputBlur = function (paint) {
        if (!paint) { return; }
        const parsed = parseHtmlColor(paint.htmlColor);
        if (!parsed) {
          syncHtmlColor(paint);
        }
      };

      $scope.getColorPreviewStyle = function (paint) {
        return { background: getPaintCssColor(paint) };
      };

      $scope.getColorHex = function (paint) {
        return getPaintHex(paint);
      };

      $scope.getColorPresets = function () {
        return Array.isArray(state.colorPresets) ? state.colorPresets : [];
      };

      $scope.getColorPresetStyle = function (preset) {
        return getPresetStyle(preset);
      };

      $scope.getColorPresetTitle = function (preset) {
        return getPresetTitle(preset);
      };

      $scope.applyColorPreset = function (paint, preset) {
        applyPresetToPaint(paint, preset);
      };

      $scope.addColorPreset = function (paint) {
        if (!paint) { return; }
        const color = ensureColorObject(paint);
        const baseColor = [
          clamp01(color.r / 255),
          clamp01(color.g / 255),
          clamp01(color.b / 255),
          clamp01(typeof paint.alpha === 'number' ? paint.alpha : 1)
        ];
        const payload = {
          value: baseColor.slice(),
          paint: {
            baseColor: baseColor.slice(),
            metallic: clamp01(typeof paint.metallic === 'number' ? paint.metallic : 0),
            roughness: clamp01(typeof paint.roughness === 'number' ? paint.roughness : 0),
            clearcoat: clamp01(typeof paint.clearcoat === 'number' ? paint.clearcoat : 0),
            clearcoatRoughness: clamp01(typeof paint.clearcoatRoughness === 'number' ? paint.clearcoatRoughness : 0)
          }
        };
        const defaultName = rgbToHex(payload.value[0], payload.value[1], payload.value[2]);
        let chosenName = defaultName;
        if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
          const response = window.prompt('Name for color preset', defaultName);
          if (response === null) {
            return;
          }
          const trimmed = response.trim();
          if (trimmed) {
            chosenName = trimmed;
          }
        }
        payload.name = chosenName;
        const command = 'freeroam_vehiclePartsPainting.addColorPreset(' + toLuaString(JSON.stringify(payload)) + ')';
        bngApi.engineLua(command);
      };

      $scope.copyFromVehicle = function (index) {
        if (!state.basePaints.length) { return; }
        const paint = state.basePaints[index] || state.basePaints[state.basePaints.length - 1];
        if (!paint) { return; }
        $scope.editedPaints[index] = createViewPaint(paint);
      };

      $scope.selectPart = function (part) {
        if (!part) { return; }
        setSelectedPart(part, { userSelected: true });
      };

      $scope.onPartMouseEnter = function (part) {
        beginPartHover(part);
      };

      $scope.onPartMouseLeave = function (part) {
        endPartHover(part);
      };

      $scope.toggleNode = function (part, $event) {
        if ($event && typeof $event.stopPropagation === 'function') {
          $event.stopPropagation();
        }
        if (!part || !part.partPath) { return; }
        const path = part.partPath;
        const current = state.expandedNodes[path];
        if (current === undefined) {
          state.expandedNodes[path] = true;
        } else {
          state.expandedNodes[path] = !current;
        }
      };

      $scope.isNodeExpanded = function (part) {
        if (!part || !part.partPath) { return true; }
        const value = state.expandedNodes[part.partPath];
        if (value === undefined) { return false; }
        return !!value;
      };

      $scope.expandAllNodes = function () {
        ensurePartsTreeCurrent();
        setExpansionForNodes(state.partsTree, true);
      };

      $scope.collapseAllNodes = function () {
        ensurePartsTreeCurrent();
        setExpansionForNodes(state.partsTree, false);
      };

      $scope.clearFilter = function () {
        state.filterText = '';
      };

      $scope.minimizeApp = function () {
        state.minimized = true;
      };

      $scope.restoreApp = function () {
        state.minimized = false;
      };

      $scope.toggleBasePaintCollapsed = function () {
        state.basePaintCollapsed = !state.basePaintCollapsed;
      };

      $scope.toggleConfigToolsCollapsed = function () {
        state.configToolsCollapsed = !state.configToolsCollapsed;
      };

      $scope.refresh = function () {
        bngApi.engineLua('freeroam_vehiclePartsPainting.requestState()');
      };

      $scope.refreshSavedConfigs = function () {
        requestSavedConfigs();
      };

      function getSavedConfigDisplayName(config) {
        if (!config || typeof config !== 'object') { return ''; }
        if (config.displayName && typeof config.displayName === 'string' && config.displayName.trim()) {
          return config.displayName.trim();
        }
        if (config.fileName && typeof config.fileName === 'string' && config.fileName.trim()) {
          return config.fileName.trim();
        }
        if (config.relativePath && typeof config.relativePath === 'string' && config.relativePath.trim()) {
          const relative = config.relativePath.trim();
          const parts = relative.split('/');
          const last = parts[parts.length - 1] || '';
          if (last.toLowerCase().endsWith('.pc')) {
            return last.substring(0, last.length - 3) || last;
          }
          return last || relative;
        }
        return 'Configuration';
      }

      $scope.getSavedConfigs = function () {
        return Array.isArray(state.savedConfigs) ? state.savedConfigs : [];
      };

      $scope.hasSavedConfigs = function () {
        return Array.isArray(state.savedConfigs) && state.savedConfigs.length > 0;
      };

      $scope.getSavedConfigLabel = function (config) {
        return getSavedConfigDisplayName(config);
      };

      $scope.isSavedConfigSelected = function (config) {
        if (!config || !state.selectedSavedConfig) { return false; }
        return state.selectedSavedConfig.relativePath === config.relativePath;
      };

      $scope.selectSavedConfig = function (config) {
        if (!config) {
          state.selectedSavedConfig = null;
          return;
        }
        state.selectedSavedConfig = config;
      };

      $scope.saveCurrentConfiguration = function () {
        if (state.isSavingConfig || state.showReplaceConfirmation) { return; }
        const name = typeof state.configNameInput === 'string' ? state.configNameInput.trim() : '';
        if (!name) {
          state.saveErrorMessage = 'Please enter a configuration name.';
          return;
        }
        const result = resolveExistingConfig(name);
        if (!result.sanitized) {
          state.saveErrorMessage = 'Please enter a configuration name.';
          return;
        }
        state.saveErrorMessage = null;
        if (result.existing) {
          state.pendingConfigName = name;
          state.pendingSanitizedName = result.sanitized;
          state.pendingExistingConfig = result.existing;
          state.showReplaceConfirmation = true;
          return;
        }
        performSaveConfiguration(name);
      };

      $scope.confirmReplaceSavedConfig = function () {
        if (state.isSavingConfig) { return; }
        const name = typeof state.pendingConfigName === 'string' ? state.pendingConfigName : null;
        if (!name) {
          clearPendingReplacement();
          return;
        }
        performSaveConfiguration(name);
      };

      $scope.cancelReplaceSavedConfig = function () {
        clearPendingReplacement();
      };

      $scope.spawnSavedConfiguration = function (config) {
        const target = config || state.selectedSavedConfig;
        if (!target || !target.relativePath) { return; }
        state.isSpawningConfig = true;
        const command = 'freeroam_vehiclePartsPainting.spawnSavedConfiguration(' + toLuaString(target.relativePath) + ')';
        bngApi.engineLua(command);
      };

      $scope.applyPaint = function () {
        if (!state.selectedPartPath || !$scope.editedPaints.length) { return; }
        const paints = viewToPaints($scope.editedPaints);
        if (!paints.length) { return; }
        const updatedLocally = updateLocalPartPaintState(state.selectedPartPath, paints, true);
        refreshCustomBadgeVisibility();
        if (updatedLocally) {
          computeFilteredParts();
        }
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
        const partPath = state.selectedPartPath;
        const updatedLocally = updateLocalPartPaintState(partPath, null, false);
        refreshCustomBadgeVisibility();
        if (!updatedLocally) {
          const entry = getPartEntry(partPath);
          if (entry.part) {
            const baseClone = clonePaints(state.basePaints);
            const updatedPart = Object.assign({}, entry.part, {
              hasCustomPaint: false,
              customPaints: null,
              currentPaints: baseClone.length ? baseClone : []
            });
            applyPartReplacement(updatedPart, entry.index);
          }
        }
        computeFilteredParts();
        bngApi.engineLua('freeroam_vehiclePartsPainting.resetPartPaint(' + toLuaString(partPath) + ')');
      };

      $scope.showAllParts = function () {
        state.hoveredPartPath = null;
        sendShowAllCommand();
      };

      $scope.$on('$destroy', function () {
        if (customBadgeRefreshPromise) {
          $interval.cancel(customBadgeRefreshPromise);
          customBadgeRefreshPromise = null;
        }
        resetPartLookup();
        resetTreeNodeLookup();
        clearCustomPaintState();
        state.hoveredPartPath = null;
        sendShowAllCommand();
      });

      $scope.$on('VehiclePartsPaintingState', function (event, data) {
        data = data || {};
        $scope.$evalAsync(function () {
          const previousVehicleId = state.vehicleId;
          state.vehicleId = data.vehicleId || null;

          if (Object.prototype.hasOwnProperty.call(data, 'colorPresets')) {
            updateColorPresets(data.colorPresets);
          }

          if (!state.vehicleId) {
            clearPendingReplacement();
            clearCustomPaintState();
            state.basePaints = [];
            $scope.basePaintEditors = [];
            state.parts = [];
            resetPartLookup();
            state.partsTree = [];
            partsTreeDirty = false;
            resetTreeNodeLookup();
            state.filteredTree = [];
            state.filteredParts = [];
            state.expandedNodes = {};
            state.savedConfigs = [];
            state.selectedSavedConfig = null;
            state.configNameInput = '';
            state.isSavingConfig = false;
            state.isSpawningConfig = false;
            state.saveErrorMessage = null;
            state.hasUserSelectedPart = false;
            state.hoveredPartPath = null;
            setSelectedPart(null);
            sendShowAllCommand();
            refreshCustomBadgeVisibility();
            return;
          }

          if (state.vehicleId !== previousVehicleId) {
            clearPendingReplacement();
            clearCustomPaintState();
            state.filterText = '';
            state.expandedNodes = {};
            state.savedConfigs = [];
            state.selectedSavedConfig = null;
            state.configNameInput = '';
            state.isSavingConfig = false;
            state.isSpawningConfig = false;
            state.saveErrorMessage = null;
            state.hasUserSelectedPart = false;
            state.hoveredPartPath = null;
            setSelectedPart(null);
            sendShowAllCommand();
            requestSavedConfigs();
          }

          if (state.vehicleId === previousVehicleId) {
            clearCustomPaintState();
          }

          state.basePaints = Array.isArray(data.basePaints) ? clonePaints(data.basePaints) : [];
          syncBasePaintEditorsFromState();
          state.parts = Array.isArray(data.parts) ? data.parts : [];
          rebuildPartLookup();
          rebuildCurrentPartsTree();
          refreshCustomBadgeVisibility();

          computeFilteredParts();
          state.isSpawningConfig = false;
          state.isSavingConfig = false;
        });
      });

      $scope.$on('VehiclePartsPaintingSavedConfigs', function (event, data) {
        data = data || {};
        $scope.$evalAsync(function () {
          const wasSaving = state.isSavingConfig;
          clearPendingReplacement();
          const configs = Array.isArray(data.configs) ? data.configs.map(function (config) {
            if (!config || typeof config !== 'object') { return null; }
            const clone = Object.assign({}, config);
            clone.displayName = getSavedConfigDisplayName(clone);
            return clone;
          }).filter(function (entry) { return !!entry; }) : [];

          const previousSelection = state.selectedSavedConfig ? state.selectedSavedConfig.relativePath : null;
          state.savedConfigs = configs;

          if (!configs.length) {
            state.selectedSavedConfig = null;
          } else {
            let selected = configs.find(function (entry) { return entry.relativePath === previousSelection; });
            if (!selected) {
              selected = configs[0];
            }
            state.selectedSavedConfig = selected || null;
          }

          state.isSavingConfig = false;
          state.isSpawningConfig = false;
          if (wasSaving) {
            state.configNameInput = '';
            state.saveErrorMessage = null;
          }
        });
      });

      $scope.$on('VehiclePartsPaintingColorPresets', function (event, data) {
        data = data || {};
        $scope.$evalAsync(function () {
          if (Object.prototype.hasOwnProperty.call(data, 'colorPresets')) {
            updateColorPresets(data.colorPresets);
          }
        });
      });

      bngApi.engineLua('extensions.load("freeroam_vehiclePartsPainting")');
      $scope.refresh();
      requestSavedConfigs();
      bngApi.engineLua('freeroam_vehiclePartsPainting.requestColorPresets()');
      refreshCustomBadgeVisibility();
      customBadgeRefreshPromise = $interval(function () {
        refreshCustomBadgeVisibility();
      }, CUSTOM_BADGE_REFRESH_INTERVAL_MS);
    }]
  };
}]);
