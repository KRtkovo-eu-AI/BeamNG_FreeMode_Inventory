-- This Source Code Form is subject to the terms of the bCDDL, v. 1.1.
-- If a copy of the bCDDL was not distributed with this
-- file, You can obtain one at http://beamng.com/bCDDL-1.1.txt

local M = {}

local logTag = 'vehiclePartsPainting'

local vehManager = extensions.core_vehicle_manager
local jbeamIO = require('jbeam/io')

local storedPartPaintsByVeh = {}
local highlightedParts = {}

local function clamp01(value)
  return clamp(tonumber(value) or 0, 0, 1)
end

local function copyPaint(paint)
  if type(paint) ~= 'table' then return nil end
  local base = paint.baseColor or {}
  return {
    baseColor = {base[1] or 1, base[2] or 1, base[3] or 1, base[4] or 1},
    metallic = paint.metallic or 0,
    roughness = paint.roughness or 0.5,
    clearcoat = paint.clearcoat or 0,
    clearcoatRoughness = paint.clearcoatRoughness or 0
  }
end

local function copyPaints(paints)
  local result = {}
  if type(paints) ~= 'table' then return result end
  for i = 1, #paints do
    if paints[i] then
      result[i] = copyPaint(paints[i])
    end
  end
  return result
end

local function sanitizePaint(paint)
  if type(paint) ~= 'table' then return nil end
  local sanitized = copyPaint(paint) or {}
  validateVehiclePaint(sanitized)
  local base = sanitized.baseColor or {}
  sanitized.baseColor = {
    clamp01(base[1]),
    clamp01(base[2]),
    clamp01(base[3]),
    clamp01(base[4] or 1)
  }
  sanitized.metallic = clamp01(sanitized.metallic)
  sanitized.roughness = clamp01(sanitized.roughness)
  sanitized.clearcoat = clamp01(sanitized.clearcoat)
  sanitized.clearcoatRoughness = clamp01(sanitized.clearcoatRoughness)
  return sanitized
end

local function sanitizePaints(paints)
  if type(paints) ~= 'table' then return nil end
  local sanitized = {}
  local lastPaint = nil
  for i = 1, 3 do
    local paint = paints[i] or lastPaint or paints[1]
    if not paint then break end
    local sanitizedPaint = sanitizePaint(paint)
    if not sanitizedPaint then break end
    sanitized[i] = sanitizedPaint
    lastPaint = paint
  end
  if tableIsEmpty(sanitized) then return nil end
  if not sanitized[2] then sanitized[2] = copyPaint(sanitized[1]) end
  if not sanitized[3] then sanitized[3] = copyPaint(sanitized[2] or sanitized[1]) end
  return sanitized
end

local function getVehicleBasePaints(vehData, vehObj)
  local basePaints = {}
  if vehData and vehData.config and type(vehData.config.paints) == 'table' then
    basePaints = copyPaints(vehData.config.paints)
  end
  if tableIsEmpty(basePaints) and vehObj then
    local colors = vehObj:getColorFTable()
    local count = tableSize(colors)
    for i = 1, count do
      local color = colors[i]
      local metallicPaintData = stringToTable(vehObj:getField('metallicPaintData', i - 1))
      local paint = createVehiclePaint({x = color.r, y = color.g, z = color.b, w = color.a}, metallicPaintData)
      validateVehiclePaint(paint)
      basePaints[i] = paint
    end
  end
  if tableIsEmpty(basePaints) then
    basePaints[1] = createVehiclePaint()
  end
  if not basePaints[2] then basePaints[2] = copyPaint(basePaints[1]) end
  if not basePaints[3] then basePaints[3] = copyPaint(basePaints[2]) end
  return basePaints
end

local function syncStateWithConfig(vehId, vehData)
  if not vehData or not vehData.config then return end
  local configPaints = vehData.config.customPartPaints
  if not configPaints then
    storedPartPaintsByVeh[vehId] = nil
    return
  end
  local state = storedPartPaintsByVeh[vehId] or {}
  for partPath, paints in pairs(configPaints) do
    local sanitized = sanitizePaints(paints)
    if sanitized then
      state[partPath] = {paints = copyPaints(sanitized)}
    end
  end
  for partPath in pairs(state) do
    if not configPaints[partPath] then
      state[partPath] = nil
    end
  end
  if tableIsEmpty(state) then
    storedPartPaintsByVeh[vehId] = nil
  else
    storedPartPaintsByVeh[vehId] = state
  end
