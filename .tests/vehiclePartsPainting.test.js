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

function structuredClonePaints(paints) {
  return paints.map((paint) => ({
    baseColor: paint.baseColor.slice(),
    metallic: paint.metallic,
    roughness: paint.roughness,
    clearcoat: paint.clearcoat,
    clearcoatRoughness: paint.clearcoatRoughness
  }));
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
  const bngApiStub = {
    engineLua: function (command) {
      bngApiCalls.push(command);
    }
  };

  global.window = {
    bngApi: bngApiStub,
    console: console,
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
    hooks: controllerHooks
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

  assert(state.basePaintCollapsed === false, 'Base paint panel should default to expanded');
  scope.toggleBasePaintCollapsed();
  assert(state.basePaintCollapsed === true, 'Base paint panel should collapse when toggled');
  scope.toggleBasePaintCollapsed();
  assert(state.basePaintCollapsed === false, 'Base paint panel should expand when toggled again');

  scope.$$emit('VehiclePartsPaintingColorPresets', {
    colorPresets: [{
      name: 'Sample purple',
      value: [0.2, 0.1, 0.8, 1],
      paint: {
        baseColor: [0.2, 0.1, 0.8, 1],
        metallic: 0.4,
        roughness: 0.5,
        clearcoat: 0.6,
        clearcoatRoughness: 0.2
      },
      storageIndex: 1
    }]
  });
  scope.$digest();

  assert(Array.isArray(state.colorPresets) && state.colorPresets.length === 1, 'Color presets should sync from event payload');
  const palettePreset = state.colorPresets[0];
  assert.strictEqual(palettePreset.storageIndex, 1, 'Preset should retain its storage index');

  scope.onPresetPressStart({}, palettePreset);
  controller.timeout.flush();
  assert(state.removePresetDialog.visible === true, 'Holding a preset should display removal dialog');
  assert(state.removePresetDialog.preset && state.removePresetDialog.preset.storageIndex === 1, 'Removal dialog should target the held preset');

  const commandCountBeforeRemove = bngApiCalls.length;
  scope.confirmRemovePreset();
  assert.strictEqual(state.removePresetDialog.visible, false, 'Removal dialog should close after confirmation');
  assert.strictEqual(bngApiCalls.length, commandCountBeforeRemove + 1, 'Removing a preset should queue a backend command');
  assert.strictEqual(bngApiCalls[bngApiCalls.length - 1], 'freeroam_vehiclePartsPainting.removeColorPreset(1)', 'Removal command should include preset index');

  console.log('All vehicle parts painting tests passed.');
})();
