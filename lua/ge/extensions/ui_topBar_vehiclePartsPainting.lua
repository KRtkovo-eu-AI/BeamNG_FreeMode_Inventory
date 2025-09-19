-- This Source Code Form is subject to the terms of the bCDDL, v. 1.1.
-- If a copy of the bCDDL was not distributed with this
-- file, You can obtain one at http://beamng.com/bCDDL-1.1.txt

local M = {}

local logTag = 'ui_topBar_vehiclePartsPainting'
local ITEM_ID = 'vehiclePartsPainting'
local TOPBAR_EXTENSION_NAME = 'ui_topBar'
local RETRY_INTERVAL = 0.5

local desiredItemDefinition = {
  id = ITEM_ID,
  label = 'vehiclePartsPainting.topbarLabel',
  icon = 'engine',
  targetState = 'menu.vehiclePartsPainting',
  substate = 'menu.appselect',
  order = 250,
  flags = {'inGameOnly', 'noMission', 'noScenario', 'noGarage'},
}

local retryTimer = 0
local isRegistered = false
local fallbackRegistered = false

local function deepCopy(value)
  if type(value) ~= 'table' then
    return value
  end

  local copy = {}
  for k, v in pairs(value) do
    copy[k] = deepCopy(v)
  end
  return copy
end

local function mergeItem(existing)
  local changed = false
  local desired = desiredItemDefinition
  if not existing then
    return deepCopy(desired), true
  end

  for key, value in pairs(desired) do
    if existing[key] ~= value then
      existing[key] = deepCopy(value)
      changed = true
    end
  end

  for key in pairs(existing) do
    if desired[key] == nil then
      existing[key] = nil
      changed = true
    end
  end

  return existing, changed
end

local function isArrayLike(tbl)
  if type(tbl) ~= 'table' then
    return false
  end

  local count = 0
  for key in pairs(tbl) do
    if type(key) ~= 'number' then
      return false
    end
    count = count + 1
  end

  if count == 0 then
    return false
  end

  for i = 1, count do
    if tbl[i] == nil then
      return false
    end
  end

  return true
end

local function ensureItemInTable(items)
  if type(items) ~= 'table' then
    return false, false
  end

  local existing = items[ITEM_ID]
  if existing ~= nil then
    local merged, changed = mergeItem(existing)
    items[ITEM_ID] = merged
    return true, changed
  end

  if isArrayLike(items) then
    for index, entry in ipairs(items) do
      if type(entry) == 'table' and entry.id == ITEM_ID then
        local merged, changed = mergeItem(entry)
        items[index] = merged
        return true, changed
      end
    end

    table.insert(items, deepCopy(desiredItemDefinition))
    return true, true
  end

  for key, entry in pairs(items) do
    if type(entry) == 'table' and entry.id == ITEM_ID then
      local merged, changed = mergeItem(entry)
      items[key] = merged
      return true, changed
    end
  end

  items[ITEM_ID] = deepCopy(desiredItemDefinition)
  return true, true
end

local function ensureItemInPayload(payload)
  if type(payload) ~= 'table' then
    return false, false
  end

  if type(payload.items) == 'table' then
    return ensureItemInTable(payload.items)
  end

  return ensureItemInTable(payload)
end

local function getExtensionsTable()
  local globalEnv = _G
  if type(globalEnv) ~= 'table' then
    return nil
  end
  local manager = rawget(globalEnv, 'extensions')
  return type(manager) == 'table' and manager or nil
end

local function getTopBarExtension()
  local manager = getExtensionsTable()
  if not manager then
    return nil
  end
  local extension = rawget(manager, TOPBAR_EXTENSION_NAME)
  if type(extension) ~= 'table' then
    return nil
  end
  return extension
end

local function safeCall(fn, ...)
  if type(fn) ~= 'function' then
    return false, 'function_unavailable'
  end
  local ok, result = pcall(fn, ...)
  if not ok then
    return false, tostring(result)
  end
  return true, result
end

local function ensureTopBarLoaded()
  local manager = getExtensionsTable()
  if not manager then
    return
  end

  local okLoaded, loaded = safeCall(manager.isExtensionLoaded, TOPBAR_EXTENSION_NAME)
  if okLoaded and loaded then
    return
  end

  safeCall(manager.load, TOPBAR_EXTENSION_NAME)
end

local function fetchItems(extension)
  if type(extension) ~= 'table' then
    return {}, nil
  end

  local candidates = {
    'getExternalItems',
    'getExternalEntries',
    'getItems',
    'getEntries',
    'getRegisteredItems',
  }

  for _, fnName in ipairs(candidates) do
    local fn = extension[fnName]
    local ok, result = safeCall(fn)
    if ok and type(result) == 'table' then
      return deepCopy(result), fnName
    end
  end

  local fieldCandidates = {'externalItems', 'externalEntries', 'items', 'entries'}
  for _, field in ipairs(fieldCandidates) do
    local value = rawget(extension, field)
    if type(value) == 'table' then
      return deepCopy(value), field
    end
  end

  return {}, nil
end

