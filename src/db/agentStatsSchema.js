import connectDB from './index.js';
import { AGENT_STATS_POLL_INTERVAL_SECONDS } from '../config/agentStatsConfig.js';

export const ensureAgentStatsTables = async () => {
    const pool = connectDB();
    const connection = await pool.getConnection();

    try {
        await connection.query(`
            CREATE TABLE IF NOT EXISTS agent_stats_api_configs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                business_center_id INT NOT NULL,
                tenant_name VARCHAR(100) DEFAULT NULL,
                base_url VARCHAR(255) DEFAULT NULL,
                x_account_id VARCHAR(255) DEFAULT NULL,
                login_x_account_id VARCHAR(255) DEFAULT NULL,
                poll_interval_seconds INT NOT NULL DEFAULT ${AGENT_STATS_POLL_INTERVAL_SECONDS},
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
            )
        `);

        await connection.query(`
            ALTER TABLE agent_stats_api_configs
                MODIFY tenant_name VARCHAR(100) DEFAULT NULL,
                MODIFY base_url VARCHAR(255) DEFAULT NULL,
                MODIFY x_account_id VARCHAR(255) DEFAULT NULL,
                MODIFY poll_interval_seconds INT NOT NULL DEFAULT ${AGENT_STATS_POLL_INTERVAL_SECONDS}
        `);

        await connection.query(`
            UPDATE agent_stats_api_configs
            SET poll_interval_seconds = ?
            WHERE poll_interval_seconds IS NULL
               OR poll_interval_seconds < ?
        `, [AGENT_STATS_POLL_INTERVAL_SECONDS, AGENT_STATS_POLL_INTERVAL_SECONDS]);

        const [businessUniqueKeys] = await connection.query(`
            SELECT COUNT(*) AS count
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'agent_stats_api_configs'
              AND INDEX_NAME = 'unique_agent_stats_business'
        `);

        if (businessUniqueKeys[0].count === 0) {
            await connection.query(`
                ALTER TABLE agent_stats_api_configs
                ADD UNIQUE KEY unique_agent_stats_business (business_center_id)
            `);
        }

        const [oldTenantKeys] = await connection.query(`
            SELECT COUNT(*) AS count
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'agent_stats_api_configs'
              AND INDEX_NAME = 'unique_agent_stats_business_tenant'
        `);

        if (oldTenantKeys[0].count > 0) {
            await connection.query(`
                ALTER TABLE agent_stats_api_configs
                DROP INDEX unique_agent_stats_business_tenant
            `);
        }

        await connection.query(`
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
            )
        `);

        await connection.query(`
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
            )
        `);

        await connection.query(`
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
            )
        `);
    } finally {
        connection.release();
    }
};
