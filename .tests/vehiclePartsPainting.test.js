const assert = require('assert');
const path = require('path');

let controllerHooks = null;

function createAngularStub() {
  const modules = Object.create(null);

  function AngularModule(name) {
    this.name = name;
    this._directives = Object.create(null);
  }

  AngularModule.prototype.directive = function directive(name, definition) {
    let deps = [];
    let factory = definition;
    if (Array.isArray(definition)) {
      deps = definition.slice(0, definition.length - 1);
      factory = definition[definition.length - 1];
    }
    this._directives[name] = { deps: deps, factory: factory };
    return this;
  };

  AngularModule.prototype.getDirective = function getDirective(name) {
    return this._directives[name];
  };

  function copy(value) {
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  const angularStub = {
    module: function (name) {
      if (!modules[name]) {
        modules[name] = new AngularModule(name);
      }
      return modules[name];
    },
    copy: copy
  };

  return angularStub;
}

class ScopeStub {
  constructor() {
    this.$$listeners = Object.create(null);
    this.$$watchers = [];
    this.state = null;
    this.editedPaints = [];
  }

  $on(event, handler) {
    if (!this.$$listeners[event]) {
      this.$$listeners[event] = [];
    }
    this.$$listeners[event].push(handler);
    const listeners = this.$$listeners[event];
    return function () {
      const index = listeners.indexOf(handler);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  }

  $evalAsync(fn) {
    fn();
  }

  $watch(expFn, listener) {
    const watcher = { expFn: expFn, listener: listener, last: expFn() };
    this.$$watchers.push(watcher);
  }

  $digest() {
    let dirty = true;
    let ttl = 10;
    while (dirty && ttl > 0) {
      dirty = false;
      ttl--;
      for (let i = 0; i < this.$$watchers.length; i++) {
        const watcher = this.$$watchers[i];
        const current = watcher.expFn();
        if (current !== watcher.last) {
          const previous = watcher.last;
          watcher.last = current;
          watcher.listener(current, previous);
          dirty = true;
        }
      }
    }
  }

  $$emit(event, data) {
    const listeners = this.$$listeners[event];
    if (!listeners) {
      return;
    }
    const snapshot = listeners.slice();
    for (let i = 0; i < snapshot.length; i++) {
      const handler = snapshot[i];
      handler({}, data);
    }
  }
}

function createIntervalStub() {
  const handles = [];
  function interval(callback, delay) {
    const handle = { callback: callback, delay: delay, cancelled: false };
    handles.push(handle);
    return handle;
  }
  interval.cancel = function cancel(handle) {
    if (!handle) {
      return;
    }
    handle.cancelled = true;
    const index = handles.indexOf(handle);
    if (index !== -1) {
      handles.splice(index, 1);
    }
  };
  interval.flush = function flush() {
    const snapshot = handles.slice();
    for (let i = 0; i < snapshot.length; i++) {
      const handle = snapshot[i];
      if (!handle.cancelled) {
        handle.callback();
      }
    }
  };
  return interval;
}

function createTimeoutStub() {
  const handles = [];
  function timeout(callback, delay) {
    const handle = { callback: callback, delay: delay, cancelled: false };
    handles.push(handle);
    return handle;
  }
  timeout.cancel = function cancel(handle) {
    if (!handle) {
      return;
    }
    handle.cancelled = true;
    const index = handles.indexOf(handle);
    if (index !== -1) {
      handles.splice(index, 1);
    }
  };
  timeout.flush = function flush() {
    const snapshot = handles.slice();
    handles.length = 0;
    for (let i = 0; i < snapshot.length; i++) {
      const handle = snapshot[i];
      if (!handle.cancelled) {
        handle.callback();
      }
    }
  };
  return timeout;
}

function decodeLuaStringLiteral(value) {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    if (ch === '\\' && i + 1 < value.length) {
      const next = value.charAt(i + 1);
      if (next === '\\' || next === "'") {
        result += next;
        i++;
        continue;
      }
    }
    result += ch;
  }
  return result;
}

function parseLuaJsonArgument(command, prefix) {
  assert(command.startsWith(prefix), 'Command should start with prefix ' + prefix);
  assert(command.endsWith(')'), 'Command should end with a closing parenthesis');
  const wrapped = command.substring(prefix.length, command.length - 1);
  assert(wrapped.length >= 2 && wrapped.charAt(0) === "'" && wrapped.charAt(wrapped.length - 1) === "'", 'Payload should be wrapped in single quotes');
  const inner = wrapped.substring(1, wrapped.length - 1);
  const decoded = decodeLuaStringLiteral(inner);
  return JSON.parse(decoded);
}

function parseSettingsSetStateCommand(command) {
  const prefix = 'settings.setState(';
  assert(command.startsWith(prefix), 'Command should start with settings.setState');
  assert(command.endsWith(')'), 'settings.setState command should end with a closing parenthesis');
  const inner = command.substring(prefix.length, command.length - 1);
  const match = inner.match(/userPaintPresets\s*=\s*'([^']*)'/);
  assert(match && match[1] !== undefined, 'settings.setState payload should include userPaintPresets string');
  const decoded = decodeLuaStringLiteral(match[1]);
  return JSON.parse(decoded);
}

