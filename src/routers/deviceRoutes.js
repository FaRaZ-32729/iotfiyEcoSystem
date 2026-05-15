const express = require("express");
const authenticate = require("../middlewares/auth");
const { createDevice } = require("../controllers/deviceController");
const router = express.Router();

router.post("/create", authenticate, createDevice);

module.exports = router;