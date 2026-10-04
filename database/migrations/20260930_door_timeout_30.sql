USE ColdChainDB;
GO
BEGIN TRY
  BEGIN TRANSACTION;

  DECLARE @profileDefault sysname;
  SELECT @profileDefault = dc.name
  FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID('dbo.storage_profiles') AND c.name = 'max_door_open_seconds';
  IF @profileDefault IS NOT NULL
  BEGIN
    DECLARE @dropProfileSql nvarchar(max) = N'ALTER TABLE dbo.storage_profiles DROP CONSTRAINT ' + QUOTENAME(@profileDefault);
    EXEC sp_executesql @dropProfileSql;
  END;
  ALTER TABLE dbo.storage_profiles ADD CONSTRAINT DF_storage_profiles_door DEFAULT 30 FOR max_door_open_seconds;

  DECLARE @tripDefault sysname;
  SELECT @tripDefault = dc.name
  FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID('dbo.trips') AND c.name = 'max_door_open_seconds';
  IF @tripDefault IS NOT NULL
  BEGIN
    DECLARE @dropTripSql nvarchar(max) = N'ALTER TABLE dbo.trips DROP CONSTRAINT ' + QUOTENAME(@tripDefault);
    EXEC sp_executesql @dropTripSql;
  END;
  ALTER TABLE dbo.trips ADD CONSTRAINT DF_trips_door DEFAULT 30 FOR max_door_open_seconds;

  UPDATE dbo.storage_profiles SET max_door_open_seconds = 30 WHERE profile_id = 'VEGETABLE_CHILLED';
  UPDATE dbo.trips SET max_door_open_seconds = 30 WHERE trip_id = 'TRIP001';

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
GO
