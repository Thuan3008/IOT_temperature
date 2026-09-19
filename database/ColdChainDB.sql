/* =========================================
   SMART COLD CHAIN IOT
   SQL SERVER DATABASE - GIAI DOAN 2
   ========================================= */

-- 1. TAO DATABASE

IF DB_ID(N'ColdChainDB') IS NULL
BEGIN
    CREATE DATABASE ColdChainDB;
END
GO

USE ColdChainDB;
GO


/* =========================================
   2. VEHICLES - PHUONG TIEN
   ========================================= */

CREATE TABLE vehicles (
    vehicle_id INT IDENTITY(1,1) PRIMARY KEY,

    license_plate VARCHAR(20) NOT NULL UNIQUE,

    vehicle_name NVARCHAR(100),

    vehicle_type NVARCHAR(50),

    status VARCHAR(20) NOT NULL
        DEFAULT 'AVAILABLE',

    created_at DATETIME2
        DEFAULT SYSDATETIME()
);
GO


/* =========================================
   3. PRODUCTS - LOAI HANG HOA
   ========================================= */

CREATE TABLE products (
    product_id VARCHAR(30) PRIMARY KEY,

    product_name NVARCHAR(150) NOT NULL,

    description NVARCHAR(500)
);
GO


/* =========================================
   4. STORAGE PROFILES
   ========================================= */

CREATE TABLE storage_profiles (
    profile_id VARCHAR(50) PRIMARY KEY,

    profile_name NVARCHAR(150) NOT NULL,

    min_temperature FLOAT NULL,

    max_temperature FLOAT NOT NULL,

    description NVARCHAR(500),

    CONSTRAINT CK_profile_temp
    CHECK (
        min_temperature IS NULL
        OR min_temperature <= max_temperature
    )
);
GO


/* =========================================
   5. LOTS - LO HANG
   ========================================= */

CREATE TABLE lots (
    lot_id VARCHAR(50) PRIMARY KEY,

    product_id VARCHAR(30) NOT NULL,

    profile_id VARCHAR(50),

    quantity INT,

    qr_code VARCHAR(255) UNIQUE,

    created_at DATETIME2
        DEFAULT SYSDATETIME(),

    FOREIGN KEY (product_id)
        REFERENCES products(product_id),

    FOREIGN KEY (profile_id)
        REFERENCES storage_profiles(profile_id),

    CONSTRAINT CK_lot_quantity
        CHECK (quantity IS NULL OR quantity > 0)
);
GO


/* =========================================
   6. TRIPS - CHUYEN VAN CHUYEN
   ========================================= */

CREATE TABLE trips (
    trip_id VARCHAR(30) PRIMARY KEY,

    vehicle_id INT NOT NULL,

    profile_id VARCHAR(50) NOT NULL,

    -- Nguong nhiet do thuc te
    min_temperature FLOAT NULL,

    max_temperature FLOAT NOT NULL,

    early_warning_minutes INT NOT NULL
        DEFAULT 10,

    max_door_open_seconds INT NOT NULL
        DEFAULT 120,

    -- IDLE, ARMED, IN_TRANSIT, COMPLETED
    trip_state VARCHAR(20) NOT NULL
        DEFAULT 'IDLE',

    -- Delivery Mode ON/OFF
    delivery_mode BIT NOT NULL
        DEFAULT 0,

    start_time DATETIMEOFFSET,

    end_time DATETIMEOFFSET,

    created_at DATETIME2
        DEFAULT SYSDATETIME(),

    FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(vehicle_id),

    FOREIGN KEY (profile_id)
        REFERENCES storage_profiles(profile_id),

    CONSTRAINT CK_trip_temperature
    CHECK (
        min_temperature IS NULL
        OR min_temperature <= max_temperature
    ),

    CONSTRAINT CK_trip_state
    CHECK (
        trip_state IN (
            'IDLE',
            'ARMED',
            'IN_TRANSIT',
            'COMPLETED'
        )
    ),

    CONSTRAINT CK_trip_warning
        CHECK (early_warning_minutes > 0),

    CONSTRAINT CK_trip_door_duration
        CHECK (max_door_open_seconds > 0)
);
GO


/* =========================================
   7. TRIP LOTS
   GAN LO HANG VAO CHUYEN
   ========================================= */

CREATE TABLE trip_lots (
    trip_id VARCHAR(30) NOT NULL,

    lot_id VARCHAR(50) NOT NULL,

    assigned_at DATETIME2
        DEFAULT SYSDATETIME(),

    PRIMARY KEY (trip_id, lot_id),

    FOREIGN KEY (trip_id)
        REFERENCES trips(trip_id),

    FOREIGN KEY (lot_id)
        REFERENCES lots(lot_id)
);
GO


