-- src/db/schema.sql

-- Create admin table (single user)
CREATE TABLE IF NOT EXISTS admin (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Brand table (must be created first due to foreign key references)
CREATE TABLE IF NOT EXISTS brand (
    id INT AUTO_INCREMENT PRIMARY KEY,
    brand_name VARCHAR(100) NOT NULL,
    brand_phone VARCHAR(15),
    brand_email VARCHAR(100) UNIQUE,
    brand_password VARCHAR(255),
    brand_person VARCHAR(100),
    centers INT,
    companies INT,
    associates INT,
    receptionist INT,
    brand_tax_id VARCHAR(50),
    brand_reg_no VARCHAR(50),
    brand_other_detail TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create business_center table
CREATE TABLE IF NOT EXISTS business_center (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_name VARCHAR(100) NOT NULL,
    business_phone VARCHAR(15),
    business_whatsapp VARCHAR(15),
    business_email VARCHAR(100),
    business_password VARCHAR(255),
    business_person VARCHAR(100),
    business_address TEXT,
    business_country VARCHAR(50),
    business_tax_id VARCHAR(50),
    business_reg_no VARCHAR(50),
    other_detail TEXT,
    brand_id INT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (brand_id) REFERENCES brand(id) ON DELETE CASCADE
);

-- Create teams
CREATE TABLE IF NOT EXISTS teams (
    id INT PRIMARY KEY AUTO_INCREMENT,
    team_name VARCHAR(50) NOT NULL,
    team_extension VARCHAR(50) NOT NULL,
    tax_id VARCHAR(50) DEFAULT NULL,
    reg_no VARCHAR(50) DEFAULT NULL,
    team_detail TEXT DEFAULT NULL,
    team_address text DEFAULT NULL,
    team_country varchar(50) DEFAULT NULL,
    team_prompt VARCHAR(500) DEFAULT NULL,
    team_phone VARCHAR(15) DEFAULT NULL,
    team_email VARCHAR(100) DEFAULT NULL,
    team_type ENUM('company', 'department') NOT NULL DEFAULT 'company',
    business_center_id INT NOT NULL,
    brand_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NOT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (business_center_id) REFERENCES business_center(id) ON DELETE CASCADE,
    FOREIGN KEY (brand_id) REFERENCES brand(id) ON DELETE CASCADE,
    UNIQUE KEY unique_team_business (team_name, business_center_id),
    UNIQUE KEY unique_team_brand (team_name, brand_id)
);

-- Create team_members (users)
CREATE TABLE IF NOT EXISTS team_members (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL,
    department VARCHAR(100) DEFAULT NULL,
    email VARCHAR(100) NOT NULL,
    mobile_num VARCHAR(15) NOT NULL,
    mobile_num_2 VARCHAR(15) DEFAULT NULL,
    designation VARCHAR(30) DEFAULT NULL,
    team_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    UNIQUE KEY unique_username_team (username, team_id),
    UNIQUE KEY unique_team_email (team_id, email),
    UNIQUE KEY unique_team_mobile (team_id, mobile_num)
);

-- Create login_history table
CREATE TABLE `login_history` (
    `id` int NOT NULL AUTO_INCREMENT,
    `entity_type` ENUM('admin', 'brand_user', 'receptionist') NOT NULL,
    `entity_id` int NOT NULL,
    `device_id` varchar(255) NOT NULL,
    `is_active` tinyint(1) DEFAULT '1',
    `login_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    `logout_time` timestamp NULL DEFAULT NULL,
    `last_activity` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `entity_type_id` (`entity_type`, `entity_id`)
);

-- Create customers
CREATE TABLE `customers` (
    `id` int NOT NULL AUTO_INCREMENT,
    `customer_name` varchar(100) DEFAULT NULL,
    `phone_no_primary` varchar(15) DEFAULT NULL,
    `phone_no_secondary` varchar(15) DEFAULT NULL,
    `email_id` varchar(100) DEFAULT NULL,
    `address` text DEFAULT NULL,
    `country` varchar(15) DEFAULT NULL,
    `designation` varchar(50) DEFAULT NULL,
    `disposition` varchar(50) DEFAULT 'interested',
    `QUEUE_NAME` varchar(50) DEFAULT NULL,
    `comment` text DEFAULT NULL,
    `date_created` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    `C_unique_id` varchar(50) DEFAULT NULL,
    `last_updated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `team_id` INT NOT NULL,
    `agent_name` varchar(50) DEFAULT NULL,
    `scheduled_at` datetime DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `unique_team_customer_id` (`team_id`, `C_unique_id`),
    KEY `agent_name_team` (`agent_name`, `team_id`),
    CONSTRAINT `customers_team_fk` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`),
    CONSTRAINT `customers_agent_fk` FOREIGN KEY (`agent_name`, `team_id`) 
        REFERENCES `team_members` (`username`, `team_id`) ON UPDATE CASCADE
);

-- Create customer_field_values table
CREATE TABLE IF NOT EXISTS customer_field_values (
    id INT PRIMARY KEY AUTO_INCREMENT,
    field_name VARCHAR(50) NOT NULL,
    field_value VARCHAR(100) NOT NULL,
    UNIQUE KEY unique_field_value (field_name, field_value)
);

-- Create instances table
CREATE TABLE IF NOT EXISTS instances (
    id INT AUTO_INCREMENT,
    instance_id VARCHAR(255) NOT NULL,
    register_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'disconnected',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_instance_id (instance_id),
    FOREIGN KEY (register_id) REFERENCES admin(email) ON DELETE CASCADE,
    UNIQUE KEY unique_register_id (register_id)
);

-- Create trigger to automatically generate instance_id from admin's name
DELIMITER //
CREATE TRIGGER before_instance_insert 
BEFORE INSERT ON instances
FOR EACH ROW
BEGIN
    DECLARE first_name VARCHAR(255);
    SELECT SUBSTRING_INDEX(name, ' ', 1) INTO first_name
    FROM admin 
    WHERE email = NEW.register_id;
    
    SET NEW.instance_id = first_name;
END//
DELIMITER ;

-- Insert default values for disposition
INSERT INTO customer_field_values (field_name, field_value) VALUES 
('disposition', 'call_back'),
('disposition', 'schedule_visit'),
('disposition', 'office_visit'),
('disposition', 'urgent_required'),
('disposition', 'interested'),
('disposition', 'utility_call'),
('disposition', 'emergency');

-- Create updates_customer
CREATE TABLE `updates_customer` (
    `id` int NOT NULL AUTO_INCREMENT,
    `customer_id` int NOT NULL,
    `C_unique_id` varchar(50) NOT NULL,
    `field` varchar(255) NOT NULL,
    `old_value` text,
    `new_value` text,
    `changed_at` datetime DEFAULT CURRENT_TIMESTAMP,
    `phone_no_primary` varchar(15) DEFAULT NULL,
    `changed_by` varchar(100) NOT NULL,
    `team_id` INT NOT NULL,
    PRIMARY KEY (`id`),
    KEY `customer_id` (`customer_id`),
    KEY `changed_by_team` (`changed_by`, `team_id`),
    CONSTRAINT `updates_customer_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
    CONSTRAINT `updates_customer_team_fk` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`),
    CONSTRAINT `updates_customer_agent_fk` FOREIGN KEY (`changed_by`, `team_id`) 
        REFERENCES `team_members` (`username`, `team_id`) ON UPDATE CASCADE
);

-- Drop the foreign key constraint
ALTER TABLE updates_customer 
DROP FOREIGN KEY updates_customer_agent_fk;

-- ******************
-- Create scheduler table
CREATE TABLE `scheduler` (
    `id` int NOT NULL AUTO_INCREMENT,
    `customer_id` int NOT NULL,
    `scheduled_at` datetime NOT NULL,
    `created_by` int NOT NULL,
    `assigned_to` varchar(100) NOT NULL,
    `team_id` INT NOT NULL,
    `description` text,
    `status` ENUM('pending', 'completed', 'cancelled') DEFAULT 'pending',
    `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `customer_id` (`customer_id`),
    KEY `created_by` (`created_by`),
    KEY `assigned_team` (`assigned_to`, `team_id`),
    CONSTRAINT `scheduler_customer_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE,
    CONSTRAINT `scheduler_created_fk` FOREIGN KEY (`created_by`) REFERENCES `team_members` (`id`),
    CONSTRAINT `scheduler_team_fk` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`),
    CONSTRAINT `scheduler_assigned_fk` FOREIGN KEY (`assigned_to`, `team_id`) 
        REFERENCES `team_members` (`username`, `team_id`) ON UPDATE CASCADE
);

-- Migrate existing reminders from customers table to scheduler
INSERT INTO scheduler (customer_id, scheduled_at, created_by, assigned_to, team_id)
SELECT 
    c.id as customer_id,
    c.scheduled_at,
    tm.id as created_by,
    tm.username as assigned_to,
    c.team_id
FROM customers c
JOIN team_members tm ON tm.username = c.agent_name AND tm.team_id = c.team_id
WHERE c.scheduled_at IS NOT NULL;

-- *************

DELIMITER //

DROP TRIGGER IF EXISTS after_customers_scheduled_at_update//

CREATE TRIGGER after_customers_scheduled_at_update 
AFTER UPDATE ON customers 
FOR EACH ROW 
BEGIN
    DECLARE agent_id INT;
    DECLARE existing_id INT;
    
    -- Only create scheduler entry if scheduled_at is changed to a non-null value
    IF NEW.scheduled_at IS NOT NULL AND 
       (OLD.scheduled_at IS NULL OR NEW.scheduled_at <> OLD.scheduled_at) THEN 
        
        -- Try to find the user ID for the agent_name
        -- This ensures we have a valid user ID for the created_by field
        SELECT id INTO agent_id FROM team_members WHERE username = NEW.agent_name LIMIT 1;
        
        -- If we can't find the agent, use the first admin user as a fallback
        IF agent_id IS NULL THEN
            SELECT id INTO agent_id FROM team_members LIMIT 1; 
        END IF;
        
        -- Check if there's an existing pending scheduler entry for this customer
        SELECT id INTO existing_id FROM scheduler 
        WHERE customer_id = NEW.id AND status = 'pending' LIMIT 1;
        
        IF existing_id IS NOT NULL THEN
            -- Update existing scheduler entry
            UPDATE scheduler SET
                scheduled_at = NEW.scheduled_at,
                updated_at = NOW()
            WHERE id = existing_id;
        ELSE
            -- Create new scheduler entry
            INSERT INTO scheduler (
                customer_id,
                scheduled_at,
                created_by,
                assigned_to,
                team_id,
                description,
                status
            ) VALUES (
                NEW.id,
                NEW.scheduled_at,
                agent_id,           -- Use the agent's ID or admin ID as fallback
                NEW.agent_name,     -- The agent to whom it is assigned
                NEW.team_id,
                CONCAT('Scheduled call with ', NEW.customer_name),
                'pending'
            );
        END IF;
    END IF;
END//

DELIMITER ;

-- ********************
-- ********************
-- ********************
-- 27th ,may 2025
-- ********************
-- ********************
-- ********************



-- Create receptionist table
CREATE TABLE IF NOT EXISTS receptionist (
    id INT AUTO_INCREMENT PRIMARY KEY,
    receptionist_name VARCHAR(100) NOT NULL,
    receptionist_phone VARCHAR(15),
    receptionist_email VARCHAR(100),
    rec_other_detail TEXT,
    business_center_id INT NOT NULL,
    brand_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (business_center_id) REFERENCES business_center(id) ON DELETE CASCADE,
    FOREIGN KEY (brand_id) REFERENCES brand(id) ON DELETE CASCADE
);

DELIMITER $$

DROP TRIGGER IF EXISTS before_receptionist_insert$$

CREATE TRIGGER before_receptionist_insert
BEFORE INSERT ON receptionist
FOR EACH ROW
BEGIN
    DECLARE bc_brand_id INT;
    
    -- Get brand_id from business_center
    SELECT brand_id INTO bc_brand_id
    FROM business_center 
    WHERE id = NEW.business_center_id;
    
    -- Set the brand_id
    SET NEW.brand_id = bc_brand_id;
END$$

DROP TRIGGER IF EXISTS after_receptionist_insert$$

CREATE TRIGGER after_receptionist_insert
AFTER INSERT ON receptionist
FOR EACH ROW
BEGIN
    -- Create user account for receptionist
    INSERT INTO users (
        username,
        email,
        password,
        role_id,
        business_center_id,
        brand_id
    )
    SELECT 
        NEW.receptionist_name,
        NEW.receptionist_email,
        '$2b$10$vB8FzjqZ.XmA1mJs4SANpeI2LK9GrORmUgU2Pgwb5oTRZTVkinhry', -- Hashed version of '12345678'
        r.id,
        NEW.business_center_id,
        NEW.brand_id
    FROM roles r
    WHERE r.role_name = 'receptionist';
END$$

DROP TRIGGER IF EXISTS update_receptionist_modtime$$

CREATE TRIGGER update_receptionist_modtime
BEFORE UPDATE ON receptionist
FOR EACH ROW
BEGIN
    DECLARE bc_brand_id INT;
    
    SET NEW.updated_at = CURRENT_TIMESTAMP;
    
    -- If business_center_id changes, update brand_id
    IF NEW.business_center_id != OLD.business_center_id THEN
        SELECT brand_id INTO bc_brand_id
        FROM business_center 
        WHERE id = NEW.business_center_id;
        
        SET NEW.brand_id = bc_brand_id;
    END IF;
END$$

DELIMITER ;

-- ***************
-- ***************
-- ***************
-- ***************
-- ***************


-- Create roles table
CREATE TABLE IF NOT EXISTS roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    role_name ENUM('admin', 'brand_user', 'receptionist') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_role_name (role_name)
);

