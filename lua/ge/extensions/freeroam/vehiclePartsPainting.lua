-- This Source Code Form is subject to the terms of the bCDDL, v. 1.1.
-- If a copy of the bCDDL was not distributed with this
-- file, You can obtain one at http://beamng.com/bCDDL-1.1.txt

local M = {}

local logTag = 'vehiclePartsPainting'

local vehManager = extensions.core_vehicle_manager
local jbeamIO = require('jbeam/io')

local storedPartPaintsByVeh = {}
local highlightedParts = {}
local highlightFadeAlpha = 0.18
local validPartPathsByVeh = {}
local partDescriptorsByVeh = {}
local activePartIdSetByVeh = {}
local ensuredPartConditionsByVeh = {}

local function ensureVehiclePartConditionInitialized(vehObj, vehId)
  if not vehObj or not vehObj.queueLuaCommand then return end
  local id = vehId or (vehObj.getID and vehObj:getID())
  if not id or id == -1 then return end
  if ensuredPartConditionsByVeh[id] then return end

  local ensureCmd = [=[if partCondition and partCondition.ensureConditionsInit then
  local ok, err = pcall(partCondition.ensureConditionsInit, 0, 1, 1)
  if not ok then
    log('W', 'vehiclePartsPainting', string.format('ensureConditionsInit failed during preflight for vehicle %s: %s', tostring(obj:getID()), tostring(err)))
  end
end]=]

  vehObj:queueLuaCommand(ensureCmd)
  ensuredPartConditionsByVeh[id] = true
end

local function findNodeByPartPath(node, targetPath)
  if not node or not targetPath then return nil end
  if node.partPath == targetPath or node.path == targetPath then
    return node
  end
  if node.children then
    for _, child in pairs(node.children) do
      local found = findNodeByPartPath(child, targetPath)
      if found then return found end
    end
  end
  return nil
end

local function resolvePartName(vehData, partPath)
  if not vehData or not vehData.config or not partPath then return nil end
  local node = findNodeByPartPath(vehData.config.partsTree, partPath)
  if node and node.chosenPartName and node.chosenPartName ~= '' then
    return node.chosenPartName
  end
  return nil
end

local function formatNumberLiteral(value)
  local num = tonumber(value) or 0
  if math.abs(num) < 1e-6 then num = 0 end
  return string.format('%.6f', num)
end

local function toLuaStringLiteral(value)
  if not value or value == '' then return 'nil' end
  return string.format('%q', value)
end

local function paintToLogString(paint)
  if type(paint) ~= 'table' then return 'nil' end
  local base = paint.baseColor or {}
  local summary = string.format(
    'rgba=(%.3f, %.3f, %.3f, %.3f) m=%.3f r=%.3f cc=%.3f ccr=%.3f',
    tonumber(base[1]) or 0,
    tonumber(base[2]) or 0,
    tonumber(base[3]) or 0,
    tonumber(base[4]) or 0,
    tonumber(paint.metallic) or 0,
    tonumber(paint.roughness) or 0,
    tonumber(paint.clearcoat) or 0,
    tonumber(paint.clearcoatRoughness) or 0
  )
  return summary
end

