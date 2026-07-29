const express = require("express");
const authenticate = require("../middlewares/auth");
const { createDevice, getAllDevices, getSingleDevice, getDevicesByVenue, updateDevice, deleteDevice, manualButtonForTriggerDevice, getDevicesByVersion, getMyDevices, updateAcSettings, getAcBrandOptions } = require("../controllers/deviceController");
const { downloadSensorData } = require("../controllers/sensorDownloadController");
const checkManagePermission = require("../middlewares/checkPermission");
const router = express.Router();

router.post("/create", authenticate, checkManagePermission(), createDevice);
router.get("/all", getAllDevices);
router.get("/ac-brands", authenticate, getAcBrandOptions);
router.get("/single/:id", getSingleDevice);
router.get("/get-by-venue/:venueId", getDevicesByVenue);
router.get("/by-version/:version", getDevicesByVersion);
router.get("/my-devices", authenticate, getMyDevices);
router.get("/:deviceId/sensor-download", authenticate, downloadSensorData);
router.put("/update/:id", updateDevice);
router.delete("/delete/:id", deleteDevice);

router.put("/manual-trigger/:deviceId", authenticate, manualButtonForTriggerDevice);
router.put("/ac-settings/:deviceId", authenticate, updateAcSettings);

module.exports = router;