-- Insert default roles
INSERT INTO roles (role_name) VALUES 
    ('admin'),
    ('brand_user'),
    ('receptionist');

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role_id INT NOT NULL,
    brand_id INT DEFAULT NULL,
    business_center_id INT DEFAULT NULL,
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id),
    FOREIGN KEY (brand_id) REFERENCES brand(id) ON DELETE SET NULL,
    FOREIGN KEY (business_center_id) REFERENCES business_center(id) ON DELETE SET NULL
);

-- Agent stats external API configuration per business center
CREATE TABLE IF NOT EXISTS agent_stats_api_configs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_center_id INT NOT NULL,
    tenant_name VARCHAR(100) NOT NULL,
    base_url VARCHAR(255) NOT NULL,
    x_account_id VARCHAR(255) NOT NULL,
    login_x_account_id VARCHAR(255) DEFAULT NULL,
    poll_interval_seconds INT NOT NULL DEFAULT 300,
    lookback_seconds INT NOT NULL DEFAULT 3600,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    last_polled_at TIMESTAMP NULL DEFAULT NULL,
    last_success_at TIMESTAMP NULL DEFAULT NULL,
    last_error TEXT DEFAULT NULL,
    created_by INT DEFAULT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_agent_stats_business_tenant (business_center_id, tenant_name),
    KEY idx_agent_stats_config_active (is_active),
    CONSTRAINT fk_agent_stats_config_business
        FOREIGN KEY (business_center_id) REFERENCES business_center(id)
        ON DELETE CASCADE
);

