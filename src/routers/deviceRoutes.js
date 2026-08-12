const express = require("express");
const authenticate = require("../middlewares/auth");
const requireManagerSubscription = require("../middlewares/requireManagerSubscription");
const { createDevice, getAllDevices, getSingleDevice, getDevicesByVenue, updateDevice, deleteDevice, manualButtonForTriggerDevice, getDevicesByVersion, getMyDevices, updateAcSettings, getAcBrandOptions } = require("../controllers/deviceController");
const { downloadSensorData } = require("../controllers/sensorDownloadController");
const checkManagePermission = require("../middlewares/checkPermission");
const router = express.Router();

const managerGate = [authenticate, requireManagerSubscription];

router.post("/create", ...managerGate, checkManagePermission(), createDevice);
router.get("/all", ...managerGate, getAllDevices);
router.get("/ac-brands", ...managerGate, getAcBrandOptions);
router.get("/single/:id", ...managerGate, getSingleDevice);
router.get("/get-by-venue/:venueId", ...managerGate, getDevicesByVenue);
router.get("/by-version/:version", ...managerGate, getDevicesByVersion);
router.get("/my-devices", ...managerGate, getMyDevices);
router.get("/:deviceId/sensor-download", ...managerGate, downloadSensorData);
router.put("/update/:id", ...managerGate, updateDevice);
router.delete("/delete/:id", ...managerGate, deleteDevice);

router.put("/manual-trigger/:deviceId", ...managerGate, manualButtonForTriggerDevice);
router.put("/ac-settings/:deviceId", ...managerGate, updateAcSettings);

module.exports = router;
