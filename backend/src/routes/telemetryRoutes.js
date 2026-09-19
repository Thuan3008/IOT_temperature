const express = require("express");
const { listTelemetry, listSensors, getTrip, listAlerts } = require("../services/telemetryService");
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
router.get("/trips/:tripId", async (req, res) => {
  try {
    const trip = await getTrip(req.params.tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    res.json(trip);
  } catch { res.status(500).json({ message: "Cannot query trip" }); }
});
router.get("/alerts", async (req, res) => {
  try { res.json(await listAlerts(req.query.tripId)); } catch { res.status(500).json({ message: "Cannot query alerts" }); }
});
module.exports = router;