end

local function cleanupState(vehId, validPaths, vehData)
  local state = storedPartPaintsByVeh[vehId]
  if not state then return end
  for partPath in pairs(state) do
    if not validPaths[partPath] then
      state[partPath] = nil
      if vehData and vehData.config and vehData.config.customPartPaints then
        vehData.config.customPartPaints[partPath] = nil
      end
    end
  end
  if vehData and vehData.config and vehData.config.customPartPaints and tableIsEmpty(vehData.config.customPartPaints) then
    vehData.config.customPartPaints = nil
  end
  if tableIsEmpty(state) then
    storedPartPaintsByVeh[vehId] = nil
  end
end

local function gatherParts(node, result, availableParts, basePaints, validPaths, depth, vehId)
  if not node then return end
  local partPath = node.partPath or node.path
  local chosenPartName = node.chosenPartName
  if partPath and chosenPartName and chosenPartName ~= '' then
    validPaths[partPath] = true
    local info = availableParts[chosenPartName] or {}
    local displayName = info.description or info.name or chosenPartName
    local entry = {
      partPath = partPath,
      partName = chosenPartName,
      slotName = node.name or node.id,
      depth = depth or 0,
      displayName = displayName,
      hasCustomPaint = false
    }
    local state = storedPartPaintsByVeh[vehId]
    local customEntry = state and state[partPath]
    local paints = customEntry and customEntry.paints or nil
    if not paints then
      paints = basePaints
    else
      entry.hasCustomPaint = true
    end
    entry.currentPaints = copyPaints(paints)
    table.insert(result, entry)
  end
  if node.children then
    local orderedChildren = {}
    for key, child in pairs(node.children) do
      table.insert(orderedChildren, {key = tostring(key), child = child})
    end
    table.sort(orderedChildren, function(a, b) return a.key < b.key end)
    for _, child in ipairs(orderedChildren) do
      gatherParts(child.child, result, availableParts, basePaints, validPaths, (depth or 0) + 1, vehId)
    end
  end
end

local function sendState(targetVehId)
  local vehId = targetVehId or be:getPlayerVehicleID(0)
  if not vehId or vehId == -1 then
    guihooks.trigger('VehiclePartsPaintingState', {vehicleId = false, parts = {}, basePaints = {}})
    return
  end
  local vehObj = getObjectByID(vehId)
  local vehData = vehManager.getVehicleData(vehId)
  if not vehObj or not vehData then
    guihooks.trigger('VehiclePartsPaintingState', {vehicleId = false, parts = {}, basePaints = {}})
    return
  end

  syncStateWithConfig(vehId, vehData)

  local basePaints = getVehicleBasePaints(vehData, vehObj)
  local availableParts = jbeamIO.getAvailableParts(vehData.ioCtx) or {}
  local parts = {}
  local validPaths = {}
  gatherParts(vehData.config.partsTree, parts, availableParts, basePaints, validPaths, 0, vehId)
  cleanupState(vehId, validPaths, vehData)

  table.sort(parts, function(a, b)
    if a.displayName == b.displayName then
      return tostring(a.partPath) < tostring(b.partPath)
    end
    return tostring(a.displayName) < tostring(b.displayName)
  end)

  local data = {
    vehicleId = vehId,
    parts = parts,
    basePaints = copyPaints(basePaints)
  }

  guihooks.trigger('VehiclePartsPaintingState', data)
end

local function applyStoredPaints(vehId)
  local vehObj = getObjectByID(vehId)
  local vehData = vehManager.getVehicleData(vehId)
  if not vehObj or not vehData then return end
  syncStateWithConfig(vehId, vehData)
  local state = storedPartPaintsByVeh[vehId]
  if not state then return end
  for partPath, entry in pairs(state) do
    if entry and entry.paints then
      local command = string.format('partCondition.setPartPaints(%s, %s, 0)', serialize(partPath), serialize(entry.paints))
      vehObj:queueLuaCommand(command)
    end
  end
end

local function setConfigPaintsEntry(vehData, partPath, paints)
  if not vehData or not vehData.config then return end
  vehData.config.customPartPaints = vehData.config.customPartPaints or {}
  if paints then
    vehData.config.customPartPaints[partPath] = copyPaints(paints)
  else
    vehData.config.customPartPaints[partPath] = nil
    if tableIsEmpty(vehData.config.customPartPaints) then
      vehData.config.customPartPaints = nil
    end
  end
