-- This Source Code Form is subject to the terms of the bCDDL, v. 1.1.
-- If a copy of the bCDDL was not distributed with this
-- file, You can obtain one at http://beamng.com/bCDDL-1.1.txt

local M = {}

local logTag = 'vehiclePartsPainting'

local vehManager = extensions.core_vehicle_manager
local jbeamIO = require('jbeam/io')

local storedPartPaintsByVeh = {}
local basePaintStateByVeh = {}
local basePaintWorkaroundStateByVeh = {}
local highlightedParts = {}
local highlightFadeAlpha = 0.18
local validPartPathsByVeh = {}
local partDescriptorsByVeh = {}
local activePartIdSetByVeh = {}
local ensuredPartConditionsByVeh = {}
local savedConfigCacheByVeh = {}
local userColorPresets = nil
local lastKnownPlayerVehicleId = nil

local sanitizeColorPresetEntry
local previewImageExtensions = { '.png', '.jpg', '.jpeg', '.webp' }

local function createBasePaintWorkaroundState()
  return {
    phase = 'await_base',
    basePaints = nil,
    pendingPart = nil
  }
end

local function resetBasePaintWorkaroundState(vehId)
  if not vehId then return end
  basePaintWorkaroundStateByVeh[vehId] = createBasePaintWorkaroundState()
end

local function clearBasePaintWorkaroundState(vehId)
  if not vehId then return end
  basePaintWorkaroundStateByVeh[vehId] = nil
end

local function getBasePaintWorkaroundState(vehId, create)
  if not vehId then return nil end
  local state = basePaintWorkaroundStateByVeh[vehId]
  if not state and create then
    state = createBasePaintWorkaroundState()
    basePaintWorkaroundStateByVeh[vehId] = state
  end
  return state
end

local function isLikelyPlayerVehicleId(vehId)
  if not vehId or vehId == -1 then
    return false
  end
  if lastKnownPlayerVehicleId and vehId == lastKnownPlayerVehicleId then
    return true
  end
  local currentVeh = be:getPlayerVehicleID(0)
  return currentVeh and currentVeh ~= -1 and vehId == currentVeh
end

local function clampFraction01(value)
  return clamp(tonumber(value) or 0, 0, 1)
end

local function safePcall(fn, ...)
  if type(fn) ~= 'function' then
    return false, 'function_unavailable'
  end
  local ok, resultOrErr = pcall(fn, ...)
  if not ok then
    return false, tostring(resultOrErr)
  end
  return true, resultOrErr
end

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

local function getLoadedExtension(name)
  if type(name) ~= 'string' or name == '' then
    return nil
  end

  local globalEnv = _G
  if type(globalEnv) ~= 'table' then
    return nil
  end

  local manager = rawget(globalEnv, 'extensions')
  if type(manager) ~= 'table' then
    return nil
  end

  return rawget(manager, name)
end

local function sanitizeFileName(name)
  if not name or name == '' then
    return nil
  end
  local sanitized = name
  sanitized = sanitized:gsub('[<>:"/\\|%?%*]', '_')
  sanitized = sanitized:gsub('%s+', ' ')
  sanitized = sanitized:gsub('^%s+', '')
  sanitized = sanitized:gsub('%s+$', '')
  if sanitized == '' then
    return nil
  end
  return sanitized
end

local function sanitizeConfigDisplayName(name)
  if not name or name == '' then
    return nil
  end
  local trimmed = tostring(name):gsub('^%s+', ''):gsub('%s+$', '')
  if trimmed == '' then
    return nil
  end
  return trimmed
end

local function isSafePathSegment(segment)
  if not segment or segment == '' then
    return false
  end
  if segment:find('%.%.', 1, true) then
    return false
  end
  if segment:find('[\\/]', 1) then
    return false
  end
  return segment:match('^[%w%._%-]+$') ~= nil
end

local function getVehicleModelIdentifier(vehData, vehObj, vehId)
  if vehData then
    if vehData.jbeam and vehData.jbeam ~= '' then
      return vehData.jbeam
    end
    if vehData.config and vehData.config.name then
      local candidate = tostring(vehData.config.name)
      if candidate ~= '' then
        return candidate
      end
    end
    if vehData.ioCtx and vehData.ioCtx.jbeam and vehData.ioCtx.jbeam ~= '' then
      return vehData.ioCtx.jbeam
    end
  end
  if vehId then
    local coreVehiclesExtension = getLoadedExtension('core_vehicles')
    if coreVehiclesExtension and type(coreVehiclesExtension.getVehicleDetails) == 'function' then
      local okDetails, details = safePcall(coreVehiclesExtension.getVehicleDetails, vehId)
      if okDetails and details then
        if details.current and details.current.key and details.current.key ~= '' then
          return details.current.key
        end
        if details.model and details.model.key and details.model.key ~= '' then
          return details.model.key
        end
      end
    end
  end
  if vehObj then
    local ok, value = pcall(function ()
      if vehObj.jbeam and vehObj:jbeam() then
        return vehObj:jbeam()
      end
      if vehObj.getJBeamFilename then
        return vehObj:getJBeamFilename()
      end
      if vehObj.getJBeamFile then
        return vehObj:getJBeamFile()
      end
      return nil
    end)
    if ok and value and value ~= '' then
      return value
    end
  end
  return nil
end

local function normalizeModelFolder(rawModel)
  if not rawModel or rawModel == '' then
    return nil
  end
  local folder = tostring(rawModel)
  folder = folder:gsub('%.pc$', '')
  folder = folder:gsub('%.jbeam$', '')
  folder = folder:gsub('%.zip$', '')
  folder = folder:gsub('^vehicles/', '')
  folder = folder:gsub('/.*$', '')
  folder = folder:gsub('%s+', '')
  if folder == '' then
    return nil
  end
  return folder
end

local function ensureDirectory(path)
  if not path or path == '' then return end
  if not FS or not FS.directoryExists or not FS.createDirectory then return end

  local normalized = path:gsub('\\', '/')
  local okExists, exists = safePcall(FS.directoryExists, FS, normalized)
  if okExists and exists then
    return
  end

  safePcall(FS.createDirectory, FS, normalized)
end

local function normalizePath(path)
  if not path or path == '' then
    return nil
  end
  return tostring(path):gsub('\\', '/')
end

local function ensureTrailingSlash(path)
  if not path or path == '' then
    return path
  end
  if path:sub(-1) ~= '/' then
    return path .. '/'
  end
  return path
end

local function resolveUserVehiclesRoot()
  if not FS or not FS.getUserPath then
    return nil
  end
  local okUser, userPath = safePcall(FS.getUserPath, FS)
  if not okUser or not userPath or userPath == '' then
    return nil
  end
  local normalized = ensureTrailingSlash(normalizePath(userPath))
  if not normalized then
    return nil
  end
  return (normalized .. 'vehicles/'):lower()
end

local function getGamePath()
  if not FS or not FS.getGamePath then
    return nil
  end
  local okGame, gamePath = safePcall(FS.getGamePath, FS)
  if not okGame or not gamePath or gamePath == '' then
    return nil
  end
  return normalizePath(gamePath)
end

