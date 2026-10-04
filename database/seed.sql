USE ColdChainDB;
GO
IF NOT EXISTS (SELECT 1 FROM vehicles WHERE license_plate='59C-12345') INSERT vehicles(license_plate,vehicle_name,status) VALUES ('59C-12345',N'Xe tải đông lạnh 01','AVAILABLE');
IF NOT EXISTS (SELECT 1 FROM products WHERE product_id='VEG001') INSERT products(product_id,product_name) VALUES ('VEG001',N'Rau củ tươi');
IF NOT EXISTS (SELECT 1 FROM storage_profiles WHERE profile_id='VEGETABLE_CHILLED') INSERT storage_profiles(profile_id,profile_name,min_temperature,max_temperature,early_warning_minutes,max_door_open_seconds) VALUES ('VEGETABLE_CHILLED',N'Rau củ bảo quản mát',2,8,10,30);
IF NOT EXISTS (SELECT 1 FROM lots WHERE lot_id='LOT-VEG-001') INSERT lots(lot_id,product_id,profile_id,quantity,qr_code) VALUES ('LOT-VEG-001','VEG001','VEGETABLE_CHILLED',100,'LOT-VEG-001');
IF NOT EXISTS (SELECT 1 FROM trips WHERE trip_id='TRIP001') INSERT trips(trip_id,vehicle_id,profile_id,min_temperature,max_temperature,early_warning_minutes,max_door_open_seconds,trip_state,delivery_mode) SELECT 'TRIP001',vehicle_id,'VEGETABLE_CHILLED',3,8,10,30,'IN_TRANSIT',0 FROM vehicles WHERE license_plate='59C-12345';
IF NOT EXISTS (SELECT 1 FROM trip_lots WHERE trip_id='TRIP001' AND lot_id='LOT-VEG-001') INSERT trip_lots(trip_id,lot_id) VALUES ('TRIP001','LOT-VEG-001');
IF NOT EXISTS (SELECT 1 FROM devices WHERE device_id='ESP32-01') INSERT devices(device_id,vehicle_id,device_name,status) SELECT 'ESP32-01',vehicle_id,N'ESP32 giám sát khoang lạnh','ONLINE' FROM vehicles WHERE license_plate='59C-12345';
INSERT sensors(device_id,sensor_id,zone_name,status) SELECT 'ESP32-01',v.sensor_id,v.zone_name,'ONLINE' FROM (VALUES ('S1',N'Gần dàn lạnh'),('S2',N'Phía trước khoang'),('S3',N'Trung tâm khoang'),('S4',N'Gần cửa'),('S5',N'Phía sau khoang')) v(sensor_id,zone_name) WHERE NOT EXISTS (SELECT 1 FROM sensors s WHERE s.device_id='ESP32-01' AND s.sensor_id=v.sensor_id);
GO