local function pushItems(extension, items)
  if type(extension) ~= 'table' then
    return false
  end

  local manager = getExtensionsTable()
  local setCandidates = {
    'setExternalItems',
    'setExternalEntries',
    'setItems',
    'setEntries',
    'registerExternalItems',
    'registerItems',
  }

  for _, fnName in ipairs(setCandidates) do
    local fn = extension[fnName]
    if type(fn) == 'function' then
      local ok = select(1, safeCall(fn, items))
      if ok then
        return true
      end
    end
  end

  local item = items[ITEM_ID]
  if item then
    local addCandidates = {
      'registerExternalItem',
      'registerExternalEntry',
      'registerItem',
      'registerEntry',
      'addExternalEntries',
      'addExternalItems',
      'addExternalItem',
      'addItem',
      'addEntries',
      'addEntry',
    }

    for _, fnName in ipairs(addCandidates) do
      local fn = extension[fnName]
      if type(fn) == 'function' then
        local ok = select(1, safeCall(fn, item))
        if ok then
          return true
        end
      end
    end
  end

  if manager and type(manager.call) == 'function' then
    local callCandidates = {
      'registerExternalItems',
      'registerExternalEntries',
      'registerItems',
      'registerEntries',
      'addExternalItems',
      'addExternalEntries',
      'addItems',
      'addEntries',
      'registerExternalItem',
      'registerExternalEntry',
      'addExternalItem',
      'addExternalEntry',
    }

    for _, fnName in ipairs(callCandidates) do
      local ok = select(1, safeCall(manager.call, manager, TOPBAR_EXTENSION_NAME, fnName, items))
      if ok then
        return true
      end

      if item then
        ok = select(1, safeCall(manager.call, manager, TOPBAR_EXTENSION_NAME, fnName, item))
        if ok then
          return true
        end
      end
    end
  end

  local fieldCandidates = {'externalItems', 'externalEntries', 'items', 'entries'}
  for _, field in ipairs(fieldCandidates) do
    local target = rawget(extension, field)
    if type(target) == 'table' then
      ensureItemInTable(target)
      return true
    end
  end

  return false
end

local function broadcastItems(extension, items)
  if type(extension) ~= 'table' then
    return false
  end

  local notifyCandidates = {
    'notifyEntriesChanged',
    'broadcastEntriesChanged',
    'sendEntriesChanged',
    'entriesChanged',
  }

  for _, fnName in ipairs(notifyCandidates) do
    local fn = extension[fnName]
    if type(fn) == 'function' then
      local ok = select(1, safeCall(fn, items))
      if ok then
        return true
      end
    end
  end

  if rawget(_G, 'guihooks') and type(guihooks.trigger) == 'function' then
    local ok = select(1, safeCall(guihooks.trigger, 'ui_topBar_entriesChanged', items))
    if ok then
      return true
    end
  end

  local manager = getExtensionsTable()
  if manager and type(manager.hook) == 'function' then
    safeCall(manager.hook, 'ui_topBar_entriesChanged', items)
  end

  return false
end

local function registerItem()
  ensureTopBarLoaded()
  local extension = getTopBarExtension()
  if not extension then
    return false
  end

  local items = fetchItems(extension)
  items = items or {}

  local _, changed = ensureItemInTable(items)

  if not changed and isRegistered then
    return true
  end

  local pushed = pushItems(extension, items)
  if not pushed then
    if not fallbackRegistered then
      log('I', logTag, 'Falling back to hook-based Vehicle Parts Painting top bar registration.')
      fallbackRegistered = true
    end
    broadcastItems(extension, items)
    isRegistered = true
    return true
  end

  broadcastItems(extension, items)
  isRegistered = true
  return true
end

local function unregisterItem()
  local extension = getTopBarExtension()
  if not extension then
    isRegistered = false
    return false
  end

  local items = fetchItems(extension)
  if not items or not items[ITEM_ID] then
    isRegistered = false
    return true
  end

  items[ITEM_ID] = nil
  local pushed = pushItems(extension, items)
  if pushed then
    broadcastItems(extension, items)
  end
  isRegistered = false
  return pushed
end

local function update(dt)
  retryTimer = retryTimer + math.max(0, dt or 0)
  if retryTimer < RETRY_INTERVAL then
    return
  end
  retryTimer = 0

  local extension = getTopBarExtension()
  if not extension then
    isRegistered = false
    ensureTopBarLoaded()
    return
  end

  if not isRegistered then
    local ok = registerItem()
    if not ok then
      isRegistered = false
    end
    return
  end

  local items = fetchItems(extension)
  if not items or not items[ITEM_ID] then
    isRegistered = false
  end
end

local function onTopBarPayload(payload)
  local injected = select(1, ensureItemInPayload(payload))
  if injected then
    isRegistered = true
  end
end

local function onTopBarItems(items)
  local injected = select(1, ensureItemInTable(items))
  if injected then
    isRegistered = true
  end
end

local function onExtensionLoaded()
  retryTimer = 0
  isRegistered = false
  fallbackRegistered = false
  ensureTopBarLoaded()
  registerItem()
end

local function onExtensionUnloaded()
  unregisterItem()
  retryTimer = 0
  isRegistered = false
  fallbackRegistered = false
end

local function onUpdate(dtReal, dtSim, dtRaw)
  update(dtReal)
end

local function onTopBarDataRequested(data)
  onTopBarPayload(data)
end

local function onTopBarEntriesChanged(items)
  onTopBarItems(items)
end

local function onTopBarCollectionRequested(entries)
  onTopBarItems(entries)
end

M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded
M.onUpdate = onUpdate
M.ui_topBar_dataRequested = onTopBarDataRequested
M.ui_topBar_entriesChanged = onTopBarEntriesChanged
M.ui_topBar_collectExternalEntries = onTopBarCollectionRequested
M.ui_topBar_collectExternalItems = onTopBarCollectionRequested
M.ui_topBar_collectEntries = onTopBarCollectionRequested
M.ui_topBar_collectItems = onTopBarCollectionRequested
M.ui_topBar_getExternalEntries = onTopBarCollectionRequested
M.ui_topBar_getExternalItems = onTopBarCollectionRequested
M.ui_topBar_getEntries = onTopBarCollectionRequested
M.ui_topBar_getItems = onTopBarCollectionRequested

return M
