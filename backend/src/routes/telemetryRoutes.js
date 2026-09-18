const express = require("express");
const { listTelemetry, listSensors } = require("../services/telemetryService");
const router = express.Router();

router.get("/telemetry", async (req, res) => {
  try { res.json(await listTelemetry()); } catch { res.status(500).json({ message: "Cannot query telemetry" }); }
});
router.get("/telemetry/:tripId", async (req, res) => {
  try { res.json(await listTelemetry(req.params.tripId)); } catch { res.status(500).json({ message: "Cannot query telemetry" }); }
});
router.get("/sensors", async (req, res) => {
  try { res.json(await listSensors()); } catch { res.status(500).json({ message: "Cannot query sensors" }); }
});
module.exports = router;
