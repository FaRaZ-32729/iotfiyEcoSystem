const express = require("express");
const authenticate = require("../middlewares/auth");
const { createDevice, getAllDevices, getSingleDevice, getDevicesByVenue, updateDevice, deleteDevice } = require("../controllers/deviceController");
const checkManagePermission = require("../middlewares/checkPermission");
const router = express.Router();

router.post("/create", authenticate, checkManagePermission(), createDevice);
router.get("/all", getAllDevices);
router.get("/single/:id", getSingleDevice);
router.get("/get-by-venue/:venueId", getDevicesByVenue);
router.put("/update/:id", updateDevice);
router.delete("/delete/:id", deleteDevice);

module.exports = router;