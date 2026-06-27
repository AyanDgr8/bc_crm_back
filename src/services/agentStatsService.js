// src/services/agentStatsService.js

import axios from 'axios';
import https from 'https';
import connectDB from '../db/index.js';
import { logger } from '../logger.js';

const DEFAULT_API_USERNAME = process.env.API_USERNAME || 'reports@multycomm.com';
const DEFAULT_API_PASSWORD = process.env.API_PASSWORD || 'Reports@123';
const POLLER_TICK_MS = 60 * 1000; // 1 minute
const AUTH_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

let pollerStarted = false;
let pollerTimer = null;
let pollerRunning = false;
const authTokenCache = new Map();

const cleanBaseUrl = (baseUrl) => String(baseUrl || '').replace(/\/+$/, '');
const toNumber = (value) => Number(value || 0);
const toJsonValue = (value) => value === undefined ? null : JSON.stringify(value);
const epochToIso = (epochSeconds) => new Date(epochSeconds * 1000).toISOString();

const getAxiosErrorDetails = (error) => {
    if (!error.response) {
        return error.message;
    }

    const responseData = typeof error.response.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response.data);

    return `status=${error.response.status}, body=${responseData}`;
};

export const loginToAgentStatsApi = async (config) => {
    const baseUrl = cleanBaseUrl(config.base_url);
    const loginUrl = `${baseUrl}/api/v2/login`;

    const payload = {
        username: process.env.AGENT_STATS_API_USERNAME || DEFAULT_API_USERNAME,
        password: process.env.AGENT_STATS_API_PASSWORD || DEFAULT_API_PASSWORD,
        domain: config.tenant_name
    };
    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json'
    };

    logger.info(
        `Agent stats login call config=${config.id}, url=${loginUrl}, tenant=${config.tenant_name}`
    );

    try {
        const response = await axios.post(loginUrl, payload, {
            headers,
            httpsAgent,
            timeout: 15000
        });

        const token = response.data?.accessToken
            || response.data?.access_token
            || response.data?.token
            || response.data?.data?.accessToken
            || response.data?.data?.access_token
            || response.data?.data?.token;
        if (!token) {
            throw new Error('Agent stats login did not return an auth token');
        }

        const reportAccountId = response.data?.user?.pvt_account_id
            || response.data?.data?.user?.pvt_account_id
            || config.x_account_id;

        logger.info(
            `Agent stats login success config=${config.id}, status=${response.status}, reportXAccountId=${reportAccountId}`
        );
        return { token, reportAccountId };
    } catch (error) {
        logger.error(`Agent stats login failed config=${config.id}: ${getAxiosErrorDetails(error)}`);
        throw error;
    }
};

const getCachedAuthToken = async (config, forceRefresh = false) => {
    const cachedToken = authTokenCache.get(config.id);
    const now = Date.now();

    if (!forceRefresh && cachedToken && cachedToken.expiresAt > now) {
        return cachedToken;
    }

    const auth = await loginToAgentStatsApi(config);
    authTokenCache.set(config.id, {
        ...auth,
        expiresAt: now + AUTH_TOKEN_TTL_MS
    });

    return auth;
};

export const fetchAgentStatsReport = async (config, auth, startEpoch, endEpoch) => {
    const baseUrl = cleanBaseUrl(config.base_url);
    const reportUrl = `${baseUrl}/api/v2/reports/callcenter/agents/stats`;
    const token = typeof auth === 'string' ? auth : auth?.token;
    const reportAccountId = typeof auth === 'string'
        ? config.x_account_id
        : auth?.reportAccountId || config.x_account_id;

    logger.info(
        `Agent stats report call config=${config.id}, url=${reportUrl}, tenant=${config.tenant_name}, xAccountId=${reportAccountId}, configuredXAccountId=${config.x_account_id}, startDate=${startEpoch}, endDate=${endEpoch}, startIso=${epochToIso(startEpoch)}, endIso=${epochToIso(endEpoch)}, tokenCached=${Boolean(token)}`
    );

    try {
        const response = await axios.get(
            reportUrl,
            {
                params: {
                    startDate: startEpoch,
                    endDate: endEpoch
                },
                headers: {
                    'X-Account-ID': reportAccountId,
                    'X-User-Agent': 'portal',
                    Authorization: `Bearer ${token}`
                },
                httpsAgent,
                timeout: 20000
            }
        );

        logger.info(`Agent stats report success config=${config.id}, status=${response.status}`);
        return response;
    } catch (error) {
        logger.error(`Agent stats report failed config=${config.id}: ${getAxiosErrorDetails(error)}`);
        throw error;
    }
};