function structuredClonePaints(paints) {
  return paints.map((paint) => ({
    baseColor: paint.baseColor.slice(),
    metallic: paint.metallic,
    roughness: paint.roughness,
    clearcoat: paint.clearcoat,
    clearcoatRoughness: paint.clearcoatRoughness
  }));
}

function cloneStateForEvent(scope) {
  const state = scope.state || {};
  const basePaints = Array.isArray(state.basePaints) ? structuredClonePaints(state.basePaints) : [];
  const partsClone = Array.isArray(state.parts) ? JSON.parse(JSON.stringify(state.parts)) : [];
  return {
    vehicleId: state.vehicleId,
    basePaints: basePaints,
    parts: partsClone
  };
}

function createPart(partPath, slotPath, basePaints) {
  return {
    partPath: partPath,
    slotPath: slotPath,
    partName: partPath.split('/').pop(),
    displayName: partPath,
    slotName: slotPath,
    hasCustomPaint: false,
    currentPaints: structuredClonePaints(basePaints),
    customPaints: null,
    paints: structuredClonePaints(basePaints)
  };
}

function findNode(nodes, partPath) {
  if (!Array.isArray(nodes)) {
    return null;
  }
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) {
      continue;
    }
    if (node.part && node.part.partPath === partPath) {
      return node;
    }
    const childResult = findNode(node.children, partPath);
    if (childResult) {
      return childResult;
    }
  }
  return null;
}

function instantiateController() {
  delete require.cache[require.resolve(path.join('..', 'ui/modules/apps/vehiclePartsPainting/app.js'))];
  controllerHooks = null;

  const bngApiCalls = [];
  const engineLuaCallbacks = [];
  const bngApiStub = {
    engineLua: function (command, callback) {
      bngApiCalls.push(command);
      if (typeof callback === 'function') {
        engineLuaCallbacks.push({ command: command, callback: callback });
      }
    }
  };

  const gotoGameStateCalls = [];
  const bngVueStub = {
    gotoGameState: function (stateName, options) {
      gotoGameStateCalls.push({ state: stateName, options: options });
    }
  };

  global.window = {
    bngApi: bngApiStub,
    console: console,
    bngVue: bngVueStub,
    __vehiclePartsPaintingTestHooks: {
      registerController: function (hooks) {
        controllerHooks = hooks;
      }
    }
  };

  const angularStub = createAngularStub();
  global.angular = angularStub;

  const mockInjector = {
    get: function (service) {
      if (service === 'bngApi') {
        return bngApiStub;
      }
      throw new Error('Unknown service requested: ' + service);
    }
  };

  require('../ui/modules/apps/vehiclePartsPainting/app.js');

  const module = angularStub.module('beamng.apps');
  const directiveEntry = module.getDirective('vehiclePartsPainting');
  if (!directiveEntry) {
    throw new Error('Directive vehiclePartsPainting not registered');
  }

  const directiveDefinition = directiveEntry.factory(mockInjector);
  const controllerDeclaration = directiveDefinition.controller;
  const controllerDeps = controllerDeclaration.slice(0, controllerDeclaration.length - 1);
  const controllerFn = controllerDeclaration[controllerDeclaration.length - 1];

  const scope = new ScopeStub();
  const interval = createIntervalStub();
  const timeout = createTimeoutStub();

  const injected = controllerDeps.map((dep) => {
    if (dep === '$scope') {
      return scope;
    }
    if (dep === '$interval') {
      return interval;
    }
    if (dep === '$timeout') {
      return timeout;
    }
    throw new Error('Unknown controller dependency: ' + dep);
  });

  controllerFn.apply(null, injected);
  scope.$digest();

  if (!controllerHooks) {
    throw new Error('Controller test hooks were not registered');
  }

  return {
    scope: scope,
    interval: interval,
    timeout: timeout,
    bngApiCalls: bngApiCalls,
    hooks: controllerHooks,
    engineLuaCallbacks: engineLuaCallbacks,
    gotoGameStateCalls: gotoGameStateCalls,
    window: global.window
  };
}

