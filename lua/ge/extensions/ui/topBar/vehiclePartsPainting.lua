-- This Source Code Form is subject to the terms of the bCDDL, v. 1.1.
-- If a copy of the bCDDL was not distributed with this
-- file, You can obtain one at http://beamng.com/bCDDL-1.1.txt

local M = {}

local logTag = 'ui/topBar/vehiclePartsPainting'
local ITEM_ID = 'vehiclePartsPainting'
local TOPBAR_EXTENSION_NAME = 'ui_topBar'
local RETRY_INTERVAL = 0.5

local desiredItemDefinition = {
  id = ITEM_ID,
  label = 'vehiclePartsPainting.topbarLabel',
  icon = 'engine',
  targetState = 'menu.vehiclePartsPainting',
  substate = 'menu.vehiclePartsPainting',
  order = 250,
  flags = {'inGameOnly', 'noMission', 'noScenario', 'noGarage'},
}

local retryTimer = 0
local isRegistered = false

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
      'registerItem',
      'addExternalItem',
      'addItem',
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

  local fieldCandidates = {'externalItems', 'externalEntries', 'items', 'entries'}
  for _, field in ipairs(fieldCandidates) do
    local target = rawget(extension, field)
    if type(target) == 'table' then
      target[ITEM_ID] = deepCopy(items[ITEM_ID])
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

local function registerItem()
  ensureTopBarLoaded()
  local extension = getTopBarExtension()
  if not extension then
    return false
  end

  local items = fetchItems(extension)
  items = items or {}

  local existing = items[ITEM_ID]
  local merged, changed = mergeItem(existing)
  items[ITEM_ID] = merged

  if not changed and isRegistered then
    return true
  end

  local pushed = pushItems(extension, items)
  if not pushed then
    log('W', logTag, 'Unable to inject Vehicle Parts Painting entry into top bar (no compatible registration method found).')
    return false
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

local function onExtensionLoaded()
  retryTimer = 0
  isRegistered = false
  ensureTopBarLoaded()
  registerItem()
end

local function onExtensionUnloaded()
  unregisterItem()
  retryTimer = 0
  isRegistered = false
end

local function onUpdate(dtReal, dtSim, dtRaw)
  update(dtReal)
end

M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded
M.onUpdate = onUpdate

return M