export const persistAgentStatsReport = async (config, startEpoch, endEpoch, response) => {
    const pool = connectDB();
    const connection = await pool.getConnection();
    const rawData = response.data || {};

    try {
        await connection.beginTransaction();

        const [rawResult] = await connection.query(
            `INSERT INTO agent_stats_raw_reports
                (config_id, business_center_id, tenant_name, base_url, x_account_id,
                 start_epoch, end_epoch, raw_data, response_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                config.id,
                config.business_center_id,
                config.tenant_name,
                cleanBaseUrl(config.base_url),
                config.x_account_id,
                startEpoch,
                endEpoch,
                JSON.stringify(rawData),
                response.status
            ]
        );

        const rawReportId = rawResult.insertId;
        const entries = Object.entries(rawData);

        for (const [extension, stats] of entries) {
            const notAvailableDetails = stats?.not_available_detailed_report || null;
            const [finalResult] = await connection.query(
                `INSERT INTO agent_stats_final_reports (
                    raw_report_id, config_id, business_center_id, tenant_name, extension,
                    agent_name, tags, start_epoch, end_epoch, total_calls, answered_calls,
                    total_inbound_calls, answered_inbound_calls, total_outbound_calls,
                    answered_outbound_calls, talked_time, talked_average, duration_seconds,
                    max_connect_seconds, avg_connect_seconds, total_connect_seconds,
                    callee_id_number, callee_id_name, registered_time, idle_time,
                    wrap_up_time, hold_time, hold_count, on_call_time, on_call_time_avg,
                    not_available_time, not_available_count, not_available_detailed_report,
                    utilization_percent, availability_percent, on_call_percent, idle_percent,
                    wrap_up_percent, hold_percent, not_available_percent, dnd_percent, aht,
                    transferred_calls, transfer_rate, callback_calls, callback_rate,
                    repeat_calls, repeat_call_rate
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?
                )`,
                [
                    rawReportId,
                    config.id,
                    config.business_center_id,
                    config.tenant_name,
                    extension,
                    stats?.name || null,
                    toJsonValue(stats?.tags),
                    startEpoch,
                    endEpoch,
                    toNumber(stats?.total_calls),
                    toNumber(stats?.answered_calls),
                    toNumber(stats?.total_inbound_calls),
                    toNumber(stats?.answered_inbound_calls),
                    toNumber(stats?.total_outbound_calls),
                    toNumber(stats?.answered_outbound_calls),
                    toNumber(stats?.talked_time),
                    toNumber(stats?.talked_average),
                    toNumber(stats?.duration_seconds),
                    toNumber(stats?.max_connect_seconds),
                    toNumber(stats?.avg_connect_seconds),
                    toNumber(stats?.total_connect_seconds),
                    stats?.callee_id_number || null,
                    stats?.callee_id_name || null,
                    toNumber(stats?.registered_time),
                    toNumber(stats?.idle_time),
                    toNumber(stats?.wrap_up_time),
                    toNumber(stats?.hold_time),
                    toNumber(stats?.hold_count),
                    toNumber(stats?.on_call_time),
                    toNumber(stats?.on_call_time_avg),
                    toNumber(stats?.not_available_time),
                    toNumber(stats?.not_available_count),
                    toJsonValue(notAvailableDetails),
                    toNumber(stats?.utilization_percent),
                    toNumber(stats?.availability_percent),
                    toNumber(stats?.on_call_percent),
                    toNumber(stats?.idle_percent),
                    toNumber(stats?.wrap_up_percent),
                    toNumber(stats?.hold_percent),
                    toNumber(stats?.not_available_percent),
                    toNumber(stats?.dnd_percent),
                    toNumber(stats?.aht),
                    toNumber(stats?.transferred_calls),
                    toNumber(stats?.transfer_rate),
                    toNumber(stats?.callback_calls),
                    toNumber(stats?.callback_rate),
                    toNumber(stats?.repeat_calls),
                    toNumber(stats?.repeat_call_rate)
                ]
            );

            if (notAvailableDetails && typeof notAvailableDetails === 'object') {
                for (const [stateName, durationSeconds] of Object.entries(notAvailableDetails)) {
                    await connection.query(
                        `INSERT INTO agent_stats_not_available_details
                            (final_report_id, raw_report_id, config_id, business_center_id,
                             tenant_name, extension, agent_name, state_name, duration_seconds,
                             start_epoch, end_epoch)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            finalResult.insertId,
                            rawReportId,
                            config.id,
                            config.business_center_id,
                            config.tenant_name,
                            extension,
                            stats?.name || null,
                            stateName,
                            toNumber(durationSeconds),
                            startEpoch,
                            endEpoch
                        ]
                    );
                }
            }
        }

        await connection.query(
            `UPDATE agent_stats_api_configs
             SET last_success_at = CURRENT_TIMESTAMP, last_error = NULL
             WHERE id = ?`,
            [config.id]
        );

        await connection.commit();
        return { rawReportId, finalRows: entries.length };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const pollAgentStatsConfig = async (config) => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const lookbackSeconds = Number(config.lookback_seconds || 3600);
    const startEpoch = nowEpoch - lookbackSeconds;
    const endEpoch = nowEpoch;

    logger.info(
        `Agent stats poll start config=${config.id}, businessCenterId=${config.business_center_id}, tenant=${config.tenant_name}, lookbackSeconds=${lookbackSeconds}, startEpoch=${startEpoch}, endEpoch=${endEpoch}, startIso=${epochToIso(startEpoch)}, endIso=${epochToIso(endEpoch)}`
    );

    let auth = await getCachedAuthToken(config);
    let response;

    try {
        response = await fetchAgentStatsReport(config, auth, startEpoch, endEpoch);
    } catch (error) {
        if (error.response?.status !== 401) {
            throw error;
        }

        authTokenCache.delete(config.id);
        logger.info(`Agent stats report returned 401 for config=${config.id}; refreshing token and retrying once`);
        auth = await getCachedAuthToken(config, true);
        response = await fetchAgentStatsReport(config, auth, startEpoch, endEpoch);
    }

    return persistAgentStatsReport(config, startEpoch, endEpoch, response);
};

