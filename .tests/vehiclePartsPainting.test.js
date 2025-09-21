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

function createSessionStorageStub(initialData) {
  const data = Object.create(null);
  if (initialData && typeof initialData === 'object') {
    Object.keys(initialData).forEach((key) => {
      data[String(key)] = String(initialData[key]);
    });
  }

  return {
    getItem: function getItem(key) {
      key = String(key);
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem: function setItem(key, value) {
      data[String(key)] = String(value);
    },
    removeItem: function removeItem(key) {
      key = String(key);
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        delete data[key];
      }
    },
    clear: function clear() {
      Object.keys(data).forEach((key) => {
        delete data[key];
      });
    }
  };
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
  const originalBasePaints = Array.isArray(state.originalBasePaints) ? structuredClonePaints(state.originalBasePaints) : [];
  const partsClone = Array.isArray(state.parts) ? JSON.parse(JSON.stringify(state.parts)) : [];
  return {
    vehicleId: state.vehicleId,
    basePaints: basePaints,
    originalBasePaints: originalBasePaints,
    parts: partsClone
  };
}

function createPart(partPath, slotPath, basePaints, overrides) {
  const part = {
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
  if (overrides && typeof overrides === 'object') {
    Object.assign(part, overrides);
  }
  return part;
}

function partMatchesQuery(part, query) {
  if (!query) {
    return true;
  }
  if (!part) {
    return false;
  }
  const lowered = query.toLowerCase();
  const fields = [];
  if (part.displayName) { fields.push(part.displayName); }
  if (part.partName) { fields.push(part.partName); }
  if (part.slotName) { fields.push(part.slotName); }
  if (part.slotLabel) { fields.push(part.slotLabel); }
  if (part.partPath) { fields.push(part.partPath); }
  if (part.slotPath) { fields.push(part.slotPath); }
  for (let i = 0; i < fields.length; i++) {
    const value = fields[i];
    if (typeof value === 'string' && value.toLowerCase().indexOf(lowered) !== -1) {
      return true;
    }
  }
  return false;
}

function collectWordText(word) {
  if (!word || !Array.isArray(word.segments)) {
    return '';
  }
  let text = '';
  for (let i = 0; i < word.segments.length; i++) {
    const segment = word.segments[i];
    if (!segment || segment.text === undefined || segment.text === null) {
      continue;
    }
    text += String(segment.text);
  }
  return text;
}

function getNormalizedPartName(part) {
  if (!part) {
    return '';
  }
  const source = part.displayName || part.partName || part.partPath || '';
  return String(source).trim().replace(/\s+/g, ' ');
}

function getNormalizedSlotLabel(part) {
  if (!part) {
    return '';
  }
  const source = part.slotLabel || part.slotName || part.slotPath || '';
  return String(source).trim().replace(/\s+/g, ' ');
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

function instantiateController(options) {
  options = options || {};
  const autoResolveExtension = options.autoResolveExtension !== false;
  delete require.cache[require.resolve(path.join('..', 'ui/modules/apps/vehiclePartsPainting/app.js'))];
  controllerHooks = null;

  const bngApiCalls = [];
  const engineLuaCallbacks = [];
  const bngApiStub = {
    engineLua: function (command, callback) {
      bngApiCalls.push(command);
      if (typeof callback !== 'function') { return; }
      if (autoResolveExtension && command && command.indexOf('freeroam_vehiclePartsPainting ~= nil') !== -1) {
        try {
          callback(true);
        } catch (err) {
          // Tests will surface callback errors separately.
          throw err;
        }
        return;
      }
      engineLuaCallbacks.push({ command: command, callback: callback });
    }
  };

  const gotoGameStateCalls = [];
  const bngVueStub = {
    gotoGameState: function (stateName, options) {
      gotoGameStateCalls.push({ state: stateName, options: options });
    }
  };

  let elementRect = { left: 0, top: 0, width: 0, height: 0 };
  const elementStub = [{
    getBoundingClientRect: function () {
      return {
        left: elementRect.left,
        top: elementRect.top,
        width: elementRect.width,
        height: elementRect.height,
        right: elementRect.left + elementRect.width,
        bottom: elementRect.top + elementRect.height
      };
    }
  }];
  elementStub.length = 1;

  global.window = {
    bngApi: bngApiStub,
    console: console,
    bngVue: bngVueStub,
    innerWidth: 1920,
    document: {
      documentElement: { clientWidth: 1920 },
      body: { clientWidth: 1920 }
    },
    __vehiclePartsPaintingTestHooks: {
      registerController: function (hooks) {
        controllerHooks = hooks;
      }
    }
  };

  if (options.sessionStorage) {
    global.window.sessionStorage = options.sessionStorage;
  }

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
    if (dep === '$element') {
      return elementStub;
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
    window: global.window,
    sessionStorage: global.window.sessionStorage || null,
    setElementBoundingRect: function (rect) {
      if (!rect || typeof rect !== 'object') { return; }
      elementRect = Object.assign({}, elementRect, rect);
    }
  };
}

function emitState(scope, payload) {
  const data = Object.assign({}, payload);
  if (Array.isArray(data.basePaints)) {
    data.basePaints = structuredClonePaints(data.basePaints);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'originalBasePaints')) {
    data.originalBasePaints = Array.isArray(data.originalBasePaints)
      ? structuredClonePaints(data.originalBasePaints)
      : [];
  } else {
    data.originalBasePaints = Array.isArray(data.basePaints) ? structuredClonePaints(data.basePaints) : [];
  }
  scope.$$emit('VehiclePartsPaintingState', data);
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

(function verifyExtensionCommandQueueRecovery() {
  const controller = instantiateController({ autoResolveExtension: false });
  const timeout = controller.timeout;
  const engineLuaCallbacks = controller.engineLuaCallbacks;
  const bngApiCalls = controller.bngApiCalls;

  assert(engineLuaCallbacks.length >= 1, 'Initial extension probe should be queued');
  const firstProbe = engineLuaCallbacks.shift();
  assert(firstProbe.command && firstProbe.command.trim() === 'freeroam_vehiclePartsPainting ~= nil',
    'First probe should query extension availability');
  firstProbe.callback(false);

  const executedBeforeReady = bngApiCalls.filter(function (command) {
    return command && command.indexOf('(function() local available = freeroam_vehiclePartsPainting ~= nil') === 0;
  });
  assert.strictEqual(executedBeforeReady.length, 0, 'Commands should not execute while extension is unavailable');

  timeout.flush();
  assert(engineLuaCallbacks.length >= 1, 'Availability retry should schedule another probe');
  const retryProbe = engineLuaCallbacks.shift();
  assert(retryProbe.command && retryProbe.command.trim() === 'freeroam_vehiclePartsPainting ~= nil',
    'Retry probe should query extension availability');
  retryProbe.callback(true);

  let guardedCommandCallbacks = 0;
  while (engineLuaCallbacks.length) {
    const pending = engineLuaCallbacks.shift();
    if (pending.command && pending.command.indexOf('freeroam_vehiclePartsPainting ~= nil') !== -1) {
      pending.callback(true);
      if (pending.command.indexOf('(function() local available = freeroam_vehiclePartsPainting ~= nil') === 0) {
        guardedCommandCallbacks++;
      }
    } else {
      pending.callback(true);
    }
  }

  const executedAfterReady = bngApiCalls.filter(function (command) {
    return command && command.indexOf('(function() local available = freeroam_vehiclePartsPainting ~= nil') === 0;
  });
  assert(executedAfterReady.some(function (command) {
    return command.indexOf('freeroam_vehiclePartsPainting.requestState()') !== -1;
  }), 'Queued requestState command should execute after extension becomes available');
  assert(executedAfterReady.some(function (command) {
    return command.indexOf('freeroam_vehiclePartsPainting.requestSavedConfigs()') !== -1;
  }), 'Queued requestSavedConfigs command should execute after extension becomes available');
  assert.strictEqual(guardedCommandCallbacks >= 2, true,
    'Guarded command callbacks should be invoked for each queued command');
})();

(function verifyWorldReadyReinitialization() {
  const controller = instantiateController({ autoResolveExtension: false });
  const scope = controller.scope;
  const timeout = controller.timeout;
  const engineLuaCallbacks = controller.engineLuaCallbacks;
  const bngApiCalls = controller.bngApiCalls;
  const hooks = controller.hooks;

  assert(engineLuaCallbacks.length >= 1, 'Initial extension availability probe should be enqueued');
  const initialProbe = engineLuaCallbacks.shift();
  assert(initialProbe.command && initialProbe.command.trim() === 'freeroam_vehiclePartsPainting ~= nil',
    'Initial availability probe should query extension readiness');
  initialProbe.callback(false);

  timeout.flush();
  assert(engineLuaCallbacks.length >= 1, 'Availability retry should schedule another probe');
  engineLuaCallbacks.splice(0, engineLuaCallbacks.length);

  const loadCallsBefore = bngApiCalls.filter(function (command) {
    return command === 'extensions.load("freeroam_vehiclePartsPainting")';
  }).length;
  const commandCountBefore = bngApiCalls.length;

  scope.$$emit('VehiclePartsPaintingWorldReady', { worldReadyState: 1, previousState: 0 });
  scope.$digest();

  assert.strictEqual(hooks.getLastWorldReadyState(), 1, 'World ready handler should record the last state value');
  assert.strictEqual(hooks.isExtensionReady(), false, 'World ready initialization should reset extension readiness');
  assert.strictEqual(hooks.hasAvailabilityCheckInFlight(), true,
    'World ready initialization should restart the availability probe');
  assert.strictEqual(hooks.hasAvailabilityRetryScheduled(), false,
    'World ready initialization should clear any pending availability retry');

  const queueSnapshot = hooks.getExtensionQueueSnapshot();
  assert(queueSnapshot.length >= 2, 'World ready initialization should queue refresh commands');
  assert(queueSnapshot.some(function (command) {
    return command.indexOf('freeroam_vehiclePartsPainting.requestState()') !== -1;
  }), 'World ready initialization should queue a requestState command');
  assert(queueSnapshot.some(function (command) {
    return command.indexOf('freeroam_vehiclePartsPainting.requestSavedConfigs()') !== -1;
  }), 'World ready initialization should queue a requestSavedConfigs command');

  const loadCallsAfter = bngApiCalls.filter(function (command) {
    return command === 'extensions.load("freeroam_vehiclePartsPainting")';
  }).length;
  assert.strictEqual(loadCallsAfter, loadCallsBefore + 1,
    'World ready initialization should reload the freeroam extension');

  assert(bngApiCalls.length >= commandCountBefore + 2,
    'World ready initialization should emit additional engine Lua commands');

  assert(engineLuaCallbacks.length >= 1, 'World ready initialization should enqueue a fresh availability probe');
  const availabilityProbe = engineLuaCallbacks[0];
  assert(availabilityProbe.command && availabilityProbe.command.trim() === 'freeroam_vehiclePartsPainting ~= nil',
    'Availability probe should check for the freeroam extension');

  const commandCountAfter = bngApiCalls.length;
  scope.$$emit('VehiclePartsPaintingWorldReady', { worldReadyState: 1 });
  scope.$digest();
  assert.strictEqual(bngApiCalls.length, commandCountAfter,
    'Duplicate world ready notifications should not enqueue additional commands');
})();

(function verifyForcedWorldReadyReinitializationFromEngine() {
  const controller = instantiateController({ autoResolveExtension: false });
  const scope = controller.scope;
  const timeout = controller.timeout;
  const engineLuaCallbacks = controller.engineLuaCallbacks;
  const bngApiCalls = controller.bngApiCalls;
  const hooks = controller.hooks;

  assert(engineLuaCallbacks.length >= 1, 'Initial extension availability probe should be enqueued');
  const initialProbe = engineLuaCallbacks.shift();
  assert(initialProbe.command && initialProbe.command.trim() === 'freeroam_vehiclePartsPainting ~= nil',
    'Initial availability probe should query extension readiness');
  initialProbe.callback(false);

  timeout.flush();
  engineLuaCallbacks.splice(0, engineLuaCallbacks.length);
  bngApiCalls.splice(0, bngApiCalls.length);

  scope.$$emit('VehiclePartsPaintingWorldReady', { worldReadyState: 1, previousState: 0 });
  scope.$digest();

  engineLuaCallbacks.splice(0, engineLuaCallbacks.length);
  bngApiCalls.splice(0, bngApiCalls.length);

  const loadCallsBefore = bngApiCalls.filter(function (command) {
    return command === 'extensions.load("freeroam_vehiclePartsPainting")';
  }).length;

  scope.$$emit('WorldReadyStateChanged', { state: 1 });
  scope.$digest();

  assert.strictEqual(hooks.getLastWorldReadyState(), 1,
    'Forced world ready handler should update the tracked state value');

  const loadCallsAfter = bngApiCalls.filter(function (command) {
    return command === 'extensions.load("freeroam_vehiclePartsPainting")';
  }).length;
  assert.strictEqual(loadCallsAfter, loadCallsBefore + 1,
    'Forced world ready events should reload the freeroam extension');

  const queueSnapshot = hooks.getExtensionQueueSnapshot();
  assert(queueSnapshot.length >= 2,
    'Forced world ready events should queue refresh commands for the extension');

  assert.strictEqual(hooks.hasAvailabilityCheckInFlight(), true,
    'Forced world ready events should restart the extension availability probe');
})();

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
    createPart('vehicle/door', 'body/door', basePaints),
    createPart('vehicle/front_bumper', 'body/front_bumper', basePaints, {
      displayName: 'Front Bumper',
      slotLabel: 'Front Bumper'
    }),
    createPart('vehicle/rear_bumper', 'body/rear_bumper', basePaints, {
      displayName: 'Rear Bumper',
      slotLabel: 'Rear Bumper'
    }),
    createPart('vehicle/steering_wheel', 'interior/steering_wheel', basePaints, {
      displayName: 'Steering Wheel',
      slotLabel: 'Steering Wheel'
    })
  ];

  emitState(scope, {
    vehicleId: 4242,
    basePaints: basePaints,
    parts: parts
  });

  const state = scope.state;
  assert(state.filteredTree.length >= 1, 'Parts tree should contain root nodes after initialization');
  const nodesByPath = hooks.getTreeNodesByPath();
  assert(nodesByPath['vehicle/root'] && nodesByPath['vehicle/root'].length, 'Root node should be indexed');
  assert(nodesByPath['vehicle/hood'] && nodesByPath['vehicle/hood'].length, 'Hood node should be indexed');
  assert(nodesByPath['vehicle/door'] && nodesByPath['vehicle/door'].length, 'Door node should be indexed');
  assert(nodesByPath['vehicle/steering_wheel'] && nodesByPath['vehicle/steering_wheel'].length, 'Steering wheel node should be indexed');

  const initialTreeSnapshot = JSON.stringify(state.filteredTree);
  assert.strictEqual(state.filteringActive, false, 'Filtering should be inactive by default');
  assert(Array.isArray(state.filterResults) && state.filterResults.length === 0, 'Initial filter results should be empty');
  assert.strictEqual(typeof scope.areTreeControlsDisabled, 'function', 'Tree control helper should be exposed on scope');
  assert.strictEqual(scope.areTreeControlsDisabled(), false, 'Tree controls should start enabled before filtering');

  scope.state.filterText = 'b';
  scope.$digest();

  let expectedMatches = scope.state.parts.filter(function (part) { return partMatchesQuery(part, 'b'); });
  assert.strictEqual(state.filteringActive, true, 'Typing a single letter should activate filtering');
  assert.strictEqual(expectedMatches.length, 5, 'Single-letter search should find five matching parts for b');
  assert.strictEqual(state.filteredParts.length, expectedMatches.length, 'Single-letter search should include expected matches');
  assert.strictEqual(state.filterResults.length, expectedMatches.length, 'Filtered list should mirror filtered parts count');
  assert.strictEqual(scope.areTreeControlsDisabled(), true, 'Tree controls should disable while filtering is active');

  const rootFilteredEntry = state.filterResults.find(function (entry) { return entry.part.partPath === 'vehicle/root'; });
  assert(rootFilteredEntry && rootFilteredEntry.slotSegments.some(function (segment) {
    return segment.match && segment.text.toLowerCase() === 'b';
  }), 'Body slot entry should highlight the matching letter when filtering by b');
  assert(rootFilteredEntry && Array.isArray(rootFilteredEntry.slotWordSegments),
    'Body slot entry should expose grouped slot segments');
  const rootSlotWordTexts = rootFilteredEntry ? rootFilteredEntry.slotWordSegments.map(collectWordText) : [];
  const normalizedRootSlotLabel = getNormalizedSlotLabel(rootFilteredEntry ? rootFilteredEntry.part : null);
  if (normalizedRootSlotLabel) {
    assert.strictEqual(rootSlotWordTexts.join(' '), normalizedRootSlotLabel,
      'Grouped slot segments should reconstruct the normalized slot label');
  } else {
    assert.strictEqual(rootSlotWordTexts.length, 0,
      'Grouped slot segments should be empty when no slot label is present');
  }

  const frontBumperEntry = state.filterResults.find(function (entry) { return entry.part.partPath === 'vehicle/front_bumper'; });
  assert(frontBumperEntry && frontBumperEntry.nameSegments.some(function (segment) {
    return segment.match && segment.text.toLowerCase() === 'b';
  }), 'Bumper name should highlight the matching letter in filtered results');

  let bumperLastWord = '';
  let bumperSlotLastWord = '';

  scope.state.filterText = 'bumper';
  scope.$digest();

  expectedMatches = scope.state.parts.filter(function (part) { return partMatchesQuery(part, 'bumper'); });
  assert.strictEqual(expectedMatches.length, 2, 'Bumper search should return two matching parts');
  assert.strictEqual(state.filteredParts.length, expectedMatches.length, 'Bumper search results should match expected count');
  assert.strictEqual(state.filterResults.length, expectedMatches.length, 'Filtered list should rebuild for bumper search');
  const bumperFullEntry = state.filterResults.find(function (entry) { return entry.part.partPath === 'vehicle/front_bumper'; });
  assert(bumperFullEntry && bumperFullEntry.nameSegments.some(function (segment) {
    return segment.match && segment.text.toLowerCase() === 'bumper';
  }), 'Full bumper query should highlight the entire search term in part names');
  assert(bumperFullEntry && Array.isArray(bumperFullEntry.nameWordSegments) && bumperFullEntry.nameWordSegments.length,
    'Filtered bumper entry should expose grouped name segments');
  const bumperWordTexts = bumperFullEntry.nameWordSegments.map(collectWordText);
  const normalizedBumperName = getNormalizedPartName(bumperFullEntry.part);
  assert.strictEqual(bumperWordTexts.join(' '), normalizedBumperName,
    'Grouped name segments should reconstruct the normalized part name');
  const bumperTerminalWord = bumperFullEntry.nameWordSegments[bumperFullEntry.nameWordSegments.length - 1];
  const bumperTerminalText = collectWordText(bumperTerminalWord);
  bumperLastWord = bumperTerminalText;
  assert(bumperTerminalWord.segments.some(function (segment) {
    return segment.match && segment.text.toLowerCase() === bumperTerminalText.toLowerCase();
  }), 'Full bumper query should highlight the last word within grouped segments');
  assert(bumperFullEntry && Array.isArray(bumperFullEntry.slotWordSegments) && bumperFullEntry.slotWordSegments.length,
    'Filtered bumper entry should expose grouped slot segments');
  const bumperSlotWordTexts = bumperFullEntry.slotWordSegments.map(collectWordText);
  const normalizedBumperSlotLabel = getNormalizedSlotLabel(bumperFullEntry.part);
  assert.strictEqual(bumperSlotWordTexts.join(' '), normalizedBumperSlotLabel,
    'Grouped slot segments should reconstruct the normalized slot label');
  const bumperSlotTerminalWord = bumperFullEntry.slotWordSegments[bumperFullEntry.slotWordSegments.length - 1];
  const bumperSlotTerminalText = collectWordText(bumperSlotTerminalWord);
  bumperSlotLastWord = bumperSlotTerminalText;
  assert(bumperSlotTerminalWord.segments.some(function (segment) {
    return segment.match && segment.text.toLowerCase() === bumperSlotTerminalText.toLowerCase();
  }), 'Full bumper query should highlight the last word within grouped slot segments');

  ['bumpe', 'bump', 'bum', 'bu', 'b', ''].forEach(function (term) {
    scope.state.filterText = term;
    scope.$digest();
    const expectedLength = term ? scope.state.parts.filter(function (part) { return partMatchesQuery(part, term); }).length : scope.state.parts.length;
    if (term) {
      assert.strictEqual(state.filteringActive, true, 'Partial query "' + term + '" should keep filtering active');
      assert.strictEqual(state.filterResults.length, expectedLength, 'Filtered list should refresh for "' + term + '"');
      assert.strictEqual(scope.areTreeControlsDisabled(), true, 'Tree controls should stay disabled during query "' + term + '"');
      if (term === 'bum' && bumperLastWord) {
        const bumperEntry = state.filterResults.find(function (entry) { return entry.part.partPath === 'vehicle/front_bumper'; });
        assert(bumperEntry && Array.isArray(bumperEntry.nameWordSegments) && bumperEntry.nameWordSegments.length,
          'Partial bumper query should preserve grouped word segments');
        const bumperWord = bumperEntry.nameWordSegments[bumperEntry.nameWordSegments.length - 1];
        const bumperWordText = collectWordText(bumperWord);
        assert.strictEqual(bumperWordText, bumperLastWord,
          'Partial bumper query should leave the final word intact without removing spacing');
        assert(bumperWord.segments.some(function (segment) {
          return segment.match && segment.text.toLowerCase() === term;
        }), 'Partial bumper query should highlight only the matching portion of the word');
        const remainder = bumperLastWord.length > term.length ? bumperLastWord.substring(term.length).toLowerCase() : '';
        if (remainder) {
          assert(bumperWord.segments.some(function (segment) {
            return !segment.match && segment.text.toLowerCase() === remainder;
          }), 'Partial bumper query should leave the remaining letters as non-highlighted segments');
        }
        if (bumperSlotLastWord) {
          assert(bumperEntry && Array.isArray(bumperEntry.slotWordSegments) && bumperEntry.slotWordSegments.length,
            'Partial bumper query should preserve grouped slot segments');
          const bumperSlotWord = bumperEntry.slotWordSegments[bumperEntry.slotWordSegments.length - 1];
          const bumperSlotWordText = collectWordText(bumperSlotWord);
          assert.strictEqual(bumperSlotWordText, bumperSlotLastWord,
            'Partial bumper query should leave the final slot word intact without removing spacing');
          assert(bumperSlotWord.segments.some(function (segment) {
            return segment.match && segment.text.toLowerCase() === term;
          }), 'Partial bumper query should highlight only the matching portion of the slot word');
          const slotRemainder = bumperSlotLastWord.length > term.length ?
            bumperSlotLastWord.substring(term.length).toLowerCase() : '';
          if (slotRemainder) {
            assert(bumperSlotWord.segments.some(function (segment) {
              return !segment.match && segment.text.toLowerCase() === slotRemainder;
            }), 'Partial bumper query should leave the remaining slot letters as non-highlighted segments');
          }
        }
      }
    } else {
      assert.strictEqual(state.filteringActive, false, 'Clearing the search should disable filtering');
      assert.strictEqual(state.filterResults.length, 0, 'Clearing the search should hide the filtered list');
      assert.strictEqual(state.filteredParts.length, scope.state.parts.length, 'Clearing the search should restore the full part list');
      assert.strictEqual(scope.areTreeControlsDisabled(), false, 'Tree controls should re-enable once the search is cleared');
    }
  });

  const treeAfterClear = JSON.stringify(state.filteredTree);
  assert.strictEqual(treeAfterClear, initialTreeSnapshot, 'Clearing the filter should leave the tree structure unchanged');
  assert(findNode(state.filteredTree, 'vehicle/front_bumper'), 'Filtered clearing should preserve bumper nodes in the tree');

  scope.state.filterText = 'steering wheel';
  scope.$digest();

  expectedMatches = scope.state.parts.filter(function (part) { return partMatchesQuery(part, 'steering wheel'); });
  assert.strictEqual(expectedMatches.length, 1, 'Steering wheel query should return exactly one part');
  assert.strictEqual(state.filteredParts.length, expectedMatches.length, 'Steering wheel search should update filtered parts');
  assert.strictEqual(state.filterResults.length, expectedMatches.length, 'Steering wheel results should populate the filtered list');
  const steeringEntry = state.filterResults.find(function (entry) { return entry.part.partPath === 'vehicle/steering_wheel'; });
  assert(steeringEntry && steeringEntry.nameSegments.some(function (segment) {
    return segment.match && segment.text.toLowerCase() === 'steering wheel';
  }), 'Steering wheel search should highlight the full query in the part name');
  assert(steeringEntry && Array.isArray(steeringEntry.nameWordSegments) && steeringEntry.nameWordSegments.length,
    'Steering wheel entry should expose grouped name word segments');
  const steeringWordTexts = steeringEntry.nameWordSegments.map(collectWordText);
  const normalizedSteeringName = getNormalizedPartName(steeringEntry.part);
  assert.strictEqual(steeringWordTexts.join(' '), normalizedSteeringName,
    'Steering wheel grouped segments should reconstruct the normalized part name without collapsing spacing');
  assert(steeringEntry && Array.isArray(steeringEntry.slotWordSegments) && steeringEntry.slotWordSegments.length,
    'Steering wheel entry should expose grouped slot segments');
  const steeringSlotTexts = steeringEntry.slotWordSegments.map(collectWordText);
  const normalizedSteeringSlot = getNormalizedSlotLabel(steeringEntry.part);
  assert.strictEqual(steeringSlotTexts.join(' '), normalizedSteeringSlot,
    'Steering wheel grouped slot segments should reconstruct the normalized slot label without collapsing spacing');

  scope.state.filterText = 'vehicle/rear_bumper';
  scope.$digest();

  expectedMatches = scope.state.parts.filter(function (part) { return partMatchesQuery(part, 'vehicle/rear_bumper'); });
  assert.strictEqual(expectedMatches.length, 1, 'Identifier query should isolate the matching bumper');
  assert.strictEqual(state.filteredParts.length, expectedMatches.length, 'Identifier search should update filtered parts list');
  assert.strictEqual(state.filterResults.length, expectedMatches.length, 'Identifier search should render filtered results');
  const rearBumperEntry = state.filterResults.find(function (entry) { return entry.part.partPath === 'vehicle/rear_bumper'; });
  assert(rearBumperEntry && rearBumperEntry.identifierSegments.some(function (segment) {
    return segment.match && segment.text.toLowerCase() === 'vehicle/rear_bumper';
  }), 'Identifier search should highlight matching portion of the identifier');

  scope.state.filterText = '';
  scope.$digest();
  assert.strictEqual(state.filteringActive, false, 'Clearing identifier filter should restore tree view');
  assert.strictEqual(state.filterResults.length, 0, 'Clearing identifier filter should clear filtered list data');
  assert.strictEqual(state.filteredParts.length, scope.state.parts.length, 'Clearing identifier filter should restore all parts');
  assert.strictEqual(scope.areTreeControlsDisabled(), false, 'Tree controls should enable after clearing identifier filter');
  const treeAfterIdentifierClear = JSON.stringify(state.filteredTree);
  assert.strictEqual(treeAfterIdentifierClear, initialTreeSnapshot, 'Tree should remain unchanged after identifier filtering');

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
  assert.strictEqual(scope.areTreeControlsDisabled(), false, 'Clearing filter helper should leave tree controls enabled');
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
  assert(lastCommand && lastCommand.startsWith('(function() local available = freeroam_vehiclePartsPainting ~= nil'), 'Base paint command should guard extension availability');
  assert(lastCommand && lastCommand.includes('freeroam_vehiclePartsPainting.setVehicleBasePaintsJson('), 'Base paint command should be queued');
  const updatedBasePaint = scope.state.basePaints[0];
  assert(Math.abs(updatedBasePaint.baseColor[1] - (128 / 255)) < 0.001, 'Base paint green channel should update');
  assert(Math.abs(updatedBasePaint.baseColor[2] - (64 / 255)) < 0.001, 'Base paint blue channel should update');
  doorNode = findNode(state.filteredTree, 'vehicle/door');
  const doorPaint = doorNode.part.currentPaints[0];
  assert(Math.abs(doorPaint.baseColor[1] - (128 / 255)) < 0.001, 'Door part should inherit updated base paint');
  assert(Math.abs(doorPaint.baseColor[2] - (64 / 255)) < 0.001, 'Door part should inherit updated base paint blue channel');
  assert(!scope.hasCustomBadge(doorNode.part), 'Door should remain without a custom badge after base paint change');
  const originalBasePaint = state.originalBasePaints[0];
  assert(originalBasePaint && Math.abs(originalBasePaint.baseColor[0] - 1) < 0.001, 'Original base paint should retain initial red channel');
  assert(Math.abs(originalBasePaint.baseColor[1]) < 0.001 && Math.abs(originalBasePaint.baseColor[2]) < 0.001, 'Original base paint should retain zero green and blue channels');

  const baseBeforePartApply = structuredClonePaints(scope.state.basePaints);
  applyCustomPaint(scope, 'vehicle/door', { g: 220 });
  const baseAfterPartApply = scope.state.basePaints[0];
  assert(Math.abs(baseAfterPartApply.baseColor[1] - baseBeforePartApply[0].baseColor[1]) < 0.001, 'Part repaint should not alter stored base paint green channel');
  assert(Math.abs(baseAfterPartApply.baseColor[2] - baseBeforePartApply[0].baseColor[2]) < 0.001, 'Part repaint should not alter stored base paint blue channel');
  assert(Math.abs(state.originalBasePaints[0].baseColor[0] - 1) < 0.001, 'Original base paint should remain tracked after part repaint');

  scope.resetBasePaintEditors();
  scope.$digest();
  assert(scope.basePaintEditors[0].color.r === 255 && scope.basePaintEditors[0].color.g === 0 && scope.basePaintEditors[0].color.b === 0, 'Reset base editors should revert to original vehicle color');
  assert(scope.hasBasePaintChanges(), 'Resetting base editors should mark base paints as changed');
  scope.applyBasePaints();
  scope.$digest();
  const restoredBasePaint = scope.state.basePaints[0];
  assert(Math.abs(restoredBasePaint.baseColor[0] - 1) < 0.001, 'Applying reset base should restore original red channel');
  assert(Math.abs(restoredBasePaint.baseColor[1]) < 0.001 && Math.abs(restoredBasePaint.baseColor[2]) < 0.001, 'Applying reset base should clear green and blue channels');
  assert(Math.abs(state.originalBasePaints[0].baseColor[0] - 1) < 0.001, 'Original base paint should remain unchanged after reset apply');
  assert(!scope.hasBasePaintChanges(), 'Base paint change state should clear after resetting to original colors');
  scope.basePaintEditors[0].color.g = 128;
  scope.basePaintEditors[0].color.b = 64;
  scope.$digest();
  scope.applyBasePaints();
  scope.$digest();

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
  assert(deleteCommand && deleteCommand.startsWith('(function() local available = freeroam_vehiclePartsPainting ~= nil'), 'Delete command should guard extension availability');
  assert(deleteCommand && deleteCommand.includes("freeroam_vehiclePartsPainting.deleteSavedConfiguration('vehicles/example/config_a.pc')"), 'Delete command should include sanitized path');

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

  controller.setElementBoundingRect({ left: 1200, width: 400 });
  scope.minimizeApp();
  scope.$digest();
  assert.strictEqual(state.minimized, true, 'Minimize action should set minimized state flag');
  assert.strictEqual(state.minimizedAlignment, 'right', 'Widgets on the right half should align the minimized icon to the right');
  assert(state.minimizedInlineStyle && state.minimizedInlineStyle.transform === 'translateX(352px)', 'Right aligned minimize should translate by the width difference');
  scope.restoreApp();
  scope.$digest();
  assert.strictEqual(state.minimized, false, 'Restore action should clear minimized state flag');
  assert.deepStrictEqual(state.minimizedInlineStyle, {}, 'Restore action should remove minimized inline transform');
  assert.strictEqual(state.minimizedAlignment, 'left', 'Restore action should reset minimized alignment state');

  controller.setElementBoundingRect({ left: 300, width: 400 });
  scope.minimizeApp();
  scope.$digest();
  assert.strictEqual(state.minimizedAlignment, 'left', 'Widgets on the left half should keep minimized alignment on the left');
  assert.deepStrictEqual(state.minimizedInlineStyle, {}, 'Left aligned minimize should not apply an inline transform');
  scope.restoreApp();
  scope.$digest();

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

  const minimizedStorageKey = 'vehiclePartsPainting.minimizedState';
  const minimizedSessionStorage = createSessionStorageStub();
  const minimizedController = instantiateController({ sessionStorage: minimizedSessionStorage });
  const minimizedScope = minimizedController.scope;
  minimizedController.setElementBoundingRect({ left: 1200, width: 400 });
  minimizedScope.minimizeApp();
  minimizedScope.$digest();

  const persistedMinimizedRaw = minimizedSessionStorage.getItem(minimizedStorageKey);
  assert(persistedMinimizedRaw, 'Minimize action should persist minimized state in session storage');

  let persistedMinimizedState = null;
  try {
    persistedMinimizedState = JSON.parse(persistedMinimizedRaw);
  } catch (err) {
    assert.fail('Persisted minimized state should parse as JSON: ' + err.message);
  }

  assert(persistedMinimizedState && typeof persistedMinimizedState === 'object', 'Persisted minimized state should be an object');
  assert.strictEqual(persistedMinimizedState.minimized, true, 'Persisted minimized state should mark minimized flag');
  assert.strictEqual(persistedMinimizedState.alignment, 'right', 'Persisted minimized state should retain minimized alignment');
  assert.strictEqual(persistedMinimizedState.offset, 352, 'Persisted minimized state should store the minimized translate offset');

  const restoredMinimizedController = instantiateController({ sessionStorage: minimizedSessionStorage });
  const restoredMinimizedScope = restoredMinimizedController.scope;
  const restoredMinimizedState = restoredMinimizedScope.state;
  assert.strictEqual(restoredMinimizedState.minimized, true, 'Controller should restore minimized flag from persisted session storage');
  assert.strictEqual(restoredMinimizedState.minimizedAlignment, 'right', 'Controller should restore minimized alignment from persisted session storage');
  assert(restoredMinimizedState.minimizedInlineStyle && restoredMinimizedState.minimizedInlineStyle.transform === 'translateX(352px)', 'Controller should restore minimized inline transform from persisted session storage');

  restoredMinimizedScope.restoreApp();
  restoredMinimizedScope.$digest();
  assert.strictEqual(minimizedSessionStorage.getItem(minimizedStorageKey), null, 'Restoring the widget should clear persisted minimized state');

  console.log('All vehicle parts painting tests passed.');
})();