-- Raw agent stats API responses, stored exactly as returned
CREATE TABLE IF NOT EXISTS agent_stats_raw_reports (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    config_id INT NOT NULL,
    business_center_id INT NOT NULL,
    tenant_name VARCHAR(100) NOT NULL,
    base_url VARCHAR(255) NOT NULL,
    x_account_id VARCHAR(255) NOT NULL,
    start_epoch BIGINT NOT NULL,
    end_epoch BIGINT NOT NULL,
    fetched_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    raw_data JSON NOT NULL,
    response_status INT DEFAULT NULL,
    CONSTRAINT fk_agent_stats_raw_config
        FOREIGN KEY (config_id) REFERENCES agent_stats_api_configs(id)
        ON DELETE CASCADE,
    KEY idx_agent_stats_raw_config_time (config_id, fetched_at),
    KEY idx_agent_stats_raw_business_time (business_center_id, fetched_at)
);

-- Normalized agent stats rows, one row per extension per fetch
CREATE TABLE IF NOT EXISTS agent_stats_final_reports (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    raw_report_id BIGINT NOT NULL,
    config_id INT NOT NULL,
    business_center_id INT NOT NULL,
    tenant_name VARCHAR(100) NOT NULL,
    extension VARCHAR(50) NOT NULL,
    agent_name VARCHAR(255) DEFAULT NULL,
    tags JSON DEFAULT NULL,
    start_epoch BIGINT NOT NULL,
    end_epoch BIGINT NOT NULL,
    fetched_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    total_calls INT DEFAULT 0,
    answered_calls INT DEFAULT 0,
    total_inbound_calls INT DEFAULT 0,
    answered_inbound_calls INT DEFAULT 0,
    total_outbound_calls INT DEFAULT 0,
    answered_outbound_calls INT DEFAULT 0,
    talked_time INT DEFAULT 0,
    talked_average DECIMAL(12,4) DEFAULT 0,
    duration_seconds INT DEFAULT 0,
    max_connect_seconds INT DEFAULT 0,
    avg_connect_seconds DECIMAL(12,4) DEFAULT 0,
    total_connect_seconds INT DEFAULT 0,
    callee_id_number VARCHAR(100) DEFAULT NULL,
    callee_id_name VARCHAR(255) DEFAULT NULL,
    registered_time INT DEFAULT 0,
    idle_time INT DEFAULT 0,
    wrap_up_time INT DEFAULT 0,
    hold_time INT DEFAULT 0,
    hold_count INT DEFAULT 0,
    on_call_time INT DEFAULT 0,
    on_call_time_avg DECIMAL(12,4) DEFAULT 0,
    not_available_time INT DEFAULT 0,
    not_available_count INT DEFAULT 0,
    not_available_detailed_report JSON DEFAULT NULL,
    utilization_percent DECIMAL(12,6) DEFAULT 0,
    availability_percent DECIMAL(12,6) DEFAULT 0,
    on_call_percent DECIMAL(12,6) DEFAULT 0,
    idle_percent DECIMAL(12,6) DEFAULT 0,
    wrap_up_percent DECIMAL(12,6) DEFAULT 0,
    hold_percent DECIMAL(12,6) DEFAULT 0,
    not_available_percent DECIMAL(12,6) DEFAULT 0,
    dnd_percent DECIMAL(12,6) DEFAULT 0,
    aht DECIMAL(12,4) DEFAULT 0,
    transferred_calls INT DEFAULT 0,
    transfer_rate DECIMAL(12,6) DEFAULT 0,
    callback_calls INT DEFAULT 0,
    callback_rate DECIMAL(12,6) DEFAULT 0,
    repeat_calls INT DEFAULT 0,
    repeat_call_rate DECIMAL(12,6) DEFAULT 0,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_agent_stats_final_raw
        FOREIGN KEY (raw_report_id) REFERENCES agent_stats_raw_reports(id)
        ON DELETE CASCADE,
    KEY idx_agent_stats_final_business_extension (business_center_id, extension),
    KEY idx_agent_stats_final_config_time (config_id, fetched_at)
);

