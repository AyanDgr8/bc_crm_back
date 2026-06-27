import connectDB from '../db/index.js';
import { fetchAgentStatsTodayReport, pollAgentStatsConfig } from '../services/agentStatsService.js';
import { AGENT_STATS_POLL_INTERVAL_SECONDS } from '../config/agentStatsConfig.js';

const canAccessBusinessCenter = async (connection, user, businessCenterId) => {
    if (user.role === 'admin') return true;
    if (user.role === 'business_admin' || user.role === 'receptionist') {
        return String(user.business_center_id) === String(businessCenterId);
    }
    if (user.role === 'brand_user') {
        const [rows] = await connection.query(
            'SELECT id FROM business_center WHERE id = ? AND brand_id = ?',
            [businessCenterId, user.brand_id]
        );
        return rows.length > 0;
    }
    return false;
};

export const listAgentStatsConfigs = async (req, res) => {
    const pool = connectDB();
    const connection = await pool.getConnection();
    try {
        let query = `
            SELECT c.*, bc.business_name
            FROM agent_stats_api_configs c
            JOIN business_center bc ON bc.id = c.business_center_id
        `;
        const params = [];

        if (req.user.role === 'business_admin') {
            query += ' WHERE c.business_center_id = ?';
            params.push(req.user.business_center_id);
        } else if (req.user.role === 'brand_user') {
            query += ' WHERE bc.brand_id = ?';
            params.push(req.user.brand_id);
        } else if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        query += ' ORDER BY c.created_at DESC';
        const [rows] = await connection.query(query, params);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching agent stats configs', error: error.message });
    } finally {
        connection.release();
    }
};

export const upsertAgentStatsConfig = async (req, res) => {
    const pool = connectDB();
    const connection = await pool.getConnection();
    try {
        const {
            business_center_id,
            tenant_name,
            base_url,
            x_account_id,
            login_x_account_id,
            lookback_seconds = 3600,
            is_active = true
        } = req.body;

        const cleanTenantName = String(tenant_name || '').trim();
        const cleanBaseUrl = String(base_url || '').trim().replace(/\/+$/, '');
        const cleanAccountId = String(x_account_id || '').trim();
        const hasAnyApiDetail = Boolean(cleanTenantName || cleanBaseUrl || cleanAccountId);
        const hasAllApiDetails = Boolean(cleanTenantName && cleanBaseUrl && cleanAccountId);
        const isClearingConfig = !hasAnyApiDetail;

        if (!business_center_id) {
            return res.status(400).json({
                message: 'business_center_id is required'
            });
        }

        if (hasAnyApiDetail && !hasAllApiDetails) {
            return res.status(400).json({
                message: 'Tenant, Base API URL and Report X-Account-Id are all required when adding API details'
            });
        }

        const hasAccess = await canAccessBusinessCenter(connection, req.user, business_center_id);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied to this business center' });
        }

        const [result] = await connection.query(
            `INSERT INTO agent_stats_api_configs
                (business_center_id, tenant_name, base_url, x_account_id, login_x_account_id,
                 poll_interval_seconds, lookback_seconds, is_active, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                base_url = VALUES(base_url),
                x_account_id = VALUES(x_account_id),
                login_x_account_id = IF(
                    VALUES(tenant_name) IS NULL
                    AND VALUES(base_url) IS NULL
                    AND VALUES(x_account_id) IS NULL,
                    NULL,
                    COALESCE(VALUES(login_x_account_id), login_x_account_id)
                ),
                poll_interval_seconds = VALUES(poll_interval_seconds),
                lookback_seconds = VALUES(lookback_seconds),
                is_active = VALUES(is_active),
                updated_at = CURRENT_TIMESTAMP`,
            [
                business_center_id,
                isClearingConfig ? null : cleanTenantName,
                isClearingConfig ? null : cleanBaseUrl,
                isClearingConfig ? null : cleanAccountId,
                isClearingConfig ? null : login_x_account_id || null,
                AGENT_STATS_POLL_INTERVAL_SECONDS,
                Number(lookback_seconds) || 3600,
                isClearingConfig ? 0 : is_active ? 1 : 0,
                req.user.userId
            ]
        );

        res.status(200).json({
            message: isClearingConfig ? 'Agent stats API config cleared' : 'Agent stats API config saved',
            id: result.insertId || null
        });
    } catch (error) {
        res.status(500).json({ message: 'Error saving agent stats config', error: error.message });
    } finally {
        connection.release();
    }
};