export const fetchAgentStatsTodayReport = async (config) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setHours(23, 59, 59, 999);

    const startEpoch = Math.floor(startOfToday.getTime() / 1000);
    const endEpoch = Math.floor(endOfToday.getTime() / 1000);

    let auth = await getCachedAuthToken(config);
    let response;

    try {
        response = await fetchAgentStatsReport(config, auth, startEpoch, endEpoch);
    } catch (error) {
        if (error.response?.status !== 401) {
            throw error;
        }

        authTokenCache.delete(config.id);
        logger.info(`Agent stats today report returned 401 for config=${config.id}; refreshing token and retrying once`);
        auth = await getCachedAuthToken(config, true);
        response = await fetchAgentStatsReport(config, auth, startEpoch, endEpoch);
    }

    return {
        startEpoch,
        endEpoch,
        data: response.data || {}
    };
};

export const pollDueAgentStatsConfigs = async () => {
    const pool = connectDB();
    const [configs] = await pool.query(
        `SELECT *
         FROM agent_stats_api_configs
         WHERE is_active = 1
         AND tenant_name IS NOT NULL
         AND base_url IS NOT NULL
         AND x_account_id IS NOT NULL
         AND (
             last_polled_at IS NULL
             OR TIMESTAMPDIFF(SECOND, last_polled_at, NOW()) >= poll_interval_seconds
         )`
    );

    for (const config of configs) {
        try {
            await pool.query(
                'UPDATE agent_stats_api_configs SET last_polled_at = CURRENT_TIMESTAMP WHERE id = ?',
                [config.id]
            );
            await pollAgentStatsConfig(config);
        } catch (error) {
            const errorDetails = getAxiosErrorDetails(error);
            logger.error(`Agent stats polling failed for config ${config.id}: ${errorDetails}`);
            await pool.query(
                'UPDATE agent_stats_api_configs SET last_error = ? WHERE id = ?',
                [errorDetails, config.id]
            );
        }
    }
};

export const startAgentStatsPoller = () => {
    if (pollerStarted) return;
    pollerStarted = true;

    const tick = async () => {
        if (pollerRunning) return;
        pollerRunning = true;
        try {
            await pollDueAgentStatsConfigs();
        } catch (error) {
            logger.error(`Agent stats poller tick failed: ${error.message}`);
        } finally {
            pollerRunning = false;
        }
    };

    pollerTimer = setInterval(tick, POLLER_TICK_MS);
    tick();
};

export const stopAgentStatsPoller = () => {
    if (pollerTimer) {
        clearInterval(pollerTimer);
        pollerTimer = null;
    }
    pollerStarted = false;
};
