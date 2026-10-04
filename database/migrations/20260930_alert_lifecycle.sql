USE ColdChainDB;
GO
IF COL_LENGTH('dbo.alerts', 'status') IS NULL
    ALTER TABLE dbo.alerts ADD status VARCHAR(20) NOT NULL CONSTRAINT DF_alerts_status DEFAULT 'OPEN';
IF COL_LENGTH('dbo.alerts', 'resolved_at') IS NULL
    ALTER TABLE dbo.alerts ADD resolved_at DATETIMEOFFSET NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_alerts_status' AND parent_object_id = OBJECT_ID('dbo.alerts'))
    ALTER TABLE dbo.alerts ADD CONSTRAINT CK_alerts_status CHECK (status IN ('OPEN', 'RESOLVED'));
GO