export const pollAgentStatsConfigNow = async (req, res) => {
    const pool = connectDB();
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query(
            'SELECT * FROM agent_stats_api_configs WHERE id = ?',
            [req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Config not found' });
        }

        const config = rows[0];
        const hasAccess = await canAccessBusinessCenter(connection, req.user, config.business_center_id);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied to this config' });
        }

        const result = await pollAgentStatsConfig(config);
        res.json({ message: 'Agent stats polled successfully', ...result });
    } catch (error) {
        res.status(500).json({ message: 'Error polling agent stats', error: error.message });
    } finally {
        connection.release();
    }
};

export const pollAgentStatsBusinessNow = async (req, res) => {
    const pool = connectDB();
    const connection = await pool.getConnection();
    try {
        const requestedBusinessCenterId = req.body?.businessCenterId || req.query?.businessCenterId;
        const businessCenterId = requestedBusinessCenterId
            || (['business_admin', 'receptionist'].includes(req.user.role) ? req.user.business_center_id : null);

        let rows = [];

        if (businessCenterId) {
            const hasAccess = await canAccessBusinessCenter(connection, req.user, businessCenterId);
            if (!hasAccess) {
                return res.status(403).json({ message: 'Access denied to this business center' });
            }

            [rows] = await connection.query(
                `SELECT *
                 FROM agent_stats_api_configs
                 WHERE business_center_id = ?
                   AND is_active = 1
                   AND tenant_name IS NOT NULL
                   AND base_url IS NOT NULL
                   AND x_account_id IS NOT NULL
                 LIMIT 1`,
                [businessCenterId]
            );
        } else if (req.user.role === 'admin') {
            [rows] = await connection.query(
                `SELECT *
                 FROM agent_stats_api_configs
                 WHERE is_active = 1
                   AND tenant_name IS NOT NULL
                   AND base_url IS NOT NULL
                   AND x_account_id IS NOT NULL`
            );
        } else if (req.user.role === 'brand_user') {
            [rows] = await connection.query(
                `SELECT c.*
                 FROM agent_stats_api_configs c
                 JOIN business_center bc ON bc.id = c.business_center_id
                 WHERE bc.brand_id = ?
                   AND c.is_active = 1
                   AND c.tenant_name IS NOT NULL
                   AND c.base_url IS NOT NULL
                   AND c.x_account_id IS NOT NULL`,
                [req.user.brand_id]
            );
        } else {
            return res.status(400).json({ message: 'businessCenterId is required' });
        }

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Active agent stats config not found' });
        }

        const results = [];
        for (const config of rows) {
            const result = await pollAgentStatsConfig(config);
            results.push({ configId: config.id, businessCenterId: config.business_center_id, ...result });
        }

        res.json({
            message: 'Agent stats refreshed successfully',
            refreshedConfigs: results.length,
            results
        });
    } catch (error) {
        res.status(500).json({ message: 'Error refreshing agent stats', error: error.message });
    } finally {
        connection.release();
    }
};

