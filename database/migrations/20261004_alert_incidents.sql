USE ColdChainDB;
GO

IF COL_LENGTH('dbo.alerts', 'recovered_at') IS NULL
    ALTER TABLE dbo.alerts ADD recovered_at DATETIMEOFFSET NULL;
IF COL_LENGTH('dbo.alerts', 'last_seen_at') IS NULL
    ALTER TABLE dbo.alerts ADD last_seen_at DATETIMEOFFSET NULL;
IF COL_LENGTH('dbo.alerts', 'occurrence_count') IS NULL
    ALTER TABLE dbo.alerts ADD occurrence_count INT NOT NULL CONSTRAINT DF_alerts_occurrence_count DEFAULT 1;
GO

UPDATE dbo.alerts SET last_seen_at = created_at WHERE last_seen_at IS NULL;
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_alerts_last_seen_at' AND parent_object_id = OBJECT_ID('dbo.alerts'))
    ALTER TABLE dbo.alerts ADD CONSTRAINT DF_alerts_last_seen_at DEFAULT SYSDATETIMEOFFSET() FOR last_seen_at;
ALTER TABLE dbo.alerts ALTER COLUMN last_seen_at DATETIMEOFFSET NOT NULL;

-- Legacy rows manually resolved before this migration are closed incidents.
UPDATE dbo.alerts
SET recovered_at = COALESCE(resolved_at, created_at)
WHERE status = 'RESOLVED' AND recovered_at IS NULL;

-- Fold legacy repeated OPEN rows into their oldest incident. The extra rows
-- remain in history as resolved records, so this migration does not delete data.
;WITH duplicate_groups AS (
    SELECT MIN(alert_id) AS keeper_id, COUNT(*) AS copies, MAX(created_at) AS latest_at
    FROM dbo.alerts WHERE recovered_at IS NULL
    GROUP BY trip_id, device_id, sensor_id, alert_type
    HAVING COUNT(*) > 1
)
UPDATE a SET occurrence_count = g.copies, last_seen_at = g.latest_at
FROM dbo.alerts a INNER JOIN duplicate_groups g ON a.alert_id = g.keeper_id;

;WITH ranked AS (
    SELECT alert_id,
        ROW_NUMBER() OVER (PARTITION BY trip_id, device_id, sensor_id, alert_type
                           ORDER BY created_at, alert_id) AS row_num
    FROM dbo.alerts WHERE recovered_at IS NULL
)
UPDATE a SET status = 'RESOLVED', resolved_at = COALESCE(a.resolved_at, a.created_at),
    recovered_at = a.created_at
FROM dbo.alerts a INNER JOIN ranked r ON r.alert_id = a.alert_id
WHERE r.row_num > 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_alerts_active_incident' AND object_id = OBJECT_ID('dbo.alerts'))
    CREATE UNIQUE INDEX UX_alerts_active_incident
    ON dbo.alerts(trip_id, device_id, sensor_id, alert_type)
    WHERE recovered_at IS NULL;
GO