/* =========================================
   8. DEVICES - ESP32
   ========================================= */

CREATE TABLE devices (
    device_id VARCHAR(50) PRIMARY KEY,

    vehicle_id INT,

    device_name NVARCHAR(100),

    -- ONLINE / OFFLINE
    status VARCHAR(20) NOT NULL
        DEFAULT 'OFFLINE',

    last_seen DATETIMEOFFSET,

    created_at DATETIME2
        DEFAULT SYSDATETIME(),

    FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(vehicle_id),

    CONSTRAINT CK_device_status
        CHECK (status IN ('ONLINE', 'OFFLINE'))
);
GO


/* =========================================
   9. SENSORS - CAM BIEN S1-S5
   ========================================= */

CREATE TABLE sensors (
    device_id VARCHAR(50) NOT NULL,

    sensor_id VARCHAR(20) NOT NULL,

    zone_name NVARCHAR(100),

    sensor_type VARCHAR(30)
        DEFAULT 'DHT22',

    -- ONLINE / OFFLINE / FAULT
    status VARCHAR(20) NOT NULL
        DEFAULT 'OFFLINE',

    last_seen DATETIMEOFFSET,

    PRIMARY KEY (device_id, sensor_id),

    FOREIGN KEY (device_id)
        REFERENCES devices(device_id),

    CONSTRAINT CK_sensor_status
    CHECK (
        status IN (
            'ONLINE',
            'OFFLINE',
            'FAULT'
        )
    )
);
GO


/* =========================================
   10. TELEMETRY PACKETS
   LUU THONG TIN CHUNG CUA JSON
   ========================================= */

CREATE TABLE telemetry_packets (
    packet_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    device_id VARCHAR(50) NOT NULL,

    trip_id VARCHAR(30) NOT NULL,

    -- Optional idempotency key; unique per device when present
    message_id NVARCHAR(100) NULL,

    -- CLOSED / OPEN
    door_status VARCHAR(10),

    latitude FLOAT,

    longitude FLOAT,

    -- Timestamp tu ESP32
    measured_at DATETIMEOFFSET NOT NULL,

    -- Thoi gian Backend nhan du lieu
    received_at DATETIME2 NOT NULL
        DEFAULT SYSUTCDATETIME(),

    -- isBuffered
    is_buffered BIT NOT NULL
        DEFAULT 0,

    message_type VARCHAR(20) NOT NULL
        DEFAULT 'TELEMETRY',

    FOREIGN KEY (device_id)
        REFERENCES devices(device_id),

    FOREIGN KEY (trip_id)
        REFERENCES trips(trip_id),

    CONSTRAINT CK_door_status
    CHECK (
        door_status IS NULL
        OR door_status IN ('OPEN', 'CLOSED')
    ),

    CONSTRAINT CK_latitude
    CHECK (
        latitude IS NULL
        OR latitude BETWEEN -90 AND 90
    ),

    CONSTRAINT CK_longitude
    CHECK (
        longitude IS NULL
        OR longitude BETWEEN -180 AND 180
    ),

    -- Phuc vu rang buoc quan he
    CONSTRAINT UQ_packet_device
        UNIQUE (packet_id, device_id)
);
GO


/* =========================================
   11. SENSOR READINGS
   MOI SENSOR = 1 DONG DU LIEU
   ========================================= */

CREATE TABLE sensor_readings (
    reading_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    packet_id BIGINT NOT NULL,

    device_id VARCHAR(50) NOT NULL,

    sensor_id VARCHAR(20) NOT NULL,

    temperature FLOAT NULL,

    humidity FLOAT NULL,

    sensor_status VARCHAR(20) NOT NULL,

    CONSTRAINT FK_reading_packet
    FOREIGN KEY (packet_id, device_id)
        REFERENCES telemetry_packets(
            packet_id,
            device_id
        ),

    CONSTRAINT FK_reading_sensor
    FOREIGN KEY (device_id, sensor_id)
        REFERENCES sensors(
            device_id,
            sensor_id
        ),

    CONSTRAINT UQ_packet_sensor
        UNIQUE (packet_id, sensor_id),

    CONSTRAINT CK_humidity
    CHECK (
        humidity IS NULL
        OR humidity BETWEEN 0 AND 100
    ),

    CONSTRAINT CK_reading_status
    CHECK (
        sensor_status IN (
            'ONLINE',
            'OFFLINE',
            'FAULT'
        )
    )
);
GO


