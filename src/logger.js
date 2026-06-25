// src/logger.js

import winston from 'winston';
import fs from 'fs';
import path from 'path';

// Create a log directory if it doesn't exist
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Determine whether to log to console based on environment
const isProduction = process.env.NODE_ENV === 'production';

// Create a custom logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        // File transport for logging errors
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
        }),
        // File transport for logging all other messages
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
        }),
    ],
});

// Add console transport only in non-production environments
if (!isProduction) {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// Optional: Add a console warning for unhandled exceptions
logger.exceptions.handle(
    new winston.transports.File({ filename: path.join(logDir, 'exceptions.log') })
);

export { logger };
