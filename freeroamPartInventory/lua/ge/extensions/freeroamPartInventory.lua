local M = {}

local im = ui_imgui

local partInventory = {}
local nextId = 1

local uiState = {inventory = {}, vehicleParts = {}, currentVehicleModel = nil}
local isOpen = false
local openPtr = im.BoolPtr(false)

local function getNodeFromSlotPath(tree, path)
  if not tree or not path then return nil end
  if path == "/" then return tree end
  local current = tree
  for segment in string.gmatch(path, "[^/]+") do
    if current.children and current.children[segment] then
      current = current.children[segment]
    else
      return nil
    end
  end
  return current
end

local function refreshUI()
  uiState.inventory = {}
  for id, part in pairs(partInventory) do
    uiState.inventory[#uiState.inventory + 1] = {
      id = id,
      name = part.name,
      slot = part.slot,
      vehicleModel = part.vehicleModel
    }
  end

  uiState.vehicleParts = {}
  local veh = be:getPlayerVehicle(0)
  if not veh then return end

  uiState.currentVehicleModel = veh.jbeam or veh:getJBeamFilename()
  local vehId = veh:getID()
  local vehicleData = extensions.core_vehicle_manager.getVehicleData(vehId)
  if vehicleData and vehicleData.config and vehicleData.config.partsTree then
    local function gather(node)
      if not node then return end
      if node.chosenPartName and node.chosenPartName ~= "" then
        uiState.vehicleParts[#uiState.vehicleParts + 1] = {slot = node.path, name = node.chosenPartName}
      end
      if node.children then
        for _, child in pairs(node.children) do
          gather(child)
        end
      end
    end
    gather(vehicleData.config.partsTree)
  end
end

-- Internal helper to store information about a removed part
local function storePart(slot, partName, veh)
  if not veh then return end

  local vehId = veh:getID()
  local vehicleData = extensions.core_vehicle_manager.getVehicleData(vehId)

  local color
  if vehicleData and vehicleData.partConditions then
    local cond = vehicleData.partConditions[slot .. partName]
    if cond and cond.visualState and cond.visualState.paint then
      color = cond.visualState.paint.originalPaints
    end
  end

  -- fallback to whole-vehicle colour when per-part data is unavailable
  if not color then
    color = {veh:getColorRGB()}
  end

  partInventory[nextId] = {
    name = partName,
    slot = slot,
    vehicleModel = veh.jbeam or veh:getJBeamFilename(),
    color = color,
  }

  nextId = nextId + 1
end

-- Removes a part from the player's vehicle by clearing the slot
local function removePart(slot)
  local veh = be:getPlayerVehicle(0)
  if not veh then return end

  local vehId = veh:getID()
  local vehicleData = extensions.core_vehicle_manager.getVehicleData(vehId)
  if not vehicleData or not vehicleData.config or not vehicleData.config.parts then return end

  local partName = vehicleData.config.parts[slot]
  if not partName or partName == '' then return end

  storePart(slot, partName, veh)

  vehicleData.config.parts[slot] = ''
  local node = getNodeFromSlotPath(vehicleData.config.partsTree, slot)
  if node then node.chosenPartName = '' end
  core_vehicle_manager.queueAdditionalVehicleData({spawnWithEngineRunning = false}, vehId)
  core_vehicles.replaceVehicle(veh.jbeam or veh:getJBeamFilename(), vehicleData, veh)

  refreshUI()
end

-- Installs a part from the inventory onto the player's vehicle
local function installPart(id)
  local part = partInventory[id]
  if not part then return end

  local veh = be:getPlayerVehicle(0)
  if not veh then return end

  if (veh.jbeam or veh:getJBeamFilename()) ~= part.vehicleModel then return end

  local vehId = veh:getID()
  local vehicleData = extensions.core_vehicle_manager.getVehicleData(vehId)
  if not vehicleData or not vehicleData.config or not vehicleData.config.parts then return end

  vehicleData.config.parts[part.slot] = part.name
  local node = getNodeFromSlotPath(vehicleData.config.partsTree, part.slot)
  if node then node.chosenPartName = part.name end
  core_vehicle_manager.queueAdditionalVehicleData({spawnWithEngineRunning = false}, vehId)
  core_vehicles.replaceVehicle(veh.jbeam or veh:getJBeamFilename(), vehicleData, veh)

  if part.color then
    local colorJson = jsonEncode(part.color)
    veh:queueLuaCommand(string.format(
      "partCondition.setPartPaints('%s', jsonDecode('%s'))",
      part.slot,
      colorJson
    ))
  end

  partInventory[id] = nil
  refreshUI()
end

local function onUpdate()
  if not isOpen then return end
  if not im.Begin('Vehicle Configuration', openPtr) then
    im.End()
    if not openPtr[0] then isOpen = false end
    return
  end

  im.Text('Installed Parts')
  im.Separator()
  for _, part in ipairs(uiState.vehicleParts) do
    im.Text(part.name)
    im.SameLine()
    if im.Button('Remove##' .. part.slot) then
      removePart(part.slot)
    end
  end

  im.Spacing()
  im.Text('Stored Parts')
  im.Separator()
  for _, part in ipairs(uiState.inventory) do
    if part.vehicleModel == uiState.currentVehicleModel then
      im.Text(part.name)
      im.SameLine()
      if im.Button('Install##' .. part.id) then
        installPart(part.id)
      end
    end
  end

  im.End()
  if not openPtr[0] then isOpen = false end
end

local function open()
  refreshUI()
  openPtr[0] = true
  isOpen = true
end

M.removePart = removePart
M.installPart = installPart
M.onUpdate = onUpdate
M.open = open

return M