-- Dynamic not_available_detailed_report states, one row per state
CREATE TABLE IF NOT EXISTS agent_stats_not_available_details (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    final_report_id BIGINT NOT NULL,
    raw_report_id BIGINT NOT NULL,
    config_id INT NOT NULL,
    business_center_id INT NOT NULL,
    tenant_name VARCHAR(100) NOT NULL,
    extension VARCHAR(50) NOT NULL,
    agent_name VARCHAR(255) DEFAULT NULL,
    state_name VARCHAR(100) NOT NULL,
    duration_seconds INT NOT NULL DEFAULT 0,
    start_epoch BIGINT NOT NULL,
    end_epoch BIGINT NOT NULL,
    fetched_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_agent_stats_not_available_final
        FOREIGN KEY (final_report_id) REFERENCES agent_stats_final_reports(id)
        ON DELETE CASCADE,
    KEY idx_agent_stats_na_business_extension (business_center_id, extension),
    KEY idx_agent_stats_na_state (state_name)
);

CREATE TABLE IF NOT EXISTS reception_call_transfers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_center_id INT NOT NULL,
    team_id INT DEFAULT NULL,
    team_name VARCHAR(255) DEFAULT NULL,
    member_id INT DEFAULT NULL,
    member_name VARCHAR(255) DEFAULT NULL,
    member_email VARCHAR(255) DEFAULT NULL,
    extension VARCHAR(50) DEFAULT NULL,
    created_by INT DEFAULT NULL,
    date_created TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_reception_transfer_business_time (business_center_id, date_created),
    KEY idx_reception_transfer_team_time (team_id, date_created),
    CONSTRAINT fk_reception_transfer_business
        FOREIGN KEY (business_center_id) REFERENCES business_center(id)
        ON DELETE CASCADE
);

-- Create trigger to handle user creation from brand
DELIMITER $$

DROP TRIGGER IF EXISTS after_brand_insert$$

CREATE TRIGGER after_brand_insert
AFTER INSERT ON brand
FOR EACH ROW
BEGIN
    -- Create user account for brand user with hashed password
    INSERT INTO users (
        username,
        email,
        password,
        role_id,
        brand_id
    )
    SELECT 
        NEW.brand_name,
        NEW.brand_email,
        NEW.brand_password, -- Password will be hashed in the controller
        r.id,
        NEW.id
    FROM roles r
    WHERE r.role_name = 'brand_user';
END$$

DELIMITER ;

-- Table List
-- 1 admin
-- 2 brand
-- 3 business_center
-- 4 customer_field_values
-- 5 customers
-- 6 instances
-- 7 login_history
-- 8 receptionist
-- 9 roles
-- 10 scheduler
-- 11 team_members
-- 12 teams
-- 13 updates_customer
-- 14 users