local function isPlayerConfigPath(vpath, userFilePath)
  if type(vpath) ~= 'string' or vpath == '' then
    return false
  end

  local normalizedVPath = normalizePath(vpath)
  if not normalizedVPath or normalizedVPath == '' then
    return false
  end

  local globalIsPlayer = rawget(_G, 'isPlayerVehConfig')
  if type(globalIsPlayer) == 'function' then
    local okGlobal, result = safePcall(globalIsPlayer, normalizedVPath)
    if okGlobal then
      if result == true then
        return true
      end
      if result == false then
        return false
      end
    end
  end

  if not normalizedVPath:lower():match('%.pc$') then
    return false
  end

  if not shipping_build then
    local gamePath = getGamePath()
    local okUser, userPath = safePcall(FS.getUserPath, FS)
    if okUser and userPath and userPath ~= '' then
      local normalizedUser = normalizePath(userPath)
      if normalizedUser and gamePath and normalizedUser == gamePath then
        return false
      end
    end
  end

  local resolvedPath = nil
  if FS and FS.getFileRealPath then
    local okReal, realPath = safePcall(FS.getFileRealPath, FS, normalizedVPath)
    if okReal and realPath and realPath ~= '' then
      resolvedPath = normalizePath(realPath)
    end
  end

  if not resolvedPath and userFilePath and userFilePath ~= '' then
    resolvedPath = normalizePath(userFilePath)
  end

  if not resolvedPath or resolvedPath == '' then
    return false
  end

  local userVehiclesRoot = resolveUserVehiclesRoot()
  if not userVehiclesRoot or userVehiclesRoot == '' then
    return false
  end

  local normalizedResolved = resolvedPath:lower()
  if normalizedResolved:sub(1, #userVehiclesRoot) == userVehiclesRoot then
    return true
  end

  return false
end

local function removeFileIfExists(path)
  if not path or path == '' then
    return false
  end
  if not FS then
    return false
  end

  local normalized = tostring(path)
  local okExists, exists = safePcall(FS.fileExists, FS, normalized)
  if not okExists then
    log('W', logTag, string.format('Failed to check file existence for %s: %s', tostring(path), tostring(exists)))
    return false
  end
  if not exists then
    return false
  end

  if type(FS.removeFile) == 'function' then
    local okRemove, result = safePcall(FS.removeFile, FS, normalized)
    if okRemove and result ~= false then
      return true
    end
    if not okRemove then
      log('W', logTag, string.format('FS.removeFile failed for %s: %s', tostring(path), tostring(result)))
    end
  end

  if type(FS.deleteFile) == 'function' then
    local okDelete, result = safePcall(FS.deleteFile, FS, normalized)
    if okDelete and result ~= false then
      return true
    end
    if not okDelete then
      log('W', logTag, string.format('FS.deleteFile failed for %s: %s', tostring(path), tostring(result)))
    end
  end

  local okOs, err = pcall(os.remove, normalized)
  if okOs then
    return true
  end

  log('W', logTag, string.format('Unable to remove file %s: %s', tostring(path), tostring(err)))
  return false
end

local function joinPaths(base, relative)
  if not base or base == '' then
    return relative
  end
  if not relative or relative == '' then
    return base
  end
  local normalizedBase = tostring(base):gsub('\\', '/'):gsub('/+$', '')
  local normalizedRelative = tostring(relative):gsub('\\', '/'):gsub('^/+', '')
  return normalizedBase .. '/' .. normalizedRelative
end

local function isAbsolutePath(path)
  if not path or path == '' then
    return false
  end
  local first = string.sub(path, 1, 1)
  if first == '/' or first == '\\' then
    return true
  end
  if #path >= 2 and string.sub(path, 2, 2) == ':' then
    return true
  end
  return false
end

local function makeAbsolutePath(path)
  if not path or path == '' then
    return nil
  end
  if isAbsolutePath(path) then
    return path
  end
  if not FS or not FS.getUserPath then
    return nil
  end
  local okUser, userPath = safePcall(FS.getUserPath, FS)
  if not okUser or not userPath or userPath == '' then
    return nil
  end
  local normalizedBase = tostring(userPath):gsub('\\', '/'):gsub('/+$', '')
  return joinPaths(normalizedBase, path)
end

local function quoteJsonString(value)
  local str = tostring(value or '')
  str = str:gsub('\\', '\\\\')
  str = str:gsub('"', '\\"')
  str = str:gsub('\r', '\\r')
  str = str:gsub('\n', '\\n')
  return '"' .. str .. '"'
end

local function encodeFraction(value)
  local component = clampFraction01(value)
  local str = string.format('%.6f', component)
  str = str:gsub('0+$', '')
  str = str:gsub('%.$', '')
  if str == '' then
    str = '0'
  end
  return str
end

local function encodePresetEntryForStorage(entry)
  local sanitized = sanitizeColorPresetEntry(entry)
  if not sanitized or type(sanitized.paint) ~= 'table' then
    return nil
  end

  local paint = sanitized.paint
  local base = paint.baseColor or sanitized.value or {}
  local components = {}
  for j = 1, 4 do
    local component = base[j]
    if component == nil then
      component = 1
    end
    components[j] = encodeFraction(component)
  end

  local items = {
    string.format('"baseColor":[%s,%s,%s,%s]', components[1], components[2], components[3], components[4]),
    string.format('"metallic":%s', encodeFraction(paint.metallic)),
    string.format('"roughness":%s', encodeFraction(paint.roughness)),
    string.format('"clearcoat":%s', encodeFraction(paint.clearcoat)),
    string.format('"clearcoatRoughness":%s', encodeFraction(paint.clearcoatRoughness))
  }

  if sanitized.name and sanitized.name ~= '' then
    items[#items + 1] = '"name":' .. quoteJsonString(sanitized.name)
  end

  return '{' .. table.concat(items, ',') .. '}'
end

local function encodeColorPresetsForStorage(presets)
  if type(presets) ~= 'table' then
    return '[]'
  end
  local items = {}
  for i = 1, #presets do
    local encoded = encodePresetEntryForStorage(presets[i])
    if encoded then
      items[#items + 1] = encoded
    end
  end
  return '[' .. table.concat(items, ',') .. ']'
end

local function encodeLegacyColorPresetsForStorage(presets)
  if type(presets) ~= 'table' then
    return '[]'
  end
  local items = {}
  for i = 1, #presets do
    local sanitized = sanitizeColorPresetEntry(presets[i])
    if sanitized then
      local components = sanitized.value or {}
      local encodedComponents = {}
      for j = 1, 4 do
        encodedComponents[j] = encodeFraction(components[j])
      end
      local name = quoteJsonString(sanitized.name or '')
      items[#items + 1] = string.format('{"name":%s,"value":[%s,%s,%s,%s]}', name, encodedComponents[1], encodedComponents[2], encodedComponents[3], encodedComponents[4])
    end
  end
  return '[' .. table.concat(items, ',') .. ']'
end

local function buildPresetNameFromValue(value)
  if type(value) ~= 'table' then
    return '#FFFFFF'
  end
  local r = math.floor((tonumber(value[1]) or 0) * 255 + 0.5)
  local g = math.floor((tonumber(value[2]) or 0) * 255 + 0.5)
  local b = math.floor((tonumber(value[3]) or 0) * 255 + 0.5)
  r = clamp(r, 0, 255)
  g = clamp(g, 0, 255)
  b = clamp(b, 0, 255)
  return string.format('#%02X%02X%02X', r, g, b)
end

local function sanitizePresetPaint(paint)
  if type(paint) ~= 'table' then
    return nil
  end

  local source = paint.baseColor
  if type(source) ~= 'table' then
    source = {}
  end

  local function resolveComponent(index, keyA, keyB)
    if source[index] ~= nil then
      return source[index]
    end
    if keyA and source[keyA] ~= nil then
      return source[keyA]
    end
    if keyB and source[keyB] ~= nil then
      return source[keyB]
    end
    return nil
  end

  local r = resolveComponent(1, 'x', 'r')
  local g = resolveComponent(2, 'y', 'g')
  local b = resolveComponent(3, 'z', 'b')
  local a = resolveComponent(4, 'w', 'a')
  if a == nil and source.alpha ~= nil then
    a = source.alpha
  end

  local baseColor = {
    clampFraction01(r ~= nil and r or 1),
    clampFraction01(g ~= nil and g or 1),
    clampFraction01(b ~= nil and b or 1),
    clampFraction01(a ~= nil and a or 1)
  }

  local sanitized = {
    baseColor = baseColor,
    metallic = clampFraction01(paint.metallic),
    roughness = clampFraction01(paint.roughness),
    clearcoat = clampFraction01(paint.clearcoat),
    clearcoatRoughness = clampFraction01(paint.clearcoatRoughness)
  }

  return sanitized
end

sanitizeColorPresetEntry = function(entry)
  if type(entry) ~= 'table' then
    return nil
  end

  local rawName = entry.name
  if rawName and rawName ~= '' then
    rawName = tostring(rawName)
    rawName = rawName:gsub('^%s+', ''):gsub('%s+$', '')
    if rawName == '' then
      rawName = nil
    end
  else
    rawName = nil
  end

  local paintSource = nil
  if type(entry.paint) == 'table' then
    paintSource = entry.paint
  elseif type(entry.baseColor) == 'table' or entry.metallic ~= nil or entry.roughness ~= nil
      or entry.clearcoat ~= nil or entry.clearcoatRoughness ~= nil then
    paintSource = entry
  end

  local rawValue = entry.value
  local value = nil
  local paint = nil

  if paintSource then
    paint = sanitizePresetPaint(paintSource)
  end

  if paint and type(paint.baseColor) == 'table' then
    value = {
      clampFraction01(paint.baseColor[1] or 1),
      clampFraction01(paint.baseColor[2] or 1),
      clampFraction01(paint.baseColor[3] or 1),
      clampFraction01(paint.baseColor[4] ~= nil and paint.baseColor[4] or 1)
    }
  elseif type(rawValue) == 'table' then
    local r = rawValue[1]
    local g = rawValue[2]
    local b = rawValue[3]
    local a = rawValue[4]

    if r == nil and rawValue.r ~= nil then r = rawValue.r end
    if g == nil and rawValue.g ~= nil then g = rawValue.g end
    if b == nil and rawValue.b ~= nil then b = rawValue.b end
    if a == nil then
      if rawValue.a ~= nil then
        a = rawValue.a
      elseif rawValue.alpha ~= nil then
        a = rawValue.alpha
      end
    end

    value = {
      clampFraction01(r),
      clampFraction01(g),
      clampFraction01(b),
      clampFraction01(a)
    }
  else
    return nil
  end

  if not paint then
    paint = sanitizePresetPaint({
      baseColor = value,
      metallic = entry.metallic,
      roughness = entry.roughness,
      clearcoat = entry.clearcoat,
      clearcoatRoughness = entry.clearcoatRoughness
    })
  end

  if type(paint) ~= 'table' then
    paint = sanitizePresetPaint({ baseColor = value })
  end

  if type(paint) == 'table' then
    paint.baseColor = {
      clampFraction01(value[1]),
      clampFraction01(value[2]),
      clampFraction01(value[3]),
      clampFraction01(value[4] ~= nil and value[4] or 1)
    }
  end

  local sanitized = {
    name = rawName or buildPresetNameFromValue(value),
    value = {
      clampFraction01(value[1]),
      clampFraction01(value[2]),
      clampFraction01(value[3]),
      clampFraction01(value[4] ~= nil and value[4] or 1)
    },
    paint = paint
  }

  return sanitized
end

local function decodePresetArray(rawValue)
  if type(rawValue) == 'string' then
    local trimmed = tostring(rawValue):gsub('^%s+', ''):gsub('%s+$', '')
    if trimmed == '' then
      return {}
    end
    local okDecode, decodedValue = pcall(jsonDecode, trimmed)
    if okDecode and type(decodedValue) == 'table' then
      return decodedValue
    end
    return nil
  elseif type(rawValue) == 'table' then
    return rawValue
  end
  return nil
end

local function appendSanitizedPresets(list, result)
  local added = false
  if type(list) ~= 'table' then
    return added
  end
  for i = 1, #list do
    local sanitized = sanitizeColorPresetEntry(list[i])
    if sanitized then
      result[#result + 1] = sanitized
      added = true
    end
  end
  return added
end

local function loadColorPresetsFromSettings()
  local presets = {}

  local coreSettings = getLoadedExtension('core_settings')
  if not coreSettings or type(coreSettings.getValue) ~= 'function' then
    return presets
  end

  local okValue, rawValue = safePcall(coreSettings.getValue, 'userPaintPresets')
  if not okValue then
    log('W', logTag, string.format('Failed to fetch userPaintPresets from settings: %s', tostring(rawValue)))
    return presets
  end

  appendSanitizedPresets(decodePresetArray(rawValue), presets)

  return presets
end

local function saveColorPresetsToSettings(presets)
  local coreSettings = getLoadedExtension('core_settings')
  if not coreSettings or type(coreSettings.setState) ~= 'function' then
    return false, 'core_settings_unavailable'
  end

  local encodedPresets = encodeColorPresetsForStorage(presets)
  local okSet, resultOrErr = safePcall(coreSettings.setState, { userPaintPresets = encodedPresets })
  if not okSet then
    return false, tostring(resultOrErr)
  end

  return true
end

local function reloadColorPresetsFromSettings()
  local presets = loadColorPresetsFromSettings()
  if type(presets) ~= 'table' then
    presets = {}
  end
  userColorPresets = presets
  return presets
end

local function ensureColorPresetsLoaded()
  if userColorPresets ~= nil then
    return
  end

  local presets = loadColorPresetsFromSettings()
  if type(presets) ~= 'table' then
    presets = {}
  end
  userColorPresets = presets
end

local function copyColorPresets()
  ensureColorPresetsLoaded()
  local result = {}
  if type(userColorPresets) ~= 'table' then
    return result
  end
  for i = 1, #userColorPresets do
    local sanitized = sanitizeColorPresetEntry(userColorPresets[i])
    if sanitized then
      sanitized.storageIndex = i
      result[#result + 1] = sanitized
    end
  end
  return result
end

local function addColorPresetEntry(entry)
  local sanitized = sanitizeColorPresetEntry(entry)
  if not sanitized then
    return
  end

  ensureColorPresetsLoaded()

  userColorPresets = userColorPresets or {}

  local targetName = sanitized.name and string.lower(tostring(sanitized.name)) or nil
  local replaced = false
  if targetName then
    for index = 1, #userColorPresets do
      local existing = userColorPresets[index]
      if existing and existing.name and string.lower(tostring(existing.name)) == targetName then
        userColorPresets[index] = sanitized
        replaced = true
        break
      end
    end
  end

  if not replaced then
    table.insert(userColorPresets, sanitized)
  end

  local okSave, err = saveColorPresetsToSettings(userColorPresets)
  if not okSave then
    log('W', logTag, string.format('Failed to save color presets: %s', tostring(err)))
    return
  end

  reloadColorPresetsFromSettings()
end

local function addColorPreset(jsonStr)
  if not jsonStr then return end
  if type(jsonStr) == 'table' then
    addColorPresetEntry(jsonStr)
    return
  end
  if type(jsonStr) ~= 'string' then return end
  local okDecode, data = pcall(jsonDecode, jsonStr)
  if not okDecode then
    log('W', logTag, 'Failed to decode color preset JSON: ' .. tostring(data))
    return
  end
  addColorPresetEntry(data)
end

local function removeColorPreset(index)
  ensureColorPresetsLoaded()
  if type(userColorPresets) ~= 'table' then
    return
  end

  local numericIndex = tonumber(index)
  if not numericIndex then
    return
  end

  numericIndex = math.floor(numericIndex)
  if numericIndex < 1 or numericIndex > #userColorPresets then
    return
  end

  table.remove(userColorPresets, numericIndex)

  local okSave, err = saveColorPresetsToSettings(userColorPresets)
  if not okSave then
    log('W', logTag, string.format('Failed to save color presets after removal: %s', tostring(err)))
    return
  end

  reloadColorPresetsFromSettings()
end

local function getUserVehiclesDir()
  if not FS or not FS.getUserPath then
    return nil
  end
  local ok, path = safePcall(FS.getUserPath, FS)
  if not ok or not path or path == '' then
    return nil
  end
  path = tostring(path):gsub('\\', '/')
  if not path:find('/$', 1, true) then
    path = path .. '/'
  end
  local vehiclesDir = path .. 'vehicles/'
  ensureDirectory(vehiclesDir)
  return vehiclesDir
end

local function gatherSavedConfigsFromDisk(modelFolder)
  if not modelFolder or modelFolder == '' then
    return {}
  end
  local userVehiclesDir = getUserVehiclesDir()
  local targetDir = nil
  if userVehiclesDir then
    targetDir = (userVehiclesDir .. modelFolder .. '/'):gsub('\\', '/')
    ensureDirectory(targetDir)
  end
  if not FS or not FS.findFiles then
    return {}
  end

  local searchRoots = {}
  local visitedRoots = {}
  if targetDir and targetDir ~= '' then
    table.insert(searchRoots, targetDir)
  end
  table.insert(searchRoots, string.format('vehicles/%s/', modelFolder))

  local list = {}
  local seenNames = {}

  for _, root in ipairs(searchRoots) do
    if root and root ~= '' and not visitedRoots[root] then
      visitedRoots[root] = true
      local okFind, files = safePcall(FS.findFiles, FS, root, '*.pc', 0, false, true)
      if okFind and type(files) == 'table' then
        local isUserRoot = (targetDir ~= nil and root == targetDir)
        for _, filePath in ipairs(files) do
          if type(filePath) == 'string' and filePath ~= '' then
            local normalizedPath = filePath:gsub('\\', '/')
            local fileName = normalizedPath:match('([^/]+)%.pc$')
            if not fileName or fileName == '' then
              fileName = filePath:match('([^/\\]+)%.pc$')
            end
            if fileName and fileName ~= '' then
              local key = string.lower(fileName)
              if not seenNames[key] then
                seenNames[key] = true
                local relativePath = string.format('vehicles/%s/%s.pc', modelFolder, fileName)
                local isAbsolute = normalizedPath:match('^%a:/') or normalizedPath:sub(1, 1) == '/'
                local userFilePath = nil
                local userFileExists = false

                if isUserRoot then
                  userFileExists = true
                  userFilePath = normalizedPath
                elseif targetDir then
                  local candidate = targetDir .. fileName .. '.pc'
                  local okUser, hasUser = safePcall(FS.fileExists, FS, candidate)
                  if okUser and hasUser then
                    userFilePath = candidate
                    userFileExists = true
                  end
                end

                local absolutePath = normalizedPath
                if userFileExists and userFilePath then
                  absolutePath = userFilePath
                elseif targetDir and not isAbsolute then
                  absolutePath = targetDir .. fileName .. '.pc'
                end

                absolutePath = normalizePath(absolutePath)

                local entry = {
                  fileName = fileName,
                  modelFolder = modelFolder,
                  relativePath = relativePath,
                  absolutePath = absolutePath
                }

                if userFilePath and userFilePath ~= '' then
                  entry.userFilePath = normalizePath(userFilePath)
                end

                local isPlayerConfig = isPlayerConfigPath(relativePath, entry.userFilePath)
                if not isPlayerConfig and userFileExists then
                  isPlayerConfig = true
                end

                if isPlayerConfig then
                  entry.player = true
                  entry.isUserConfig = true
                  entry.allowDelete = true
                  entry.isDeletable = true
                else
                  entry.player = false
                  entry.isUserConfig = false
                end

                local previewRelative = nil
                for _, extension in ipairs(previewImageExtensions) do
                  local candidateRelative = string.format('vehicles/%s/%s%s', modelFolder, fileName, extension)
                  local okPreview, hasPreview = safePcall(FS.fileExists, FS, candidateRelative)
                  if okPreview and hasPreview then
                    previewRelative = candidateRelative
                    break
                  end
                  if targetDir then
                    local candidateAbsolute = targetDir .. fileName .. extension
                    okPreview, hasPreview = safePcall(FS.fileExists, FS, candidateAbsolute)
                    if okPreview and hasPreview then
                      previewRelative = candidateRelative
                      break
                    end
                  end
                end

                if previewRelative then
                  entry.previewImage = previewRelative
                end

                local displayName = nil
                local okRead, configData = safePcall(jsonReadFile, relativePath)
                if not okRead or not configData then
                  if targetDir then
                    okRead, configData = safePcall(jsonReadFile, targetDir .. fileName .. '.pc')
                  end
                end
                if okRead and type(configData) == 'table' then
                  displayName = sanitizeConfigDisplayName(configData.name)
                  if not displayName then
                    displayName = sanitizeConfigDisplayName(configData.title)
                  end
                  if not displayName and type(configData.config) == 'table' then
                    displayName = sanitizeConfigDisplayName(configData.config.name or configData.config.title)
                  end
                  if not displayName then
                    displayName = sanitizeConfigDisplayName(configData.displayName)
                  end
                  entry.configType = configData.configType
                  entry.displayName = displayName
                end

                if not entry.displayName or entry.displayName == '' then
                  entry.displayName = fileName
                end

                list[#list + 1] = entry
              end
            end
          end
        end
      end
    end
  end

  table.sort(list, function(a, b)
    local nameA = string.lower(a.displayName or a.fileName or '')
    local nameB = string.lower(b.displayName or b.fileName or '')
    if nameA == nameB then
      return (a.fileName or '') < (b.fileName or '')
    end
    return nameA < nameB
  end)

  return list
end

local function getSavedConfigs(vehId, vehData, vehObj)
  local modelId = normalizeModelFolder(getVehicleModelIdentifier(vehData, vehObj, vehId))
  if not modelId then
    return {}
  end

  local configs = gatherSavedConfigsFromDisk(modelId)
  savedConfigCacheByVeh[vehId] = {
    model = modelId,
    list = configs
  }
  return configs
end

local function sendSavedConfigs(vehId, vehData, vehObj)
  if not vehId or vehId == -1 then
    guihooks.trigger('VehiclePartsPaintingSavedConfigs', { vehicleId = -1, configs = {} })
    return
  end
  vehData = vehData or vehManager.getVehicleData(vehId)
  vehObj = vehObj or getObjectByID(vehId)
  local configs = getSavedConfigs(vehId, vehData, vehObj)
  local payload = {
    vehicleId = vehId,
    configs = configs
  }
  guihooks.trigger('VehiclePartsPaintingSavedConfigs', payload)
end

local function saveCurrentUserConfig(configName)
  local vehId = be:getPlayerVehicleID(0)
  if not vehId or vehId == -1 then
    guihooks.trigger('VehiclePartsPaintingSavedConfigs', { vehicleId = -1, configs = {} })
    return
  end

  local partmgmtExtension = getLoadedExtension('core_vehicle_partmgmt')
  if not partmgmtExtension then
    log('E', logTag, 'Unable to save vehicle configuration: core_vehicle_partmgmt extension unavailable')
  else
    local displayName = sanitizeConfigDisplayName(configName) or nil
    local sanitizedBaseName = nil
    if displayName and displayName ~= '' then
      sanitizedBaseName = sanitizeFileName(displayName)
    end
    if (not sanitizedBaseName or sanitizedBaseName == '') and configName and configName ~= '' then
      sanitizedBaseName = sanitizeFileName(configName)
    end

    if not sanitizedBaseName or sanitizedBaseName == '' then
      log('W', logTag, string.format('Unable to save vehicle configuration: invalid name %s', tostring(configName)))
    else
      local saveEntryPoint = nil
      local saveEntryPointName = nil
      if type(partmgmtExtension.saveLocal) == 'function' then
        saveEntryPoint = partmgmtExtension.saveLocal
        saveEntryPointName = 'saveLocal'
      elseif type(partmgmtExtension.save) == 'function' then
        saveEntryPoint = partmgmtExtension.save
        saveEntryPointName = 'save'
      end

      if not saveEntryPoint then
        log('E', logTag, 'Unable to save vehicle configuration: no save entry point available on core_vehicle_partmgmt')
      else
        local fileName = sanitizedBaseName
        if not string.lower(fileName):match('%.pc$') then
          fileName = fileName .. '.pc'
        end

        local okSave, resultOrErr = safePcall(saveEntryPoint, fileName)
        if okSave and resultOrErr ~= false then
          if displayName and displayName ~= '' then
            if displayName ~= sanitizedBaseName then
              log('I', logTag, string.format('Saved vehicle configuration "%s" to "%s" via core_vehicle_partmgmt.%s', tostring(displayName), tostring(fileName), tostring(saveEntryPointName)))
            else
              log('I', logTag, string.format('Saved vehicle configuration "%s" via core_vehicle_partmgmt.%s', tostring(displayName), tostring(saveEntryPointName)))
            end
          else
            log('I', logTag, string.format('Saved vehicle configuration "%s" via core_vehicle_partmgmt.%s', tostring(fileName), tostring(saveEntryPointName)))
          end

          local screenshotExtensionName = 'util_screenshotCreator'
          if not extensions or type(extensions.load) ~= 'function' then
            log('W', logTag, string.format('Unable to capture configuration thumbnail for "%s": extensions.load unavailable', tostring(displayName or sanitizedBaseName)))
          else
            local okLoad, loadErr = safePcall(function()
              return extensions.load(screenshotExtensionName)
            end)
            if not okLoad then
              log('W', logTag, string.format('Unable to load %s extension for "%s": %s', screenshotExtensionName, tostring(displayName or sanitizedBaseName), tostring(loadErr)))
            end

            local screenshotExtension = getLoadedExtension(screenshotExtensionName)
            if screenshotExtension and type(screenshotExtension.startWork) == 'function' then
              local okStart, startErr = safePcall(screenshotExtension.startWork, { selection = sanitizedBaseName })
              if not okStart then
                log('W', logTag, string.format('Failed to start %s for "%s": %s', screenshotExtensionName, tostring(displayName or sanitizedBaseName), tostring(startErr)))
              end
            else
              log('W', logTag, string.format('Unable to capture configuration thumbnail for "%s": %s extension unavailable or missing startWork', tostring(displayName or sanitizedBaseName), screenshotExtensionName))
            end
          end
        else
          local errorMessage
          if not okSave then
            errorMessage = tostring(resultOrErr)
          else
            errorMessage = 'save entry point returned false'
          end
          log('E', logTag, string.format('Failed to save vehicle configuration "%s": %s', tostring(displayName or configName), tostring(errorMessage or 'unknown_error')))
        end
      end
    end
  end

  local vehObj = getObjectByID(vehId)
  local vehData = vehManager.getVehicleData(vehId)
  sendSavedConfigs(vehId, vehData, vehObj)
end

local function deleteSavedConfiguration(configPath)
  if type(configPath) ~= 'string' or configPath == '' then
    log('W', logTag, string.format('Cannot delete saved configuration: invalid path %s', tostring(configPath)))
    return
  end

  local normalized = tostring(configPath):gsub('\\', '/'):gsub('^/+', '')
  local modelFolder, baseName = normalized:match('^vehicles/([^/]+)/([^/]+)%.pc$')
  if not modelFolder or not baseName then
    log('W', logTag, string.format('Cannot delete saved configuration: unexpected path %s', tostring(configPath)))
    return
  end

  if not isSafePathSegment(modelFolder) or not isSafePathSegment(baseName) then
    log('W', logTag, string.format('Refusing to delete configuration with unsafe path %s', tostring(configPath)))
    return
  end

  local userVehiclesDir = getUserVehiclesDir()
  if not userVehiclesDir then
    log('W', logTag, 'Unable to delete saved configuration: user vehicles directory unavailable')
    return
  end

  local targetDir = (userVehiclesDir .. modelFolder .. '/'):gsub('\\', '/')
  local relativeConfigPath = normalized
  local configFilePath = targetDir .. baseName .. '.pc'
  local removalTargets = { configFilePath, relativeConfigPath }
  local seenTargets = {}
  local removedConfig = false
  for _, candidate in ipairs(removalTargets) do
    if candidate and candidate ~= '' then
      local key = candidate
      if not seenTargets[key] then
        seenTargets[key] = true
        if removeFileIfExists(candidate) then
          removedConfig = true
        end
      end
    end
  end

  local removedPreview = false
  local previewSeen = {}
  for _, extension in ipairs(previewImageExtensions) do
    local previewRelative = string.format('vehicles/%s/%s%s', modelFolder, baseName, extension)
    local previewAbsolute = targetDir .. baseName .. extension
    local previewTargets = { previewAbsolute, previewRelative }
    for _, candidate in ipairs(previewTargets) do
      if candidate and candidate ~= '' then
        if not previewSeen[candidate] then
          previewSeen[candidate] = true
          if removeFileIfExists(candidate) then
            removedPreview = true
          end
        end
      end
    end
  end

  if removedConfig then
    log('I', logTag, string.format('Deleted saved configuration "%s"', tostring(configPath)))
  else
    log('I', logTag, string.format('No saved configuration file found to delete at %s', tostring(configFilePath)))
  end

  if removedPreview then
    log('I', logTag, string.format('Removed preview image(s) for configuration "%s"', tostring(configPath)))
  end

  local vehId = be:getPlayerVehicleID(0)
  if not vehId or vehId == -1 then
    sendSavedConfigs(-1)
    return
  end

  local vehObj = getObjectByID(vehId)
  local vehData = vehManager.getVehicleData(vehId)
  sendSavedConfigs(vehId, vehData, vehObj)
end

local function spawnUserConfig(configPath)
  log('W', logTag, string.format('Ignoring spawnUserConfig request for %s (feature disabled)', tostring(configPath)))
end

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

local function resolveSlotLabel(availableParts, parentPartName, slotKey, node)
  if availableParts and parentPartName and parentPartName ~= '' and slotKey and slotKey ~= '' then
    local parentInfo = availableParts[parentPartName]
    if parentInfo then
      local slotInfoUi = parentInfo.slotInfoUi
      if slotInfoUi then
        local slotInfo = slotInfoUi[slotKey]
        if slotInfo then
          local description = slotInfo.description or slotInfo.name
          if description and description ~= '' then
            return description
          end
        end
      end
    end
  end

  if node then
    if node.name and node.name ~= '' then
      return node.name
    end
    if node.displayName and node.displayName ~= '' then
      return node.displayName
    end
    if node.title and node.title ~= '' then
      return node.title
    end
    if node.id and node.id ~= '' then
      return node.id
    end
  end

  if slotKey and slotKey ~= '' then
    return slotKey
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

local function queueBasePartWorkaroundExecution(vehObj)
  if not vehObj or type(vehObj.queueLuaCommand) ~= 'function' then return false end

  local command = [[
local vehId = nil
if obj and obj.getID then
  vehId = obj:getID()
end
if vehId and obj and obj.queueGameEngineLua then
  obj:queueGameEngineLua(string.format('freeroam_vehiclePartsPainting.executeBasePartWorkaround(%d)', vehId))
end
]]

  vehObj:queueLuaCommand(command)
  return true
end

local function queueApplyBasePaintsToAllParts(vehObj, paints)
  if not vehObj or not paints then return end
  if type(vehObj.queueLuaCommand) ~= 'function' then return end

  local command = string.format([[local paints = %s
if partCondition and partCondition.setAllPartPaints then
  local ok, err = pcall(partCondition.setAllPartPaints, paints, 0)
  if not ok then
    log('W', 'vehiclePartsPainting', 'setAllPartPaints failed for vehicle '..tostring(obj:getID())..': '..tostring(err))
  end
end
]], paintsToLuaLiteral(paints))

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

local function applyBasePaintToVehicleSlot(vehObj, slotIndex, paint)
  if not vehObj or type(paint) ~= 'table' then return end
  local base = paint.baseColor or {}
  local function makeColor(r, g, b, a)
    if Point4F then
      return Point4F(r, g, b, a)
    elseif ColorF then
      return ColorF(r, g, b, a)
    else
      return {x = r, y = g, z = b, w = a, r = r, g = g, b = b, a = a}
    end
  end

  local color = makeColor(
    clamp01(base[1]),
    clamp01(base[2]),
    clamp01(base[3]),
    clamp01(base[4] or 1)
  )

  if slotIndex == 0 then
    vehObj.color = color
  elseif slotIndex == 1 then
    vehObj.colorPalette0 = color
  elseif slotIndex == 2 then
    vehObj.colorPalette1 = color
  end

  if vehObj.setField then
    local metallic = formatNumberLiteral(paint.metallic or 0)
    local roughness = formatNumberLiteral(paint.roughness or 0.5)
    local clearcoat = formatNumberLiteral(paint.clearcoat or 0)
    local clearcoatRoughness = formatNumberLiteral(paint.clearcoatRoughness or 0)
    local data = string.format('%s %s %s %s', metallic, roughness, clearcoat, clearcoatRoughness)
    vehObj:setField('metallicPaintData', tostring(slotIndex), data)
  end
end

local function applyBasePaintsToVehicle(vehObj, paints)
  if not vehObj or type(paints) ~= 'table' then return end
  if tableIsEmpty(paints) then return end

  local vehId = vehObj.getID and vehObj:getID()
  local count = math.max(1, #paints)
  local colorsExtension = getLoadedExtension('core_vehicle_colors')
  local canUseColorsExtension = colorsExtension and type(colorsExtension.setVehiclePaint) == 'function'
  local usedExtension = false

  if canUseColorsExtension and vehId and vehId ~= -1 then
    for i = 1, math.min(3, count) do
      local paint = paints[i] or paints[count]
      if paint then
        local paintCopy = copyPaint(paint)
        if paintCopy then
          local ok, err = safePcall(colorsExtension.setVehiclePaint, i, paintCopy, vehId)
          if not ok then
            log('W', logTag, string.format('setVehiclePaint failed for vehicle %s slot %d: %s', tostring(vehId), i, tostring(err)))
          else
            usedExtension = true
          end
        end
      end
    end
  end

  if usedExtension then
    return
  end

  for i = 1, math.min(3, count) do
    local paint = paints[i] or paints[count]
    if paint then
      applyBasePaintToVehicleSlot(vehObj, i - 1, paint)
    end
  end

  local coreVehiclesExtension = getLoadedExtension('core_vehicles')
  local canUpdateColors = coreVehiclesExtension and type(coreVehiclesExtension.updateVehicleColors) == 'function'

  if vehObj.queueLuaCommand and type(vehObj.queueLuaCommand) == 'function' and canUpdateColors then
    local updateColorsCommand = [[
local globalEnv = _G
if type(globalEnv) == 'table' then
  local manager = rawget(globalEnv, 'extensions')
  if type(manager) == 'table' then
    local coreVehicles = rawget(manager, 'core_vehicles')
    if coreVehicles and type(coreVehicles.updateVehicleColors) == 'function' then
      coreVehicles.updateVehicleColors()
    end
  end
end
]]
    vehObj:queueLuaCommand(updateColorsCommand)
  elseif canUpdateColors then
    coreVehiclesExtension.updateVehicleColors()
  end
end

local sendState
local applyStoredPaints
local getBasePaintState
local getVehicleBasePaints

local function setVehicleBasePaints(paints)
  local vehObj = getPlayerVehicle(0)
  if not vehObj then
    log('W', logTag, 'Unable to set vehicle base paints: player vehicle unavailable')
    return
  end

  local vehId = vehObj:getID()
  local vehData = vehManager.getVehicleData(vehId)
  if not vehData then
    log('W', logTag, string.format('Unable to set vehicle base paints: vehicle data unavailable for %s', tostring(vehId)))
    return
  end

  local previousBase = getVehicleBasePaints(vehId, vehData, vehObj)

  local sanitized = sanitizePaints(paints)
  if not sanitized then
    log('W', logTag, 'Invalid base paint data received; ignoring request')
    return
  end

  log('I', logTag, string.format('Updating vehicle %s base paints to %s', tostring(vehId), paintsToLogSummary(sanitized)))

  vehData.config = vehData.config or {}
  vehData.config.paints = copyPaints(sanitized)

  local state = getBasePaintState(vehId, true)
  if not state.original or tableIsEmpty(state.original) then
    state.original = copyPaints(previousBase)
  end
  state.current = copyPaints(sanitized)

  if vehId and vehId ~= -1 then
    local workaroundState = getBasePaintWorkaroundState(vehId, true)
    if workaroundState then
      workaroundState.basePaints = copyPaints(sanitized)
      local phase = workaroundState.phase
      if phase == 'await_base' or phase == 'await_part' then
        workaroundState.phase = 'await_part'
      end
    end
  end

  ensureVehiclePartConditionInitialized(vehObj, vehId)

  applyBasePaintsToVehicle(vehObj, sanitized)
  queueApplyBasePaintsToAllParts(vehObj, sanitized)
  applyStoredPaints(vehId)

  sendState(vehId)
end

local function setVehicleBasePaintsJson(jsonStr)
  if type(jsonStr) ~= 'string' then return end
  local ok, data = pcall(jsonDecode, jsonStr)
  if not ok then
    log('E', logTag, 'Failed to decode base paint JSON: ' .. tostring(data))
    return
  end

  local paints = data.paints or data
  setVehicleBasePaints(paints)
end

getBasePaintState = function(vehId, create)
  if not vehId then return nil end
  local state = basePaintStateByVeh[vehId]
  if not state and create then
    state = {}
    basePaintStateByVeh[vehId] = state
  end
  return state
end

getVehicleBasePaints = function(vehId, vehData, vehObj)
  local state = getBasePaintState(vehId, false)
  if state and type(state.current) == 'table' and not tableIsEmpty(state.current) then
    return copyPaints(state.current)
  end

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

  if vehId then
    state = getBasePaintState(vehId, true)
    if not state.original or tableIsEmpty(state.original) then
      state.original = copyPaints(basePaints)
    end
    state.current = copyPaints(basePaints)
  end

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

local function gatherParts(node, result, availableParts, basePaints, validPaths, depth, vehId, descriptors, activePartIds, parentPartName, slotKey)
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
    local slotLabel = resolveSlotLabel(availableParts, parentPartName, slotKey, node)
    local slotDisplayName = slotLabel or nil
    local slotName = node.name or node.id or slotKey
    local entry = {
      partPath = partPath,
      partName = chosenPartName,
      slotName = slotName,
      slotLabel = slotDisplayName,
      slotPath = slotPath,
      depth = depth or 0,
      displayName = displayName,
      hasCustomPaint = false
    }
    local state = storedPartPaintsByVeh[vehId]
    local customEntry = state and state[partPath]
    local customPaints = customEntry and customEntry.paints or nil
    local hasCustomPaints = type(customPaints) == 'table' and not tableIsEmpty(customPaints)
    if hasCustomPaints then
      entry.hasCustomPaint = true
    else
      customPaints = nil
    end
    local paints = hasCustomPaints and customPaints or basePaints
    entry.currentPaints = copyPaints(paints)
    if hasCustomPaints then
      entry.customPaints = copyPaints(customPaints)
    else
      entry.customPaints = nil
    end
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
      gatherParts(child.child, result, availableParts, basePaints, validPaths, (depth or 0) + 1, vehId, descriptors, activePartIds, chosenPartName, child.key)
    end
  end
end

sendState = function(targetVehId)
  local vehId = targetVehId or be:getPlayerVehicleID(0)
  if not vehId or vehId == -1 then
    guihooks.trigger('VehiclePartsPaintingState', {vehicleId = false, parts = {}, basePaints = {}, colorPresets = copyColorPresets()})
    return
  end
  local vehObj = getObjectByID(vehId)
  local vehData = vehManager.getVehicleData(vehId)
  if not vehObj or not vehData then
    guihooks.trigger('VehiclePartsPaintingState', {vehicleId = false, parts = {}, basePaints = {}, colorPresets = copyColorPresets()})
    return
  end

  ensureVehiclePartConditionInitialized(vehObj, vehId)

  syncStateWithConfig(vehId, vehData)

  local basePaints = getVehicleBasePaints(vehId, vehData, vehObj)
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
  gatherParts(vehData.config.partsTree, parts, availableParts, basePaints, validPaths, 0, vehId, descriptors, activePartIds, nil, nil)
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

  local originalBasePaints = {}
  local baseState = basePaintStateByVeh[vehId]
  if baseState and type(baseState.original) == 'table' and not tableIsEmpty(baseState.original) then
    originalBasePaints = copyPaints(baseState.original)
  else
    originalBasePaints = copyPaints(basePaints)
  end

  local data = {
    vehicleId = vehId,
    parts = parts,
    basePaints = copyPaints(basePaints),
    originalBasePaints = originalBasePaints,
    colorPresets = copyColorPresets()
  }

  guihooks.trigger('VehiclePartsPaintingState', data)
  sendSavedConfigs(vehId, vehData, vehObj)
end

applyStoredPaints = function(vehId)
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
    previousPaints = getVehicleBasePaints(vehId, vehData, vehObj)
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

  local workaroundState = getBasePaintWorkaroundState(vehId, false)
  if workaroundState and workaroundState.phase == 'await_part' then
    local basePaints = workaroundState.basePaints
    if type(basePaints) == 'table' and not tableIsEmpty(basePaints) then
      if type(sanitizedPaints) == 'table' and not tableIsEmpty(sanitizedPaints) then
        local identifierCopyForWorkaround = {}
        for i = 1, #identifierCopy do
          identifierCopyForWorkaround[i] = identifierCopy[i]
        end
        workaroundState.pendingPart = {
          partPath = partPath,
          partName = resolvedName,
          slotPath = slotForCommand,
          identifiers = identifierCopyForWorkaround,
          paints = copyPaints(sanitizedPaints)
        }
        if queueBasePartWorkaroundExecution(vehObj) then
          workaroundState.phase = 'scheduled'
          log('I', logTag, string.format(
            'Scheduled base paint workaround for vehicle %s part=%s (name=%s slot=%s)',
            tostring(vehId),
            tostring(partPath),
            tostring(resolvedName),
            tostring(slotForCommand)
          ))
        else
          log('W', logTag, string.format(
            'Unable to queue base paint workaround for vehicle %s; queueLuaCommand unavailable',
            tostring(vehId)
          ))
          workaroundState.pendingPart = nil
          workaroundState.phase = 'complete'
        end
      end
    end
  end

  sendState(vehId)
end

local function executeBasePartWorkaround(vehId)
  if not vehId then return end

  local state = basePaintWorkaroundStateByVeh[vehId]
  if not state then return end

  local phase = state.phase
  if phase ~= 'scheduled' and phase ~= 'running' then
    return
  end

  local basePaints = state.basePaints
  local pending = state.pendingPart
  if type(basePaints) ~= 'table' or tableIsEmpty(basePaints) or type(pending) ~= 'table' then
    state.pendingPart = nil
    state.phase = 'complete'
    return
  end

  local vehObj = getObjectByID(vehId)
  local vehData = vehManager.getVehicleData(vehId)
  if not vehObj or not vehData then
    log('W', logTag, string.format(
      'Unable to execute base paint workaround for vehicle %s: vehicle object or data unavailable',
      tostring(vehId)
    ))
    state.pendingPart = nil
    state.phase = 'complete'
    return
  end

  local partPaints = pending.paints
  if type(partPaints) ~= 'table' or tableIsEmpty(partPaints) then
    state.pendingPart = nil
    state.phase = 'complete'
    return
  end

  state.phase = 'running'

  local baseCopy = copyPaints(basePaints)
  log('I', logTag, string.format(
    'Reapplying vehicle %s base paints %s and restoring part=%s (name=%s slot=%s) as workaround',
    tostring(vehId),
    paintsToLogSummary(baseCopy),
    tostring(pending.partPath),
    tostring(pending.partName),
    tostring(pending.slotPath)
  ))

  applyBasePaintsToVehicle(vehObj, baseCopy)
  queueApplyBasePaintsToAllParts(vehObj, baseCopy)

  local identifierCopy = {}
  if type(pending.identifiers) == 'table' then
    for i = 1, #pending.identifiers do
      identifierCopy[i] = pending.identifiers[i]
    end
  end

  queuePartPaintCommands(
    vehObj,
    vehId,
    pending.partPath,
    pending.partName,
    pending.slotPath,
    identifierCopy,
    copyPaints(partPaints)
  )

  state.pendingPart = nil
  state.phase = 'complete'
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

  local basePaints = getVehicleBasePaints(vehId, vehData, vehObj)
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

local function resolveHighlightInfo(vehId, partPath)
  if not vehId or not partPath or partPath == '' then
    return nil, nil, nil, {}
  end

  local descriptors = partDescriptorsByVeh[vehId]
  local descriptor = descriptors and descriptors[partPath]
  local slotPath = descriptor and descriptor.slotPath or nil
  local partName = descriptor and descriptor.partName or nil

  if not partName then
    local vehData = vehManager.getVehicleData(vehId)
    partName = resolvePartName(vehData, partPath)
    if descriptor and partName then
      descriptor.partName = partName
    end
  end

  local identifiers = descriptor and descriptor.identifiers
  if not identifiers or tableIsEmpty(identifiers) then
    identifiers, descriptor = resolvePartIdentifiersForVehicle(vehId, partPath, partName, slotPath)
  end

  if not descriptor and partDescriptorsByVeh[vehId] then
    descriptor = partDescriptorsByVeh[vehId][partPath]
  end

  if descriptor then
    if partName and partName ~= '' then
      descriptor.partName = descriptor.partName or partName
    end
    if slotPath and slotPath ~= '' then
      descriptor.slotPath = descriptor.slotPath or slotPath
    end
    identifiers = descriptor.identifiers or identifiers
    partName = descriptor.partName or partName
    slotPath = descriptor.slotPath or slotPath
  end

  return descriptor, partName, slotPath, identifiers or {}
end

local function shouldUseMeshAlphaFallback()
  local partManager = extensions and extensions.core_vehicle_partmgmt
  return not (partManager and type(partManager.selectParts) == 'function')
end

local function applyPartTransparency(vehId, partPath)
  if not shouldUseMeshAlphaFallback() then
    return
  end

  if not vehId or vehId == -1 then return end

  local vehObj = getObjectByID(vehId)
  if not vehObj then return end

  if not partPath or partPath == '' then
    vehObj:setMeshAlpha(1, "", false)
    return
  end

  vehObj:setMeshAlpha(highlightFadeAlpha, "", false)

  local descriptor, partName, slotPath, identifiers = resolveHighlightInfo(vehId, partPath)

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

local function buildHighlightSelection(vehId, partPath)
  local selection = {}
  if not partPath or partPath == '' then
    return selection
  end

  selection[partPath] = true

  local _, partName, slotPath, identifiers = resolveHighlightInfo(vehId, partPath)
  local candidates = collectPartIdentifierCandidates(partPath, partName, slotPath)

  if candidates then
    for _, identifier in ipairs(candidates) do
      if identifier and identifier ~= '' then
        selection[identifier] = true
      end
    end
  end

  if identifiers then
    for _, identifier in ipairs(identifiers) do
      if identifier and identifier ~= '' then
        selection[identifier] = true
      end
    end
  end

  return selection
end

local function showAllParts(targetVehId)
  local vehId = targetVehId or be:getPlayerVehicleID(0)
  if not vehId or vehId == -1 then return end

  local vehObj = getObjectByID(vehId)
  if not vehObj then return end

  local vehData = nil
  if vehManager and type(vehManager.getVehicleData) == 'function' then
    vehData = vehManager.getVehicleData(vehId)
  end

  local highlight = validPartPathsByVeh[vehId]
  if (not highlight or tableIsEmpty(highlight)) and vehData then
    local basePaints = getVehicleBasePaints(vehId, vehData, vehObj)
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
    gatherParts(vehData.config.partsTree, tmpParts, availableParts, basePaints, highlight, 0, vehId, descriptors, activePartIds, nil, nil)
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

  applyPartTransparency(vehId, nil)

  local currentPlayerVehId = be:getPlayerVehicleID(0)
  if vehId == currentPlayerVehId then
    local partManager = extensions.core_vehicle_partmgmt
    if partManager then
      if type(partManager.showHighlightedParts) == 'function' then
        partManager.showHighlightedParts(vehId)
      elseif type(partManager.selectParts) == 'function' then
        partManager.selectParts({}, vehId)
      end
      if type(partManager.highlightParts) == 'function' then
        partManager.highlightParts(highlight or {}, vehId)
      elseif vehObj then
        vehObj:queueLuaCommand('bdebug.setPartsSelected({})')
      end
    elseif vehObj then
      vehObj:queueLuaCommand('bdebug.setPartsSelected({})')
    end
  elseif vehObj then
    vehObj:queueLuaCommand('bdebug.setPartsSelected({})')
  end
end

local function highlightPart(partPath)
  local vehId = be:getPlayerVehicleID(0)
  highlightedParts = {}
  local selection = {}
  if partPath and partPath ~= '' then
    highlightedParts[partPath] = true
    selection = buildHighlightSelection(vehId, partPath)
  end
  if extensions.core_vehicle_partmgmt then
    if type(extensions.core_vehicle_partmgmt.selectParts) == 'function' then
      extensions.core_vehicle_partmgmt.selectParts(selection, vehId)
    elseif type(extensions.core_vehicle_partmgmt.highlightParts) == 'function' then
      extensions.core_vehicle_partmgmt.highlightParts(selection, vehId)
    end
  end
  applyPartTransparency(vehId, partPath)
end

local function clearHighlight(targetVehId)
  showAllParts(targetVehId)
end

local function requestState()
  sendState()
end

local function requestSavedConfigs()
  local vehId = be:getPlayerVehicleID(0)
  if not vehId or vehId == -1 then
    sendSavedConfigs(-1)
    return
  end
  local vehObj = getObjectByID(vehId)
  local vehData = vehManager.getVehicleData(vehId)
  sendSavedConfigs(vehId, vehData, vehObj)
end

local function saveCurrentConfiguration(name)
  saveCurrentUserConfig(name)
end

local function spawnSavedConfiguration(configPath)
  spawnUserConfig(configPath)
end

local function onVehicleSpawned(vehId)
  basePaintStateByVeh[vehId] = nil
  resetBasePaintWorkaroundState(vehId)
  applyStoredPaints(vehId)
  if vehId == be:getPlayerVehicleID(0) then
    sendState(vehId)
    lastKnownPlayerVehicleId = vehId
  end
  showAllParts(vehId)
  local vehObj = getObjectByID(vehId)
  local vehData = vehManager.getVehicleData(vehId)
  sendSavedConfigs(vehId, vehData, vehObj)
end

local function onVehicleResetted(vehId)
  basePaintStateByVeh[vehId] = nil
  resetBasePaintWorkaroundState(vehId)
  applyStoredPaints(vehId)
  if vehId == be:getPlayerVehicleID(0) then
    sendState(vehId)
    lastKnownPlayerVehicleId = vehId
  end
  showAllParts(vehId)
  local vehObj = getObjectByID(vehId)
  local vehData = vehManager.getVehicleData(vehId)
  sendSavedConfigs(vehId, vehData, vehObj)
end

local function onVehicleDestroyed(vehId)
  storedPartPaintsByVeh[vehId] = nil
  validPartPathsByVeh[vehId] = nil
  partDescriptorsByVeh[vehId] = nil
  activePartIdSetByVeh[vehId] = nil
  ensuredPartConditionsByVeh[vehId] = nil
  savedConfigCacheByVeh[vehId] = nil
  basePaintStateByVeh[vehId] = nil
  clearBasePaintWorkaroundState(vehId)
  if vehId == lastKnownPlayerVehicleId then
    lastKnownPlayerVehicleId = nil
  end
  if vehId == be:getPlayerVehicleID(0) then
    sendState(-1)
    sendSavedConfigs(-1)
  end
end

local function onVehicleSwitched(oldId, newId, player)
  local involvesPlayer = player
  if not involvesPlayer then
    involvesPlayer = isLikelyPlayerVehicleId(oldId) or isLikelyPlayerVehicleId(newId)
  end
  if not involvesPlayer then
    if oldId and validPartPathsByVeh[oldId] then
      involvesPlayer = true
    elseif newId and validPartPathsByVeh[newId] then
      involvesPlayer = true
    end
  end
  if not involvesPlayer then
    return
  end

  if oldId and oldId ~= -1 then
    clearBasePaintWorkaroundState(oldId)
    showAllParts(oldId)
  end

  if newId and newId ~= -1 then
    resetBasePaintWorkaroundState(newId)
    applyStoredPaints(newId)
    sendState(newId)
    showAllParts(newId)
    local vehObj = getObjectByID(newId)
    local vehData = vehManager.getVehicleData(newId)
    sendSavedConfigs(newId, vehData, vehObj)
    lastKnownPlayerVehicleId = newId
  else
    sendState(-1)
    sendSavedConfigs(-1)
    lastKnownPlayerVehicleId = nil
  end
end

local function onExtensionLoaded()
  storedPartPaintsByVeh = {}
  validPartPathsByVeh = {}
  partDescriptorsByVeh = {}
  activePartIdSetByVeh = {}
  ensuredPartConditionsByVeh = {}
  savedConfigCacheByVeh = {}
  basePaintWorkaroundStateByVeh = {}
  userColorPresets = nil
  local currentVeh = be:getPlayerVehicleID(0)
  if currentVeh and currentVeh ~= -1 then
    lastKnownPlayerVehicleId = currentVeh
    resetBasePaintWorkaroundState(currentVeh)
    applyStoredPaints(currentVeh)
    sendState(currentVeh)
    showAllParts(currentVeh)
    local vehObj = getObjectByID(currentVeh)
    local vehData = vehManager.getVehicleData(currentVeh)
    sendSavedConfigs(currentVeh, vehData, vehObj)
  else
    lastKnownPlayerVehicleId = nil
    sendState(-1)
    sendSavedConfigs(-1)
  end
end

local function onExtensionUnloaded()
  storedPartPaintsByVeh = {}
  validPartPathsByVeh = {}
  partDescriptorsByVeh = {}
  activePartIdSetByVeh = {}
  ensuredPartConditionsByVeh = {}
  savedConfigCacheByVeh = {}
  basePaintWorkaroundStateByVeh = {}
  userColorPresets = nil
  lastKnownPlayerVehicleId = nil
  clearHighlight()
end

M.requestState = requestState
M.requestSavedConfigs = requestSavedConfigs
M.applyPartPaintJson = applyPartPaintJson
M.executeBasePartWorkaround = executeBasePartWorkaround
M.setPartPaint = setPartPaint
M.resetPartPaint = resetPartPaint
M.setVehicleBasePaints = setVehicleBasePaints
M.setVehicleBasePaintsJson = setVehicleBasePaintsJson
M.highlightPart = highlightPart
M.showAllParts = showAllParts
M.clearHighlight = clearHighlight
M.onVehiclePartsPaintingResult = onVehiclePartsPaintingResult
M.saveCurrentConfiguration = saveCurrentConfiguration
M.deleteSavedConfiguration = deleteSavedConfiguration
M.spawnSavedConfiguration = spawnSavedConfiguration
M.addColorPreset = addColorPreset
M.removeColorPreset = removeColorPreset

M.onVehicleSpawned = onVehicleSpawned
M.onVehicleResetted = onVehicleResetted
M.onVehicleDestroyed = onVehicleDestroyed
M.onVehicleSwitched = onVehicleSwitched
M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded

return M