export const getAgentStatsFinalReports = async (req, res) => {
    const pool = connectDB();
    const connection = await pool.getConnection();
    try {
        const { businessCenterId, extension, limit = 100 } = req.query;
        let query = `
            SELECT
                fr.*,
                bc.business_name,
                registered_extensions.registered_company_name,
                registered_extensions.registered_agent_name,
                registered_extensions.registered_agent_email
            FROM agent_stats_final_reports fr
            JOIN business_center bc ON bc.id = fr.business_center_id
            JOIN (
                SELECT
                    t.business_center_id,
                    TRIM(tm.extension) AS extension,
                    MIN(t.team_name) AS registered_company_name,
                    MIN(tm.username) AS registered_agent_name,
                    MIN(tm.email) AS registered_agent_email
                FROM team_members tm
                JOIN teams t ON t.id = tm.team_id
                WHERE tm.extension IS NOT NULL
                  AND TRIM(tm.extension) <> ''
                GROUP BY t.business_center_id, TRIM(tm.extension)
            ) registered_extensions
                ON registered_extensions.business_center_id = fr.business_center_id
               AND registered_extensions.extension = TRIM(fr.extension)
            WHERE 1=1
        `;
        const params = [];

        if (businessCenterId) {
            const hasAccess = await canAccessBusinessCenter(connection, req.user, businessCenterId);
            if (!hasAccess) {
                return res.status(403).json({ message: 'Access denied to this business center' });
            }
            query += ' AND fr.business_center_id = ?';
            params.push(businessCenterId);
        } else if (req.user.role === 'business_admin' || req.user.role === 'receptionist') {
            if (!req.user.business_center_id) {
                return res.status(403).json({ message: 'Business center access required' });
            }
            query += ' AND fr.business_center_id = ?';
            params.push(req.user.business_center_id);
        } else if (req.user.role === 'brand_user') {
            query += ' AND bc.brand_id = ?';
            params.push(req.user.brand_id);
        } else if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        if (extension) {
            query += ' AND fr.extension = ?';
            params.push(extension);
        }

        query += ' ORDER BY fr.fetched_at DESC LIMIT ?';
        params.push(Math.min(Number(limit) || 100, 500));

        const [rows] = await connection.query(query, params);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching final agent stats', error: error.message });
    } finally {
        connection.release();
    }
};

export const getAgentStatsTodaySummary = async (req, res) => {
    const pool = connectDB();
    const connection = await pool.getConnection();
    try {
        const requestedBusinessCenterId = req.query?.businessCenterId;
        const businessCenterId = requestedBusinessCenterId
            || (['business_admin', 'receptionist'].includes(req.user.role) ? req.user.business_center_id : null);

        if (!businessCenterId) {
            return res.status(400).json({ message: 'businessCenterId is required' });
        }

        const hasAccess = await canAccessBusinessCenter(connection, req.user, businessCenterId);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied to this business center' });
        }

        const [configs] = await connection.query(
            `SELECT *
             FROM agent_stats_api_configs
             WHERE business_center_id = ?
               AND is_active = 1
               AND tenant_name IS NOT NULL
               AND base_url IS NOT NULL
               AND x_account_id IS NOT NULL
             LIMIT 1`,
            [businessCenterId]
        );

        if (configs.length === 0) {
            return res.status(404).json({ message: 'Active agent stats config not found' });
        }

        const [registeredRows] = await connection.query(
            `SELECT DISTINCT TRIM(tm.extension) AS extension
             FROM team_members tm
             JOIN teams t ON t.id = tm.team_id
             WHERE t.business_center_id = ?
               AND tm.extension IS NOT NULL
               AND TRIM(tm.extension) <> ''`,
            [businessCenterId]
        );

        const registeredExtensions = new Set(registeredRows.map((row) => String(row.extension || '').trim()));
        const todayReport = await fetchAgentStatsTodayReport(configs[0]);
        let totalCalls = 0;

        Object.entries(todayReport.data).forEach(([extension, stats]) => {
            const cleanExtension = String(extension || '').trim();
            if (!registeredExtensions.has(cleanExtension)) return;
            totalCalls += Number(stats?.total_calls || 0);
        });

        res.json({
            businessCenterId,
            totalCalls,
            startEpoch: todayReport.startEpoch,
            endEpoch: todayReport.endEpoch
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching today agent stats summary', error: error.message });
    } finally {
        connection.release();
    }
};