/* =========================================
   12. ALERTS - CANH BAO
   ========================================= */

CREATE TABLE alerts (
    alert_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    trip_id VARCHAR(30) NOT NULL,

    device_id VARCHAR(50),

    sensor_id VARCHAR(20),

    packet_id BIGINT,

    alert_type VARCHAR(50) NOT NULL,

    temperature FLOAT NULL,

    threshold_value FLOAT NULL,

    message NVARCHAR(500),

    created_at DATETIME2 NOT NULL
        DEFAULT SYSUTCDATETIME(),

    FOREIGN KEY (trip_id)
        REFERENCES trips(trip_id),

    FOREIGN KEY (device_id)
        REFERENCES devices(device_id),

    FOREIGN KEY (device_id, sensor_id)
        REFERENCES sensors(device_id, sensor_id),

    FOREIGN KEY (packet_id)
        REFERENCES telemetry_packets(packet_id)
);
GO


/* =========================================
   13. INDEXES
   TOI UU TRUY VAN LICH SU
   ========================================= */

CREATE INDEX IX_telemetry_trip_time
ON telemetry_packets(trip_id, measured_at);
GO

CREATE INDEX IX_telemetry_device_time
ON telemetry_packets(device_id, measured_at);
GO

CREATE UNIQUE INDEX UX_telemetry_device_message_id
ON telemetry_packets(device_id, message_id)
WHERE message_id IS NOT NULL;
GO

CREATE INDEX IX_readings_sensor
ON sensor_readings(device_id, sensor_id);
GO

CREATE INDEX IX_alerts_trip_time
ON alerts(trip_id, created_at);
GO



USE ColdChainDB;
GO

-- Phuong tien
INSERT INTO vehicles (
    license_plate,
    vehicle_name,
    status
)
VALUES (
    '59C-12345',
    N'Xe tai dong lanh 01',
    'AVAILABLE'
);


-- Loai hang
INSERT INTO products (
    product_id,
    product_name
)
VALUES (
    'VEG001',
    N'Rau cu tuoi'
);


-- Storage Profile
INSERT INTO storage_profiles (
    profile_id,
    profile_name,
    min_temperature,
    max_temperature
)
VALUES (
    'VEGETABLE_CHILLED',
    N'Rau cu bao quan mat',
    2.0,
    8.0
);


-- Lo hang
INSERT INTO lots (
    lot_id,
    product_id,
    profile_id,
    quantity,
    qr_code
)
VALUES (
    'LOT-VEG-001',
    'VEG001',
    'VEGETABLE_CHILLED',
    100,
    'LOT-VEG-001'
);


-- Chuyen van chuyen
INSERT INTO trips (
    trip_id,
    vehicle_id,
    profile_id,
    min_temperature,
    max_temperature,
    early_warning_minutes,
    max_door_open_seconds,
    trip_state,
    delivery_mode
)
VALUES (
    'TRIP001',
    (
        SELECT vehicle_id
        FROM vehicles
        WHERE license_plate = '59C-12345'
    ),
    'VEGETABLE_CHILLED',
    3.0,
    8.0,
    10,
    120,
    'IN_TRANSIT',
    0
);


-- Gan lo hang vao chuyen
INSERT INTO trip_lots (
    trip_id,
    lot_id
)
VALUES (
    'TRIP001',
    'LOT-VEG-001'
);


-- ESP32
INSERT INTO devices (
    device_id,
    vehicle_id,
    device_name,
    status
)
VALUES (
    'ESP32-01',
    (
        SELECT vehicle_id
        FROM vehicles
        WHERE license_plate = '59C-12345'
    ),
    N'ESP32 giam sat khoang lanh',
    'ONLINE'
);


-- 5 cam bien
INSERT INTO sensors (
    device_id,
    sensor_id,
    zone_name,
    sensor_type,
    status
)
VALUES
('ESP32-01', 'S1', N'Gan dan lanh', 'DHT22', 'ONLINE'),
('ESP32-01', 'S2', N'Phia truoc khoang', 'DHT22', 'ONLINE'),
('ESP32-01', 'S3', N'Trung tam khoang', 'DHT22', 'ONLINE'),
('ESP32-01', 'S4', N'Gan cua', 'DHT22', 'ONLINE'),
('ESP32-01', 'S5', N'Phia sau khoang', 'DHT22', 'ONLINE');
GO

SELECT name
FROM sys.tables
ORDER BY name;

SELECT *
FROM sensors
WHERE device_id = 'ESP32-01';