end

local function setPartPaint(partPath, paints)
  if not partPath then return end
  local vehObj = getPlayerVehicle(0)
  if not vehObj then return end
  local vehId = vehObj:getID()
  local vehData = vehManager.getVehicleData(vehId)
  if not vehData then return end

  local sanitizedPaints = sanitizePaints(paints)
  if not sanitizedPaints then
    log('W', logTag, 'Invalid paint data received for part ' .. tostring(partPath))
    return
  end

  local command = string.format('partCondition.setPartPaints(%s, %s, 0)', serialize(partPath), serialize(sanitizedPaints))
  vehObj:queueLuaCommand(command)

  storedPartPaintsByVeh[vehId] = storedPartPaintsByVeh[vehId] or {}
  storedPartPaintsByVeh[vehId][partPath] = {paints = copyPaints(sanitizedPaints)}
  setConfigPaintsEntry(vehData, partPath, sanitizedPaints)

  sendState(vehId)
end

local function applyPartPaintJson(jsonStr)
  if type(jsonStr) ~= 'string' then return end
  local ok, data = pcall(jsonDecode, jsonStr)
  if not ok then
    log('E', logTag, 'Failed to decode paint JSON: ' .. tostring(data))
    return
  end
  setPartPaint(data.partPath or data.path, data.paints)
end

local function resetPartPaint(partPath)
  if not partPath then return end
  local vehObj = getPlayerVehicle(0)
  if not vehObj then return end
  local vehId = vehObj:getID()
  local vehData = vehManager.getVehicleData(vehId)
  if not vehData then return end

  local basePaints = getVehicleBasePaints(vehData, vehObj)
  local command = string.format('partCondition.setPartPaints(%s, %s, 0)', serialize(partPath), serialize(basePaints))
  vehObj:queueLuaCommand(command)

  if storedPartPaintsByVeh[vehId] then
    storedPartPaintsByVeh[vehId][partPath] = nil
    if tableIsEmpty(storedPartPaintsByVeh[vehId]) then
      storedPartPaintsByVeh[vehId] = nil
    end
  end
  setConfigPaintsEntry(vehData, partPath, nil)

  sendState(vehId)
end

local function highlightPart(partPath)
  local parts = {}
  if partPath and partPath ~= '' then
    parts[partPath] = true
    highlightedParts[partPath] = true
  else
    highlightedParts = {}
  end
  extensions.core_vehicle_partmgmt.highlightParts(parts)
end

local function clearHighlight()
  highlightedParts = {}
  extensions.core_vehicle_partmgmt.highlightParts({})
end

local function requestState()
  sendState()
end

local function onVehicleSpawned(vehId)
  applyStoredPaints(vehId)
  if vehId == be:getPlayerVehicleID(0) then
    sendState(vehId)
  end
end

local function onVehicleResetted(vehId)
  applyStoredPaints(vehId)
  if vehId == be:getPlayerVehicleID(0) then
    sendState(vehId)
  end
end

local function onVehicleDestroyed(vehId)
  storedPartPaintsByVeh[vehId] = nil
  if vehId == be:getPlayerVehicleID(0) then
    sendState(-1)
  end
end

local function onVehicleSwitched(oldId, newId, player)
  if not player then return end
  if newId and newId ~= -1 then
    applyStoredPaints(newId)
    sendState(newId)
  else
    sendState(-1)
  end
end

local function onExtensionLoaded()
  storedPartPaintsByVeh = {}
  local currentVeh = be:getPlayerVehicleID(0)
  if currentVeh and currentVeh ~= -1 then
    applyStoredPaints(currentVeh)
    sendState(currentVeh)
  else
    sendState(-1)
  end
end

local function onExtensionUnloaded()
  storedPartPaintsByVeh = {}
  clearHighlight()
end

M.requestState = requestState
M.applyPartPaintJson = applyPartPaintJson
M.setPartPaint = setPartPaint
M.resetPartPaint = resetPartPaint
M.highlightPart = highlightPart
M.clearHighlight = clearHighlight

M.onVehicleSpawned = onVehicleSpawned
M.onVehicleResetted = onVehicleResetted
M.onVehicleDestroyed = onVehicleDestroyed
M.onVehicleSwitched = onVehicleSwitched
M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded

return M
