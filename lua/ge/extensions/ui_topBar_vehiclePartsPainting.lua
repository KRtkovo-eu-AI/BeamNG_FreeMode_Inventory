-- This Source Code Form is subject to the terms of the bCDDL, v. 1.1.
-- If a copy of the bCDDL was not distributed with this
-- file, You can obtain one at http://beamng.com/bCDDL-1.1.txt

local M = {}

local ITEM_ID = 'vehiclePartsPainting'

local desiredItemDefinition = {
  id = ITEM_ID,
  label = 'vehiclePartsPainting.topbarLabel',
  icon = 'engine',
  targetState = 'menu.vehiclePartsPainting',
  substate = 'menu.vehiclePartsPainting',
  order = 250,
  flags = {'inGameOnly', 'noMission', 'noScenario', 'noGarage'},
}

local function deepCopy(value)
  if type(value) ~= 'table' then
    return value
  end

  local copy = {}
  for key, innerValue in pairs(value) do
    copy[key] = deepCopy(innerValue)
  end
  return copy
end

local function isArray(tbl)
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

  return count > 0
end

local function mergeItem(target)
  local changed = false

  for key, value in pairs(desiredItemDefinition) do
    local desiredValue = deepCopy(value)
    if target[key] ~= desiredValue then
      target[key] = desiredValue
      changed = true
    end
  end

  for key in pairs(target) do
    if desiredItemDefinition[key] == nil then
      target[key] = nil
      changed = true
    end
  end

  return changed
end

local function ensureItem(container)
  if type(container) ~= 'table' then
    return false
  end

  local existing = container[ITEM_ID]
  if type(existing) == 'table' then
    mergeItem(existing)
    return true
  end

  for key, entry in pairs(container) do
    if type(entry) == 'table' and entry.id == ITEM_ID then
      mergeItem(entry)
      if key ~= ITEM_ID and container[ITEM_ID] == nil then
        container[ITEM_ID] = entry
      end
      return true
    end
  end

  local newEntry = deepCopy(desiredItemDefinition)
  if container[ITEM_ID] == nil and not isArray(container) then
    container[ITEM_ID] = newEntry
  else
    table.insert(container, newEntry)
  end

  return true
end

local function ensurePayload(payload)
  if type(payload) ~= 'table' then
    return false
  end

  if type(payload.items) == 'table' then
    return ensureItem(payload.items)
  end

  return ensureItem(payload)
end

local function handleCollection(entries)
  ensureItem(entries)
end

local function handleData(payload)
  ensurePayload(payload)
end

local function handleItems(items)
  ensureItem(items)
end

function M.onExtensionLoaded()
  local manager = rawget(_G, 'extensions')
  if type(manager) ~= 'table' then
    return
  end

  local extension = rawget(manager, 'ui_topBar')
  if type(extension) ~= 'table' then
    return
  end

  local sources = {'externalItems', 'items'}
  for _, field in ipairs(sources) do
    local value = rawget(extension, field)
    if type(value) == 'table' then
      ensureItem(value)
    end
  end
end

function M.onExtensionUnloaded()
end

M.ui_topBar_dataRequested = handleData
M.ui_topBar_entriesChanged = handleItems
M.ui_topBar_collectExternalEntries = handleCollection
M.ui_topBar_collectExternalItems = handleCollection
M.ui_topBar_collectEntries = handleCollection
M.ui_topBar_collectItems = handleCollection
M.ui_topBar_getExternalEntries = handleCollection
M.ui_topBar_getExternalItems = handleCollection
M.ui_topBar_getEntries = handleCollection
M.ui_topBar_getItems = handleCollection

return M
