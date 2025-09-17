-- This Source Code Form is subject to the terms of the bCDDL, v. 1.1.
-- If a copy of the bCDDL was not distributed with this
-- file, You can obtain one at http://beamng.com/bCDDL-1.1.txt

local M = {}

local logTag = 'vehiclePartsPaintingTopBar'
local itemId = 'vehiclePartsPainting'

local itemDefinition = {
  id = itemId,
  label = 'vehiclePartsPainting.topbarLabel',
  icon = 'engine',
  targetState = 'menu.vehiclePartsPainting',
  substate = 'menu.vehiclePartsPainting',
  order = 250,
  flags = {
    'inGameOnly',
    'noMission',
    'noScenario',
    'noGarage'
  }
}

local registered = false

local function deepCopy(value)
  if type(value) ~= 'table' then
    return value
  end
  local copy = {}
  for k, v in pairs(value) do
    copy[deepCopy(k)] = deepCopy(v)
  end
  return copy
end

local function getExtensionsTable()
  local globalEnv = _G
  if type(globalEnv) ~= 'table' then
    return nil
  end
  local manager = rawget(globalEnv, 'extensions')
  if type(manager) ~= 'table' then
    return nil
  end
  return manager
end

local function getTopBarExtension()
  local manager = getExtensionsTable()
  if not manager then
    return nil
  end
  local extension = rawget(manager, 'ui_topBar')
  if type(extension) ~= 'table' then
    return nil
  end
  return extension
end

local function safeCall(topBar, method, ...)
  if not topBar then
    return false
  end
  local fn = topBar[method]
  if type(fn) ~= 'function' then
    return false
  end
  local ok, result = pcall(fn, topBar, ...)
  if not ok then
    log('W', logTag, string.format('ui_topBar.%s failed: %s', tostring(method), tostring(result)))
    return false
  end
  return true, result
end

local function ensureItem(entries)
  if type(entries) ~= 'table' then
    entries = {}
  end
  if entries[itemId] then
    return entries
  end
  entries[itemId] = deepCopy(itemDefinition)
  return entries
end

local function triggerEntriesChanged(entries, skipEnsure)
  if type(guihooks) ~= 'table' or type(guihooks.trigger) ~= 'function' then
    return
  end
  local payload = deepCopy(entries or {})
  if not skipEnsure then
    payload = ensureItem(payload)
  end
  guihooks.trigger('ui_topBar_entriesChanged', payload)
end

local function triggerVisibleItems()
  if type(guihooks) ~= 'table' or type(guihooks.trigger) ~= 'function' then
    return
  end
  guihooks.trigger('ui_topBar_visibleItemsChanged', {})
end

local function tryRegisterThroughApi()
  local topBar = getTopBarExtension()
  if not topBar then
    return false
  end

  local ok, entries = safeCall(topBar, 'getEntries')
  if ok and type(entries) == 'table' then
    entries = ensureItem(entries)
    if safeCall(topBar, 'setEntries', entries) then
      return true
    end
  end

  ok, entries = safeCall(topBar, 'getItems')
  if ok and type(entries) == 'table' then
    entries = ensureItem(entries)
    if safeCall(topBar, 'setItems', entries) then
      return true
    end
  end

  if safeCall(topBar, 'registerItem', deepCopy(itemDefinition)) then
    return true
  end
  if safeCall(topBar, 'addItem', deepCopy(itemDefinition)) then
    return true
  end
  if safeCall(topBar, 'appendItem', deepCopy(itemDefinition)) then
    return true
  end

  return false
end

local function refreshEntriesFromTopBar()
  local topBar = getTopBarExtension()
  if not topBar then
    return false
  end

  local ok, entries = safeCall(topBar, 'getEntries')
  if ok and type(entries) == 'table' then
    triggerEntriesChanged(entries)
    return true
  end

  ok, entries = safeCall(topBar, 'getItems')
  if ok and type(entries) == 'table' then
    triggerEntriesChanged(entries)
    return true
  end

  ok = safeCall(topBar, 'requestEntries')
  return ok
end

local function registerItem()
  if registered then
    return true
  end

  local success = tryRegisterThroughApi()
  if success then
    registered = true
    refreshEntriesFromTopBar()
    triggerVisibleItems()
    return true
  end

  -- Fallback: request entries and append our item through the UI bridge
  if refreshEntriesFromTopBar() then
    registered = true
    triggerVisibleItems()
    return true
  end

  registered = true
  triggerVisibleItems()
  log('W', logTag, 'Failed to request ui_topBar entries while registering vehiclePartsPainting button')
  return false
end

local function unregisterItem()
  if not registered then
    return
  end
  registered = false

  local topBar = getTopBarExtension()
  if topBar then
    local ok, entries = safeCall(topBar, 'getEntries')
    if ok and type(entries) == 'table' then
      entries[itemId] = nil
      if safeCall(topBar, 'setEntries', entries) then
        triggerEntriesChanged(entries)
        return
      end
    end
    ok, entries = safeCall(topBar, 'getItems')
    if ok and type(entries) == 'table' then
      entries[itemId] = nil
      if safeCall(topBar, 'setItems', entries) then
        triggerEntriesChanged(entries)
        return
      end
    end
    safeCall(topBar, 'unregisterItem', itemId)
    safeCall(topBar, 'removeItem', itemId)
    safeCall(topBar, 'requestEntries')
  end

  triggerVisibleItems()
end

local function onExtensionLoaded()
  registerItem()
end

local function onExtensionUnloaded()
  unregisterItem()
end

M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded

return M