function emitState(scope, payload) {
  scope.$$emit('VehiclePartsPaintingState', payload);
  scope.$digest();
}

function applyCustomPaint(scope, partPath, colorUpdates) {
  const state = scope.state;
  const node = findNode(state.filteredTree, partPath);
  assert(node && node.part, 'Tree node for part ' + partPath + ' not found');
  scope.selectPart(node.part);
  if (!Array.isArray(scope.editedPaints) || !scope.editedPaints.length) {
    throw new Error('Edited paints not initialized for part ' + partPath);
  }
  const paint = scope.editedPaints[0];
  paint.color = Object.assign({}, paint.color, colorUpdates);
  scope.applyPaint();
  scope.$digest();
}

function resetPaint(scope, partPath) {
  const state = scope.state;
  const node = findNode(state.filteredTree, partPath);
  assert(node && node.part, 'Tree node for part ' + partPath + ' not found');
  scope.selectPart(node.part);
  scope.resetPaint();
  scope.$digest();
}

(function runTests() {
  const controller = instantiateController();
  const scope = controller.scope;
  const bngApiCalls = controller.bngApiCalls;
  const hooks = controller.hooks;

  const basePaints = [
    {
      baseColor: [1, 0, 0, 1],
      metallic: 0,
      roughness: 0,
      clearcoat: 0,
      clearcoatRoughness: 0
    }
  ];

  const parts = [
    createPart('vehicle/root', 'body', basePaints),
    createPart('vehicle/hood', 'body/hood', basePaints),
    createPart('vehicle/door', 'body/door', basePaints)
  ];

  emitState(scope, {
    vehicleId: 4242,
    basePaints: basePaints,
    parts: parts
  });

  const state = scope.state;
  assert.strictEqual(state.filteredTree.length, 1, 'Expected a single root node for body slot');
  const nodesByPath = hooks.getTreeNodesByPath();
  assert(nodesByPath['vehicle/root'] && nodesByPath['vehicle/root'].length, 'Root node should be indexed');
  assert(nodesByPath['vehicle/hood'] && nodesByPath['vehicle/hood'].length, 'Hood node should be indexed');
  assert(nodesByPath['vehicle/door'] && nodesByPath['vehicle/door'].length, 'Door node should be indexed');

  applyCustomPaint(scope, 'vehicle/root', { g: 200 });
  let node = findNode(state.filteredTree, 'vehicle/root');
  assert(node && scope.hasCustomBadge(node.part), 'Part 1 should have custom paint after apply');

  scope.state.filterText = 'hood';
  scope.$digest();

  applyCustomPaint(scope, 'vehicle/hood', { b: 120 });
  node = findNode(state.filteredTree, 'vehicle/hood');
  assert(node && scope.hasCustomBadge(node.part), 'Filtered tree should reflect custom paint for hood');

  scope.clearFilter();
  scope.$digest();
  node = findNode(state.filteredTree, 'vehicle/root');
  assert(node && scope.hasCustomBadge(node.part), 'Part 1 should retain custom paint after updating another part');
  node = findNode(state.filteredTree, 'vehicle/hood');
  assert(node && scope.hasCustomBadge(node.part), 'Part 2 should show custom paint after apply');
  let doorNode = findNode(state.filteredTree, 'vehicle/door');
  assert(doorNode && !scope.hasCustomBadge(doorNode.part), 'Door should not have a custom paint badge by default');
  const customMap = hooks.getCustomPaintState();
  customMap['vehicle/door'] = true;
  scope.$digest();
  doorNode = findNode(state.filteredTree, 'vehicle/door');
  assert(doorNode && scope.hasCustomBadge(doorNode.part), 'Door should reflect custom paint state from computed map');

  resetPaint(scope, 'vehicle/hood');
  node = findNode(state.filteredTree, 'vehicle/hood');
  assert(node && !scope.hasCustomBadge(node.part), 'Part 2 custom paint badge should disappear after reset');
  node = findNode(state.filteredTree, 'vehicle/root');
  assert(node && scope.hasCustomBadge(node.part), 'Part 1 custom paint badge should remain after resetting part 2');

  resetPaint(scope, 'vehicle/root');
  node = findNode(state.filteredTree, 'vehicle/root');
  assert(node && !scope.hasCustomBadge(node.part), 'Part 1 custom paint badge should be cleared after reset');

  hooks.handleFilterInput('hood');
  node = findNode(state.filteredTree, 'vehicle/hood');
  assert(node && state.filteredParts.length === 1, 'Filter input handler should narrow results to hood immediately');
  scope.$digest();

  hooks.handleFilterInput('hood scoop');
  assert.strictEqual(state.filteredParts.length, 0, 'Filter handler should exclude parts with unmatched queries');
  scope.$digest();

  hooks.handleFilterInput('hood');
  node = findNode(state.filteredTree, 'vehicle/hood');
  assert(node && state.filteredParts.length === 1, 'Filter handler should restore hood results after refining query');
  scope.$digest();

  state.filterText = 'vehicle/root';
  scope.$digest();
  node = findNode(state.filteredTree, 'vehicle/root');
  assert(node && state.filteredParts.some((part) => part.partPath === 'vehicle/root'), 'Watcher should recompute filtered parts after external filterText changes');

  hooks.handleFilterInput('');
  scope.$digest();
  assert.strictEqual(state.filterText, '', 'Filter handler should clear the filter text');

  state.filteredTree = [];
  hooks.handleFilterInput('');
  scope.$digest();
  assert.strictEqual(state.filteredTree.length, 1, 'Filter handler should repopulate the full tree when value remains unchanged');
  node = findNode(state.filteredTree, 'vehicle/root');
  assert(node, 'Root node should be present after reapplying empty filter value');

  assert(Array.isArray(scope.basePaintEditors) && scope.basePaintEditors.length === 3, 'Base paint editors should mirror vehicle paints');
  scope.basePaintEditors[0].color.g = 128;
  scope.basePaintEditors[0].color.b = 64;
  scope.$digest();
  assert(scope.hasBasePaintChanges(), 'Base paint change should be detected');
  scope.applyBasePaints();
  scope.$digest();
  assert(!scope.hasBasePaintChanges(), 'Base paint change state should clear after apply');
  const lastCommand = bngApiCalls[bngApiCalls.length - 1];
  assert(lastCommand && lastCommand.startsWith('freeroam_vehiclePartsPainting.setVehicleBasePaintsJson('), 'Base paint command should be queued');
  const updatedBasePaint = scope.state.basePaints[0];
  assert(Math.abs(updatedBasePaint.baseColor[1] - (128 / 255)) < 0.001, 'Base paint green channel should update');
  assert(Math.abs(updatedBasePaint.baseColor[2] - (64 / 255)) < 0.001, 'Base paint blue channel should update');
  doorNode = findNode(state.filteredTree, 'vehicle/door');
  const doorPaint = doorNode.part.currentPaints[0];
  assert(Math.abs(doorPaint.baseColor[1] - (128 / 255)) < 0.001, 'Door part should inherit updated base paint');
  assert(Math.abs(doorPaint.baseColor[2] - (64 / 255)) < 0.001, 'Door part should inherit updated base paint blue channel');
  assert(!scope.hasCustomBadge(doorNode.part), 'Door should remain without a custom badge after base paint change');

  scope.$$emit('VehiclePartsPaintingSavedConfigs', {
    vehicleId: 4242,
    configs: [
      {
        relativePath: 'vehicles/example/config_a.pc',
        displayName: 'Config Alpha',
        previewImage: 'vehicles/example/config_a.png',
        player: true,
        isUserConfig: true
      },
      {
        relativePath: 'vehicles/example/config_b.pc',
        displayName: 'Config Beta',
        previewImage: '',
        player: false,
        isUserConfig: false
      }
    ]
  });
  scope.$digest();

  assert(scope.hasSavedConfigs(), 'Saved configuration list should populate from event payload');
  assert.strictEqual(state.savedConfigs.length, 2, 'Saved configuration list should contain two entries');
  let userConfig = state.savedConfigs[0];
  let stockConfig = state.savedConfigs[1];
  if (!scope.canDeleteSavedConfig(userConfig)) {
    // Sorting may change order depending on locale; ensure user config reference is correct.
    const swapped = userConfig;
    userConfig = stockConfig;
    stockConfig = swapped;
  }

  assert(scope.hasSavedConfigPreview(userConfig), 'User configuration should report an available preview');
  const previewSrc = scope.getSavedConfigPreviewSrc(userConfig);
  assert.strictEqual(previewSrc, '/vehicles/example/config_a.png', 'Preview URL should resolve to the vehicle resource path');
  assert(previewSrc.indexOf('/local/') === -1, 'Preview URL should not include the /local prefix');
  assert(!scope.hasSavedConfigPreview(stockConfig), 'Config without preview should return false from helper');
  assert(scope.canDeleteSavedConfig(userConfig), 'User configuration should be deletable');
  assert(!scope.canDeleteSavedConfig(stockConfig), 'Non-user configuration should not expose deletion');

  const playerFlagConfig = {
    relativePath: 'vehicles/example/config_c.pc',
    displayName: 'Config Gamma',
    player: true
  };
  assert(scope.canDeleteSavedConfig(playerFlagConfig), 'Player flag should enable deletion');

  const nonPlayerFlagConfig = {
    relativePath: 'vehicles/example/config_d.pc',
    displayName: 'Config Delta',
    player: false
  };
  assert(!scope.canDeleteSavedConfig(nonPlayerFlagConfig), 'Non-player flag should prevent deletion');

  const numericPlayerFlagConfig = {
    relativePath: 'vehicles/example/config_e.pc',
    displayName: 'Config Epsilon',
    player: 1
  };
  assert(scope.canDeleteSavedConfig(numericPlayerFlagConfig), 'Numeric player flags should be treated as truthy');

  const stringPlayerFlagConfig = {
    relativePath: 'vehicles/example/config_f.pc',
    displayName: 'Config Zeta',
    player: 'yes'
  };
  assert(scope.canDeleteSavedConfig(stringPlayerFlagConfig), 'String player flags should be treated as truthy');

  const legacyUserFlagConfig = {
    relativePath: 'vehicles/example/config_g.pc',
    displayName: 'Config Eta',
    isUserConfig: 1
  };
  assert(scope.canDeleteSavedConfig(legacyUserFlagConfig), 'Legacy user flags should still allow deletion');

  const explicitDisableConfig = {
    relativePath: 'vehicles/example/config_h.pc',
    displayName: 'Config Theta',
    player: true,
    allowDelete: false
  };
  assert(!scope.canDeleteSavedConfig(explicitDisableConfig), 'Explicit deletion disable should override player flag');

  const ambiguousConfig = {
    relativePath: 'vehicles/example/config_i.pc',
    displayName: 'Config Iota'
  };
  assert(!scope.canDeleteSavedConfig(ambiguousConfig), 'Ambiguous configuration should default to non-deletable');

  scope.promptDeleteSavedConfig(stockConfig);
  assert.strictEqual(state.deleteConfigDialog.visible, false, 'Delete dialog should ignore non-deletable configurations');

  scope.promptDeleteSavedConfig(userConfig);
  assert.strictEqual(state.deleteConfigDialog.visible, true, 'Delete dialog should appear for deletable configurations');
  assert(state.deleteConfigDialog.config && state.deleteConfigDialog.config.relativePath === userConfig.relativePath, 'Delete dialog should target the selected configuration');
  assert(scope.hasSavedConfigPreview(state.deleteConfigDialog.config), 'Delete dialog should surface the configuration preview');
  assert.strictEqual(state.deleteConfigDialog.isDeleting, false, 'Delete dialog should start idle');

  scope.cancelDeleteSavedConfig();
  assert.strictEqual(state.deleteConfigDialog.visible, false, 'Delete dialog should close when cancelled');

  scope.promptDeleteSavedConfig(userConfig);
  const deleteCommandCountBefore = bngApiCalls.length;
  scope.confirmDeleteSavedConfig();
  assert(state.deleteConfigDialog.isDeleting, 'Delete dialog should mark deletion in progress');
  assert.strictEqual(bngApiCalls.length, deleteCommandCountBefore + 1, 'Confirming delete should queue a backend command');
  const deleteCommand = bngApiCalls[bngApiCalls.length - 1];
  assert.strictEqual(deleteCommand, "freeroam_vehiclePartsPainting.deleteSavedConfiguration('vehicles/example/config_a.pc')", 'Delete command should include sanitized path');

  scope.$$emit('VehiclePartsPaintingSavedConfigs', {
    vehicleId: 4242,
    configs: [
      {
        relativePath: 'vehicles/example/config_b.pc',
        displayName: 'Config Beta',
        previewImage: '',
        isUserConfig: false
      }
    ]
  });
  scope.$digest();

  assert.strictEqual(state.savedConfigs.length, 1, 'Saved configuration list should update after backend refresh');
  assert.strictEqual(state.deleteConfigDialog.visible, false, 'Delete dialog should close once configuration disappears');
  assert.strictEqual(state.deleteConfigDialog.config, null, 'Delete dialog should clear target after refresh');
  assert.strictEqual(state.deleteConfigDialog.isDeleting, false, 'Delete dialog should reset deleting state after refresh');

  const commandCountBeforeAdd = bngApiCalls.length;
  const promptCalls = [];
  global.window.prompt = function (message, defaultValue) {
    promptCalls.push({ message: message, defaultValue: defaultValue });
    return null;
  };
  scope.addColorPreset(scope.basePaintEditors[0]);
  assert.strictEqual(promptCalls.length, 1, 'Adding a color preset should present a prompt once');
  assert.strictEqual(bngApiCalls.length, commandCountBeforeAdd + 1, 'Adding a color preset should queue a backend command even when the prompt is cancelled');
  const addCommand = bngApiCalls[bngApiCalls.length - 1];
  const storedPresets = parseSettingsSetStateCommand(addCommand);
  assert(Array.isArray(storedPresets) && storedPresets.length === 1, 'Preset storage should contain the new entry');
  const storedPreset = storedPresets[0];
  assert(Array.isArray(storedPreset.baseColor) && storedPreset.baseColor.length === 4, 'Stored preset should include RGBA components');
  assert(Math.abs(storedPreset.baseColor[0] - 1) < 1e-6, 'Stored red channel should be full intensity');
  assert(Math.abs(storedPreset.baseColor[1] - (128 / 255)) < 1e-6, 'Stored green channel should mirror the edited value');
  assert(Math.abs(storedPreset.baseColor[2] - (64 / 255)) < 1e-6, 'Stored blue channel should mirror the edited value');
  assert(Math.abs(storedPreset.baseColor[3] - 1) < 1e-6, 'Stored alpha channel should default to one');
  assert.strictEqual(storedPreset.name, '#FF8040', 'Preset name should default to the color hex when prompt is cancelled');
  assert.strictEqual(storedPreset.metallic, 0, 'Stored metallic value should mirror the source paint');
  assert.strictEqual(storedPreset.roughness, 0, 'Stored roughness value should mirror the source paint');
  assert.strictEqual(storedPreset.clearcoat, 0, 'Stored clearcoat value should mirror the source paint');
  assert.strictEqual(storedPreset.clearcoatRoughness, 0, 'Stored clearcoat roughness should mirror the source paint');

  delete global.window.prompt;

  assert(state.basePaintCollapsed === false, 'Base paint panel should default to expanded');
  scope.toggleBasePaintCollapsed();
  assert(state.basePaintCollapsed === true, 'Base paint panel should collapse when toggled');
  scope.toggleBasePaintCollapsed();
  assert(state.basePaintCollapsed === false, 'Base paint panel should expand when toggled again');

  scope.$$emit('SettingsChanged', {
    values: {
      userPaintPresets: JSON.stringify([{
        baseColor: [0.2, 0.1, 0.8, 1],
        metallic: 0.4,
        roughness: 0.5,
        clearcoat: 0.6,
        clearcoatRoughness: 0.2,
        name: 'Sample purple'
      }])
    }
  });
  scope.$digest();

  assert(Array.isArray(state.colorPresets) && state.colorPresets.length === 1, 'Color presets should sync from event payload');
  let palettePreset = state.colorPresets[0];
  assert.strictEqual(palettePreset.storageIndex, 1, 'Preset should retain its storage index');

  scope.basePaintEditors[0].color.r = 32;
  scope.basePaintEditors[0].color.g = 64;
  scope.applyBasePaints();
  scope.$digest();

  const repaintState = cloneStateForEvent(scope);
  repaintState.colorPresets = null;
  emitState(scope, repaintState);
  assert(Array.isArray(state.colorPresets) && state.colorPresets.length === 1, 'Color presets should persist when payload omits presets via null placeholder');

  const invalidPalettePayload = cloneStateForEvent(scope);
  invalidPalettePayload.colorPresets = { length: 1, n: 1 };
  emitState(scope, invalidPalettePayload);
  assert(Array.isArray(state.colorPresets) && state.colorPresets.length === 1, 'Color presets should persist when payload lacks numeric entries');

  const luaStylePalette = cloneStateForEvent(scope);
  luaStylePalette.colorPresets = {
    length: 1,
    n: 1,
    1: {
      name: 'Lua style swatch',
      value: { r: 0.3, g: 0.4, b: 0.5, a: 0.75 },
      metallic: 0.1,
      roughness: 0.2,
      clearcoat: 0.3,
      clearcoatRoughness: 0.4
    }
  };
  emitState(scope, luaStylePalette);
  assert(Array.isArray(state.colorPresets) && state.colorPresets.length === 1, 'Color presets should parse Lua-style tables');
  palettePreset = state.colorPresets[0];
  assert.strictEqual(palettePreset.name, 'Lua style swatch', 'Lua-style payload should preserve preset names');
  assert(Math.abs(palettePreset.paint.metallic - 0.1) < 1e-6, 'Lua-style payload should preserve numeric fields');

  const placeholderPaletteAfterBaseApply = cloneStateForEvent(scope);
  placeholderPaletteAfterBaseApply.colorPresets = [];
  emitState(scope, placeholderPaletteAfterBaseApply);
  assert(Array.isArray(state.colorPresets) && state.colorPresets.length === 1, 'Color presets should persist when base paint updates omit presets via empty array placeholder');

  applyCustomPaint(scope, 'vehicle/root', { r: 64 });
  const placeholderPaletteAfterPartApply = cloneStateForEvent(scope);
  placeholderPaletteAfterPartApply.colorPresets = [];
  emitState(scope, placeholderPaletteAfterPartApply);
  assert(Array.isArray(state.colorPresets) && state.colorPresets.length === 1, 'Color presets should persist when part repaint updates omit presets via empty array placeholder');

  scope.onPresetPressStart({}, palettePreset);
  controller.timeout.flush();
  assert(state.removePresetDialog.visible === true, 'Holding a preset should display removal dialog');
  assert(state.removePresetDialog.preset && state.removePresetDialog.preset.storageIndex === 1, 'Removal dialog should target the held preset');

  const commandCountBeforeRemove = bngApiCalls.length;
  scope.confirmRemovePreset();
  assert.strictEqual(state.removePresetDialog.visible, false, 'Removal dialog should close after confirmation');
  assert.strictEqual(bngApiCalls.length, commandCountBeforeRemove + 1, 'Removing a preset should queue a backend command');
  assert(Array.isArray(state.colorPresets) && state.colorPresets.length === 0, 'Color presets should clear locally after removing the last preset');
  const removeCommand = bngApiCalls[bngApiCalls.length - 1];
  const remainingPresets = parseSettingsSetStateCommand(removeCommand);
  assert(Array.isArray(remainingPresets) && remainingPresets.length === 0, 'Removing a preset should clear stored presets');

  const gotoCalls = controller.gotoGameStateCalls;
  const engineLuaCallbacks = controller.engineLuaCallbacks;

  assert(engineLuaCallbacks.length >= 1, 'Initial vehicle state should probe livery editor support');
  let initialProbeObserved = false;
  while (engineLuaCallbacks.length) {
    const probe = engineLuaCallbacks.shift();
    assert(probe && typeof probe.callback === 'function', 'Initial livery probe should expose a callback');
    assert(probe.command && probe.command.indexOf('core_vehicle_partmgmt.hasAvailablePart') !== -1, 'Initial livery probe should query dynamic decal availability');
    probe.callback(true);
    initialProbeObserved = true;
  }
  assert(initialProbeObserved, 'Initial vehicle setup should enqueue at least one livery editor probe');
  assert.strictEqual(state.liveryEditorSupported, true, 'Supported vehicles should mark livery editor availability after initial probe');

  scope.state.vehicleId = scope.state.vehicleId || 4242;

  scope.openLiveryEditor();
  assert.strictEqual(gotoCalls.length, 0, 'Livery editor should not open before capability probe resolves');
  assert(engineLuaCallbacks.length >= 1, 'Livery editor launch should request dynamic decal availability');
  const liveryProbe = engineLuaCallbacks.shift();
  assert(liveryProbe && typeof liveryProbe.callback === 'function', 'Livery support probe should expose a callback');
  assert(liveryProbe.command && liveryProbe.command.indexOf('core_vehicle_partmgmt.hasAvailablePart') !== -1, 'Livery probe should query dynamic decal part availability');

  liveryProbe.callback(true);
  assert(state.liveryEditorConfirmation.visible, 'Supported vehicles should prompt for livery editor confirmation');
  assert.strictEqual(state.liveryEditorSupported, true, 'Successful livery probe should keep availability flag true');
  assert.strictEqual(gotoCalls.length, 0, 'Livery editor navigation should wait for confirmation dialog response');
  scope.confirmLiveryEditorLaunch();
  assert.strictEqual(state.liveryEditorConfirmation.visible, false, 'Confirmation dialog should close after confirming');
  assert.strictEqual(gotoCalls.length, 1, 'Supported vehicles should navigate to the livery editor when confirmed');
  assert.strictEqual(gotoCalls[0].state, 'livery-manager', 'Livery editor navigation target should be livery-manager');

  gotoCalls.length = 0;

  scope.openLiveryEditor();
  const cancelProbe = engineLuaCallbacks.shift();
  assert(cancelProbe && typeof cancelProbe.callback === 'function', 'Confirmation run should expose a callback');
  cancelProbe.callback(true);
  assert(state.liveryEditorConfirmation.visible, 'Cancel scenario should surface confirmation dialog');
  scope.cancelLiveryEditorLaunch();
  assert.strictEqual(state.liveryEditorConfirmation.visible, false, 'Confirmation dialog should close when cancelled');
  assert.strictEqual(gotoCalls.length, 0, 'Cancelling the confirmation dialog should not navigate to the livery editor');

  scope.openLiveryEditor();
  const unsupportedProbe = engineLuaCallbacks.shift();
  assert(unsupportedProbe && typeof unsupportedProbe.callback === 'function', 'Second livery probe should expose a callback');
  unsupportedProbe.callback(false);
  assert.strictEqual(state.liveryEditorConfirmation.visible, false, 'Unsupported vehicles should not leave the confirmation dialog open');
  assert.strictEqual(state.liveryEditorSupported, false, 'Unsupported livery probe should mark availability as false');
  const liveryMessageCommand = bngApiCalls[bngApiCalls.length - 1];
  assert(liveryMessageCommand && liveryMessageCommand.indexOf('ui_message') !== -1, 'Unsupported vehicles should trigger a UI message');
  assert(liveryMessageCommand.toLowerCase().indexOf('not available') !== -1, 'Unsupported vehicles should explain why the livery editor is unavailable');
  assert.strictEqual(gotoCalls.length, 0, 'Unsupported vehicles should not navigate to the livery editor');

  const callbacksAfterUnsupported = engineLuaCallbacks.length;
  const messageCountBeforeDisabledLaunch = bngApiCalls.length;
  scope.openLiveryEditor();
  assert.strictEqual(engineLuaCallbacks.length, callbacksAfterUnsupported, 'Disabled livery editor action should not queue additional probes');
  assert.strictEqual(bngApiCalls.length, messageCountBeforeDisabledLaunch + 1, 'Disabled livery editor action should surface a UI message');
  const disabledLaunchMessage = bngApiCalls[bngApiCalls.length - 1];
  assert(disabledLaunchMessage && disabledLaunchMessage.indexOf('ui_message') !== -1, 'Disabled livery editor action should use ui_message feedback');

  console.log('All vehicle parts painting tests passed.');
})();
