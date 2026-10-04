const express = require("express");
const { listTelemetry, listSensors, listDevices, getTrip, listAlerts, resolveAlert } = require("../services/telemetryService");
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
router.get("/devices", async (req, res) => {
  try { res.json(await listDevices()); } catch { res.status(500).json({ message: "Cannot query devices" }); }
});
router.get("/trips/:tripId", async (req, res) => {
  try {
    const trip = await getTrip(req.params.tripId);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    res.json(trip);
  } catch { res.status(500).json({ message: "Cannot query trip" }); }
});
router.get("/alerts", async (req, res) => {
  const status = String(req.query.status || "OPEN").toUpperCase();
  if (!["OPEN", "RESOLVED", "ALL"].includes(status)) return res.status(400).json({ message: "Invalid alert status" });
  try { res.json(await listAlerts(req.query.tripId, status)); } catch { res.status(500).json({ message: "Cannot query alerts" }); }
});
router.patch("/alerts/:alertId/resolve", async (req, res) => {
  const alertId = req.params.alertId;
  if (!/^\d+$/.test(alertId) || alertId === "0") return res.status(400).json({ message: "Invalid alert ID" });
  try {
    const alert = await resolveAlert(alertId);
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    res.json(alert);
  } catch { res.status(500).json({ message: "Cannot resolve alert" }); }
});
module.exports = router;