local function paintsToLogSummary(paints)
  if type(paints) ~= 'table' or tableIsEmpty(paints) then return '[]' end
  local segments = {}
  for i = 1, #paints do
    segments[#segments + 1] = paintToLogString(paints[i])
  end
  return '[' .. table.concat(segments, ' | ') .. ']'
end

local function identifiersToLogString(identifiers)
  if type(identifiers) ~= 'table' or tableIsEmpty(identifiers) then return '[]' end
  local parts = {}
  for i = 1, #identifiers do
    parts[#parts + 1] = tostring(identifiers[i])
  end
  return '[' .. table.concat(parts, ', ') .. ']'
end

local function paintsToLuaLiteral(paints)
  if type(paints) ~= 'table' or tableIsEmpty(paints) then
    return '{ {baseColor={1.000000,1.000000,1.000000,1.000000},metallic=0.000000,roughness=0.500000,clearcoat=0.000000,clearcoatRoughness=0.000000} }'
  end
  local segments = {}
  for i = 1, #paints do
    local paint = paints[i] or {}
    local base = paint.baseColor or {}
    segments[#segments + 1] = string.format(
      '{baseColor={%s,%s,%s,%s},metallic=%s,roughness=%s,clearcoat=%s,clearcoatRoughness=%s}',
      formatNumberLiteral(base[1] or 0),
      formatNumberLiteral(base[2] or 0),
      formatNumberLiteral(base[3] or 0),
      formatNumberLiteral(base[4] or 1),
      formatNumberLiteral(paint.metallic or 0),
      formatNumberLiteral(paint.roughness or 0),
      formatNumberLiteral(paint.clearcoat or 0),
      formatNumberLiteral(paint.clearcoatRoughness or 0)
    )
  end
  return '{' .. table.concat(segments, ',') .. '}'
end

local function identifiersToLuaLiteral(identifiers)
  if type(identifiers) ~= 'table' or tableIsEmpty(identifiers) then return '{}' end
  local segments = {}
  for i = 1, #identifiers do
    local identifier = identifiers[i]
    if identifier and identifier ~= '' then
      segments[#segments + 1] = string.format('%q', identifier)
    end
  end
  if tableIsEmpty(segments) then return '{}' end
  return '{' .. table.concat(segments, ',') .. '}'
end

local function reorderIdentifiersWithPrimary(list, primary)
  if not primary or primary == '' then return list end
  local ordered = {primary}
  local seen = {[primary] = true}
  if type(list) == 'table' then
    for _, identifier in ipairs(list) do
      if identifier and identifier ~= '' and not seen[identifier] then
        seen[identifier] = true
        table.insert(ordered, identifier)
      end
    end
  end
  return ordered
end

local function queuePartPaintCommands(vehObj, vehId, partPath, partName, slotPath, identifiers, paints)
  if not vehObj or not paints then return end
  if tableIsEmpty(identifiers) then
    log('W', logTag, string.format('No identifier candidates available for part %s (name=%s, slot=%s); skipping paint command.', tostring(partPath), tostring(partName), tostring(slotPath)))
    return
  end

  local commandChunks = {
    'local identifiers = ', identifiersToLuaLiteral(identifiers), '\n',
    'local paints = ', paintsToLuaLiteral(paints), '\n',
    'local partPathValue = ', toLuaStringLiteral(partPath), '\n',
    'local partNameValue = ', toLuaStringLiteral(partName), '\n',
    'local slotPathValue = ', toLuaStringLiteral(slotPath), '\n',
    'local resultIdentifier = nil\n',
    'local lastError = nil\n',
    'local applied = false\n',
    'local ensureError = nil\n',
    [=[if partCondition then
  if partCondition.ensureConditionsInit then
    local ok, err = pcall(partCondition.ensureConditionsInit, 0, 1, 1)
    if not ok then
      ensureError = tostring(err)
      log('W', 'vehiclePartsPainting', string.format(
        'ensureConditionsInit failed for part=%s (name=%s slot=%s): %s',
        tostring(partPathValue),
        tostring(partNameValue),
        tostring(slotPathValue),
        ensureError
      ))
    end
  end

  if partCondition.setPartPaints then
    for _, identifier in ipairs(identifiers) do
      local ok, err = pcall(partCondition.setPartPaints, identifier, paints, 0)
      if ok then
        applied = true
        resultIdentifier = identifier
        break
      else
        resultIdentifier = identifier
        lastError = tostring(err)
        log('W', 'vehiclePartsPainting', string.format('Failed to set part paint for %s: %s', tostring(identifier), lastError))
      end
    end
  else
    lastError = 'partCondition.setPartPaints unavailable'
    log('E', 'vehiclePartsPainting', lastError)
  end
else
  lastError = 'partCondition module unavailable'
  log('E', 'vehiclePartsPainting', lastError)
end
if not applied and not lastError and ensureError then
  lastError = ensureError
end
if obj and obj.queueGameEngineLua then
  local vehId = obj:getID()
  local identifierLiteral = resultIdentifier and string.format('%q', resultIdentifier) or 'nil'
  local errorLiteral = lastError and string.format('%q', lastError) or 'nil'
  local function toLiteral(value)
    if value == nil then
      return 'nil'
    end
    return string.format('%q', value)
  end
  local cmd = string.format('extensions.hook("onVehiclePartsPaintingResult", %s, %s, %s, %s, %s, %s, %s)',
    tostring(vehId),
    toLiteral(partPathValue),
    toLiteral(partNameValue),
    toLiteral(slotPathValue),
    tostring(applied),
    identifierLiteral,
    errorLiteral)
  obj:queueGameEngineLua(cmd)
end
]=]
  }

  local command = table.concat(commandChunks)

  log('I', logTag, string.format(
    'Queueing paint command for vehicle %s part=%s (name=%s slot=%s); identifiers=%s paints=%s',
    tostring(vehId),
    tostring(partPath),
    tostring(partName),
    tostring(slotPath),
    identifiersToLogString(identifiers),
    paintsToLogSummary(paints)
  ))

  vehObj:queueLuaCommand(command)
end

local function collectPartIdentifierCandidates(partPath, partName, slotPath)
  local candidates = {}
  local seen = {}
  local function addCandidate(value)
    if type(value) ~= 'string' then return end
    if value == '' then return end
    if not seen[value] then
      seen[value] = true
      table.insert(candidates, value)
    end
  end

  addCandidate(partPath)
  if partName and partName ~= '' then
    addCandidate(partName)
    addCandidate('/' .. partName)
  end

  if slotPath and slotPath ~= '' then
    addCandidate(slotPath)
    local trimmedSlot = slotPath:gsub('/+$', '')
    if trimmedSlot ~= slotPath then
      addCandidate(trimmedSlot)
    end

    if partName and partName ~= '' then
      if slotPath:sub(-1) == '/' then
        addCandidate(slotPath .. partName)
        if trimmedSlot ~= slotPath and trimmedSlot ~= '' then
          addCandidate(trimmedSlot .. partName)
        end
      else
        addCandidate(slotPath .. '/' .. partName)
        addCandidate(slotPath .. partName)
      end

      if slotPath:sub(1, 1) ~= '/' then
        local prefixed = '/' .. slotPath
        addCandidate(prefixed)
        if prefixed:sub(-1) == '/' then
          addCandidate(prefixed .. partName)
        else
          addCandidate(prefixed .. '/' .. partName)
          addCandidate(prefixed .. partName)
        end
      end
    end
  end

  return candidates
end

local function resolvePartIdentifiers(partPath, partName, slotPath, activePartIds)
  local candidates = collectPartIdentifierCandidates(partPath, partName, slotPath)
  local candidateSet = {}
  for _, identifier in ipairs(candidates) do
    if identifier and identifier ~= '' then
      candidateSet[identifier] = true
    end
  end

  if activePartIds and not tableIsEmpty(activePartIds) then
    for partId in pairs(activePartIds) do
      if type(partId) == 'string' and partId ~= '' then
        local matches = false
        if partPath and partPath ~= '' then
          if partId == partPath or string.find(partId, partPath, 1, true) or string.find(partPath, partId, 1, true) then
            matches = true
          end
        end
        if not matches and partName and partName ~= '' then
          if partId == partName or string.find(partId, partName, 1, true) or string.find(partName, partId, 1, true) then
            matches = true
          end
        end
        if not matches and slotPath and slotPath ~= '' then
          if partId == slotPath or string.find(partId, slotPath, 1, true) or string.find(slotPath, partId, 1, true) then
            matches = true
          end
        end
        if matches and not candidateSet[partId] then
          candidateSet[partId] = true
          table.insert(candidates, partId)
        end
      end
    end
  end

  if tableIsEmpty(candidates) then
    if partPath and partPath ~= '' then
      return {partPath}
    end
    if partName and partName ~= '' then
      return {partName}
    end
    if slotPath and slotPath ~= '' then
      return {slotPath}
    end
    return {}
  end

  if not activePartIds or tableIsEmpty(activePartIds) then
    return candidates
  end

  local resolved = {}
  local fallbacks = {}
  local resolvedSeen = {}
  local fallbackSeen = {}
  for _, identifier in ipairs(candidates) do
    if activePartIds[identifier] then
      if not resolvedSeen[identifier] then
        resolvedSeen[identifier] = true
        table.insert(resolved, identifier)
      end
    else
      if not fallbackSeen[identifier] then
        fallbackSeen[identifier] = true
        table.insert(fallbacks, identifier)
      end
    end
  end

  if tableIsEmpty(resolved) then
    return fallbacks
  end

  for _, identifier in ipairs(fallbacks) do
    table.insert(resolved, identifier)
  end

  return resolved
end

local function resolvePartIdentifiersForVehicle(vehId, partPath, partName, slotPath)
  if not vehId then
    return resolvePartIdentifiers(partPath, partName, slotPath, nil)
  end

  partDescriptorsByVeh[vehId] = partDescriptorsByVeh[vehId] or {}
  local descriptors = partDescriptorsByVeh[vehId]
  local descriptor = descriptors[partPath]

  local activePartIds = activePartIdSetByVeh[vehId]

  if descriptor then
    descriptor.partName = partName or descriptor.partName
    descriptor.slotPath = slotPath or descriptor.slotPath
    descriptor.identifiers = resolvePartIdentifiers(descriptor.partPath or partPath, descriptor.partName, descriptor.slotPath, activePartIds)
    return descriptor.identifiers, descriptor
  end

  local identifiers = resolvePartIdentifiers(partPath, partName, slotPath, activePartIds)
  descriptors[partPath] = {
    partPath = partPath,
    partName = partName,
    slotPath = slotPath,
    identifiers = identifiers
  }
  return identifiers, descriptors[partPath]
end

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
      local previous = state[partPath]
      state[partPath] = {
        paints = copyPaints(sanitized),
        partName = previous and previous.partName or nil,
        slotPath = previous and previous.slotPath or nil,
        identifiers = previous and previous.identifiers or nil
      }
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
      if partDescriptorsByVeh[vehId] then
        partDescriptorsByVeh[vehId][partPath] = nil
        if tableIsEmpty(partDescriptorsByVeh[vehId]) then
          partDescriptorsByVeh[vehId] = nil
        end
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

local function gatherParts(node, result, availableParts, basePaints, validPaths, depth, vehId, descriptors, activePartIds)
  if not node then return end
  local slotPath = node.path or ''
  local partPath = node.partPath
  local chosenPartName = node.chosenPartName
  if (not partPath or partPath == '') and chosenPartName and chosenPartName ~= '' then
    if slotPath == '' then
      partPath = '/' .. chosenPartName
    else
      if slotPath:sub(-1) == '/' then
        partPath = slotPath .. chosenPartName
      else
        partPath = slotPath .. chosenPartName
      end
    end
  end

  if partPath and chosenPartName and chosenPartName ~= '' then
    validPaths[partPath] = true
    local info = availableParts[chosenPartName] or {}
    local displayName = info.description or info.name or chosenPartName
    local entry = {
      partPath = partPath,
      partName = chosenPartName,
      slotName = node.name or node.id,
      slotPath = slotPath,
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
    local descriptorIdentifiers
    if descriptors then
      descriptors[partPath] = descriptors[partPath] or {}
      local descriptor = descriptors[partPath]
      descriptor.partPath = partPath
      descriptor.partName = chosenPartName
      descriptor.slotPath = slotPath
      descriptor.identifiers = resolvePartIdentifiers(partPath, chosenPartName, slotPath, activePartIds)
      descriptorIdentifiers = descriptor.identifiers
    else
      descriptorIdentifiers = resolvePartIdentifiers(partPath, chosenPartName, slotPath, activePartIds)
    end
    local vehState = storedPartPaintsByVeh[vehId]
    if vehState and vehState[partPath] then
      vehState[partPath].partName = chosenPartName
      vehState[partPath].slotPath = slotPath
      vehState[partPath].identifiers = descriptorIdentifiers
    end
    table.insert(result, entry)
  end
  if node.children then
    local orderedChildren = {}
    for key, child in pairs(node.children) do
      table.insert(orderedChildren, {key = tostring(key), child = child})
    end
    table.sort(orderedChildren, function(a, b) return a.key < b.key end)
    for _, child in ipairs(orderedChildren) do
      gatherParts(child.child, result, availableParts, basePaints, validPaths, (depth or 0) + 1, vehId, descriptors, activePartIds)
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

  ensureVehiclePartConditionInitialized(vehObj, vehId)

  syncStateWithConfig(vehId, vehData)

  local basePaints = getVehicleBasePaints(vehData, vehObj)
  local availableParts = jbeamIO.getAvailableParts(vehData.ioCtx) or {}
  local parts = {}
  local validPaths = {}
  local activePartIds = nil
  if vehData.vdata and type(vehData.vdata.activeParts) == 'table' then
    activePartIds = {}
    for partId in pairs(vehData.vdata.activeParts) do
      activePartIds[partId] = true
    end
    if tableIsEmpty(activePartIds) then
      activePartIds = nil
    end
  end

  local descriptors = {}
  gatherParts(vehData.config.partsTree, parts, availableParts, basePaints, validPaths, 0, vehId, descriptors, activePartIds)
  cleanupState(vehId, validPaths, vehData)

  if tableIsEmpty(validPaths) then
    validPartPathsByVeh[vehId] = nil
  else
    local highlightAll = {}
    for partPath in pairs(validPaths) do
      highlightAll[partPath] = true
    end
    validPartPathsByVeh[vehId] = highlightAll
  end

  if tableIsEmpty(descriptors) then
    partDescriptorsByVeh[vehId] = nil
  else
    partDescriptorsByVeh[vehId] = descriptors
  end

  if activePartIds and not tableIsEmpty(activePartIds) then
    activePartIdSetByVeh[vehId] = activePartIds
  else
    activePartIdSetByVeh[vehId] = nil
  end

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
  ensureVehiclePartConditionInitialized(vehObj, vehId)
  syncStateWithConfig(vehId, vehData)
  local state = storedPartPaintsByVeh[vehId]
  if not state then return end
  for partPath, entry in pairs(state) do
    if entry and entry.paints then
      local resolvedName = entry.partName or resolvePartName(vehData, partPath)
      entry.partName = resolvedName
      local descriptorSlotPath = entry.slotPath
      local identifiers, descriptor = resolvePartIdentifiersForVehicle(vehId, partPath, resolvedName, descriptorSlotPath)
      if tableIsEmpty(identifiers) then
        identifiers = {}
        if partPath and partPath ~= '' then
          table.insert(identifiers, partPath)
        end
        if resolvedName and resolvedName ~= '' and resolvedName ~= partPath then
          table.insert(identifiers, resolvedName)
        end
      end

      local slotForCommand = descriptor and descriptor.slotPath or descriptorSlotPath
      queuePartPaintCommands(vehObj, vehId, partPath, resolvedName, slotForCommand, identifiers, entry.paints)

      local identifierCopy = {}
      for i = 1, #identifiers do
        identifierCopy[i] = identifiers[i]
      end
      entry.identifiers = identifierCopy
      entry.slotPath = descriptor and descriptor.slotPath or descriptorSlotPath
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

local function setPartPaint(partPath, paints, partName, slotPath)
  if not partPath then return end
  local vehObj = getPlayerVehicle(0)
  if not vehObj then return end
  local vehId = vehObj:getID()
  local vehData = vehManager.getVehicleData(vehId)
  if not vehData then return end

  ensureVehiclePartConditionInitialized(vehObj, vehId)

  local sanitizedPaints = sanitizePaints(paints)
  if not sanitizedPaints then
    log('W', logTag, 'Invalid paint data received for part ' .. tostring(partPath))
    return
  end

  local resolvedName = partName
  if not resolvedName or resolvedName == '' then
    resolvedName = resolvePartName(vehData, partPath)
  end

  local descriptorSlotPath = slotPath
  if not descriptorSlotPath then
    local existingDescriptor = partDescriptorsByVeh[vehId] and partDescriptorsByVeh[vehId][partPath]
    if existingDescriptor and existingDescriptor.slotPath and existingDescriptor.slotPath ~= '' then
      descriptorSlotPath = existingDescriptor.slotPath
    else
      local existingState = storedPartPaintsByVeh[vehId] and storedPartPaintsByVeh[vehId][partPath]
      if existingState and existingState.slotPath and existingState.slotPath ~= '' then
        descriptorSlotPath = existingState.slotPath
      end
    end
  end

  local identifiers, descriptor = resolvePartIdentifiersForVehicle(vehId, partPath, resolvedName, descriptorSlotPath)
  if tableIsEmpty(identifiers) then
    identifiers = {}
    if partPath and partPath ~= '' then
      table.insert(identifiers, partPath)
    end
    if resolvedName and resolvedName ~= '' and resolvedName ~= partPath then
      table.insert(identifiers, resolvedName)
    end
  end

  local slotForCommand = descriptor and descriptor.slotPath or descriptorSlotPath
  local previousEntry = storedPartPaintsByVeh[vehId] and storedPartPaintsByVeh[vehId][partPath] or nil
  local previousPaints = previousEntry and previousEntry.paints or nil
  local previousSource = 'storedCustom'
  if not previousPaints then
    previousPaints = getVehicleBasePaints(vehData, vehObj)
    previousSource = 'vehicleBase'
  end

  log('I', logTag, string.format(
    'Applying custom paint to vehicle %s part=%s (name=%s slot=%s); previous[%s]=%s new=%s identifiers=%s',
    tostring(vehId),
    tostring(partPath),
    tostring(resolvedName),
    tostring(slotForCommand),
    previousSource,
    paintsToLogSummary(previousPaints),
    paintsToLogSummary(sanitizedPaints),
    identifiersToLogString(identifiers)
  ))

  queuePartPaintCommands(vehObj, vehId, partPath, resolvedName, slotForCommand, identifiers, sanitizedPaints)

  storedPartPaintsByVeh[vehId] = storedPartPaintsByVeh[vehId] or {}
  local identifierCopy = {}
  for i = 1, #identifiers do
    identifierCopy[i] = identifiers[i]
  end
  storedPartPaintsByVeh[vehId][partPath] = {
    paints = copyPaints(sanitizedPaints),
    partName = resolvedName,
    slotPath = slotForCommand,
    identifiers = identifierCopy
  }
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
  setPartPaint(data.partPath or data.path, data.paints, data.partName or data.name, data.slotPath or data.slot or data.slotName)
end

local function resetPartPaint(partPath)
  if not partPath then return end
  local vehObj = getPlayerVehicle(0)
  if not vehObj then return end
  local vehId = vehObj:getID()
  local vehData = vehManager.getVehicleData(vehId)
  if not vehData then return end

  ensureVehiclePartConditionInitialized(vehObj, vehId)

  local basePaints = getVehicleBasePaints(vehData, vehObj)
  local resolvedName
  local storedState = storedPartPaintsByVeh[vehId]
  if storedState and storedState[partPath] and storedState[partPath].partName then
    resolvedName = storedState[partPath].partName
  else
    resolvedName = resolvePartName(vehData, partPath)
  end

  local descriptorSlotPath = nil
  if storedState and storedState[partPath] and storedState[partPath].slotPath then
    descriptorSlotPath = storedState[partPath].slotPath
  end
  local existingDescriptor = partDescriptorsByVeh[vehId] and partDescriptorsByVeh[vehId][partPath]
  if existingDescriptor and existingDescriptor.slotPath and existingDescriptor.slotPath ~= '' then
    descriptorSlotPath = descriptorSlotPath or existingDescriptor.slotPath
  end

  local identifiers, descriptor = resolvePartIdentifiersForVehicle(vehId, partPath, resolvedName, descriptorSlotPath)
  if tableIsEmpty(identifiers) then
    identifiers = {}
    if partPath and partPath ~= '' then
      table.insert(identifiers, partPath)
    end
    if resolvedName and resolvedName ~= '' and resolvedName ~= partPath then
      table.insert(identifiers, resolvedName)
    end
  end

  local slotForCommand = descriptor and descriptor.slotPath or descriptorSlotPath
  local previousCustom = storedState and storedState[partPath] and storedState[partPath].paints or nil

  log('I', logTag, string.format(
    'Resetting paint on vehicle %s part=%s (name=%s slot=%s); previousCustom=%s base=%s identifiers=%s',
    tostring(vehId),
    tostring(partPath),
    tostring(resolvedName),
    tostring(slotForCommand),
    paintsToLogSummary(previousCustom),
    paintsToLogSummary(basePaints),
    identifiersToLogString(identifiers)
  ))

  queuePartPaintCommands(vehObj, vehId, partPath, resolvedName, slotForCommand, identifiers, basePaints)

  if storedPartPaintsByVeh[vehId] then
    storedPartPaintsByVeh[vehId][partPath] = nil
    if tableIsEmpty(storedPartPaintsByVeh[vehId]) then
      storedPartPaintsByVeh[vehId] = nil
    end
  end
  setConfigPaintsEntry(vehData, partPath, nil)

  sendState(vehId)
end

local function onVehiclePartsPaintingResult(vehId, partPath, partName, slotPath, success, identifier, errorMessage)
  if not vehId or vehId == -1 then return end
  local wasSuccessful = success and success ~= 'false'
  local identifierText = identifier and tostring(identifier) or 'nil'
  local slotText = slotPath and tostring(slotPath) or 'nil'
  if wasSuccessful then
    log('I', logTag, string.format(
      'Vehicle %s paint application succeeded for part=%s (name=%s slot=%s) using identifier=%s',
      tostring(vehId),
      tostring(partPath),
      tostring(partName),
      slotText,
      identifierText
    ))
  else
    log('W', logTag, string.format(
      'Vehicle %s paint application failed for part=%s (name=%s slot=%s); lastIdentifier=%s error=%s',
      tostring(vehId),
      tostring(partPath),
      tostring(partName),
      slotText,
      identifierText,
      tostring(errorMessage)
    ))
  end

  local state = storedPartPaintsByVeh[vehId]
  local resolvedPartPath = partPath
  local stateEntry = nil
  if state then
    if resolvedPartPath and state[resolvedPartPath] then
      stateEntry = state[resolvedPartPath]
    elseif partName then
      for key, entry in pairs(state) do
        if entry.partName == partName then
          stateEntry = entry
          resolvedPartPath = resolvedPartPath or key
          break
        end
      end
    end
  end

  if stateEntry then
    if slotPath and slotPath ~= '' then
      stateEntry.slotPath = slotPath
    end
    if partName and partName ~= '' then
      stateEntry.partName = partName
    end
    if identifier and identifier ~= '' then
      if wasSuccessful then
        stateEntry.identifiers = reorderIdentifiersWithPrimary(stateEntry.identifiers, identifier)
      else
        stateEntry.identifiers = stateEntry.identifiers or {}
        local seen = {}
        for _, value in ipairs(stateEntry.identifiers) do
          seen[value] = true
        end
        if not seen[identifier] then
          table.insert(stateEntry.identifiers, identifier)
        end
      end
    end
  end

  local descriptors = partDescriptorsByVeh[vehId]
  local descriptorEntry = nil
  if descriptors then
    if resolvedPartPath and descriptors[resolvedPartPath] then
      descriptorEntry = descriptors[resolvedPartPath]
    elseif partName then
      for key, entry in pairs(descriptors) do
        if entry.partName == partName then
          descriptorEntry = entry
          resolvedPartPath = resolvedPartPath or key
          break
        end
      end
    end
  end

  if descriptorEntry then
    if slotPath and slotPath ~= '' then
      descriptorEntry.slotPath = slotPath
    end
    if partName and partName ~= '' then
      descriptorEntry.partName = partName
    end
    if identifier and identifier ~= '' then
      if wasSuccessful then
        descriptorEntry.identifiers = reorderIdentifiersWithPrimary(descriptorEntry.identifiers, identifier)
      else
        descriptorEntry.identifiers = descriptorEntry.identifiers or {}
        local seen = {}
        for _, value in ipairs(descriptorEntry.identifiers) do
          seen[value] = true
        end
        if not seen[identifier] then
          table.insert(descriptorEntry.identifiers, identifier)
        end
      end
    end
  end
end

local function applyPartTransparency(vehId, partPath)
  if not vehId or vehId == -1 then return end

  local vehObj = getObjectByID(vehId)
  if not vehObj then return end

  if not partPath or partPath == '' then
    vehObj:setMeshAlpha(1, "", false)
    return
  end

  vehObj:setMeshAlpha(highlightFadeAlpha, "", false)

  local descriptors = partDescriptorsByVeh[vehId]
  local descriptor = descriptors and descriptors[partPath]
  local slotPath = descriptor and descriptor.slotPath or nil
  local partName = descriptor and descriptor.partName or nil

  if not partName then
    local vehData = vehManager.getVehicleData(vehId)
    partName = resolvePartName(vehData, partPath)
  end

  local identifiers = descriptor and descriptor.identifiers
  if not identifiers or tableIsEmpty(identifiers) then
    identifiers = resolvePartIdentifiersForVehicle(vehId, partPath, partName, slotPath)
    if descriptor then
      descriptor.identifiers = identifiers
    end
  end

  local restored = false
  if identifiers and not tableIsEmpty(identifiers) then
    for _, identifier in ipairs(identifiers) do
      if identifier and identifier ~= '' then
        vehObj:setMeshAlpha(1, identifier, false)
        restored = true
      end
    end
  end

  if not restored then
    vehObj:setMeshAlpha(1, "", false)
  end
end

local function showAllParts(targetVehId)
  local vehId = targetVehId or be:getPlayerVehicleID(0)
  if not vehId or vehId == -1 then return end

  local vehObj = getObjectByID(vehId)
  local vehData = vehManager.getVehicleData(vehId)
  if not vehObj or not vehData then return end

  local highlight = validPartPathsByVeh[vehId]
  if not highlight or tableIsEmpty(highlight) then
    local basePaints = getVehicleBasePaints(vehData, vehObj)
    local availableParts = jbeamIO.getAvailableParts(vehData.ioCtx) or {}
    local tmpParts = {}
    highlight = {}
    local activePartIds = nil
    if vehData.vdata and type(vehData.vdata.activeParts) == 'table' then
      activePartIds = {}
      for partId in pairs(vehData.vdata.activeParts) do
        activePartIds[partId] = true
      end
      if tableIsEmpty(activePartIds) then
        activePartIds = nil
      end
    end

    local descriptors = {}
    gatherParts(vehData.config.partsTree, tmpParts, availableParts, basePaints, highlight, 0, vehId, descriptors, activePartIds)
    if tableIsEmpty(highlight) then
      highlight = nil
      validPartPathsByVeh[vehId] = nil
    else
      validPartPathsByVeh[vehId] = highlight
    end

    if tableIsEmpty(descriptors) then
      partDescriptorsByVeh[vehId] = nil
    else
      partDescriptorsByVeh[vehId] = descriptors
    end

    if activePartIds and not tableIsEmpty(activePartIds) then
      activePartIdSetByVeh[vehId] = activePartIds
    else
      activePartIdSetByVeh[vehId] = nil
    end
  end

  highlightedParts = {}

  if highlight then
    extensions.core_vehicle_partmgmt.highlightParts(highlight)
    applyPartTransparency(vehId, nil)
  else
    vehObj:setMeshAlpha(1, "", false)
    vehObj:queueLuaCommand('bdebug.setPartsSelected({})')
  end
end

local function highlightPart(partPath)
  local parts = {}
  local vehId = be:getPlayerVehicleID(0)
  highlightedParts = {}
  if partPath and partPath ~= '' then
    parts[partPath] = true
    highlightedParts[partPath] = true
  end
  extensions.core_vehicle_partmgmt.highlightParts(parts)
  applyPartTransparency(vehId, partPath)
end

local function clearHighlight(targetVehId)
  showAllParts(targetVehId)
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
  validPartPathsByVeh[vehId] = nil
  partDescriptorsByVeh[vehId] = nil
  activePartIdSetByVeh[vehId] = nil
  ensuredPartConditionsByVeh[vehId] = nil
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
  validPartPathsByVeh = {}
  partDescriptorsByVeh = {}
  activePartIdSetByVeh = {}
  ensuredPartConditionsByVeh = {}
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
  validPartPathsByVeh = {}
  partDescriptorsByVeh = {}
  activePartIdSetByVeh = {}
  ensuredPartConditionsByVeh = {}
  clearHighlight()
end

M.requestState = requestState
M.applyPartPaintJson = applyPartPaintJson
M.setPartPaint = setPartPaint
M.resetPartPaint = resetPartPaint
M.highlightPart = highlightPart
M.showAllParts = showAllParts
M.clearHighlight = clearHighlight
M.onVehiclePartsPaintingResult = onVehiclePartsPaintingResult

M.onVehicleSpawned = onVehicleSpawned
M.onVehicleResetted = onVehicleResetted
M.onVehicleDestroyed = onVehicleDestroyed
M.onVehicleSwitched = onVehicleSwitched
M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded

return M
