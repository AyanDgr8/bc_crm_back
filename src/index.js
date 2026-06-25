import dotenv from "dotenv";
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import connectDB from "./db/index.js";
import { app } from './app.js';
import 'colors';
// import { logger } from "./logger.js";

dotenv.config({
  path: './.env'
});

// Verify necessary environment variables
if (!process.env.PORT) {
  console.error("? PORT environment variable is missing. Please set it in the .env file.".red.bold);
  process.exit(1);
}

const useHttps = process.env.HTTPS !== 'false';

let server;
if (useHttps) {
  let sslOptions;
  try {
    console.log("?? Loading SSL certificates...".yellow.bold);
    sslOptions = {
      key: fs.readFileSync(path.resolve('ssl/privkey.pem')),
      cert: fs.readFileSync(path.resolve('ssl/fullchain.pem'))
    };
  } catch (error) {
    console.error("? Error loading SSL certificates. Check paths and permissions.".red.bold, error);
    process.exit(1);
  }

  server = https.createServer(sslOptions, app);
} else {
  console.log("?? HTTPS disabled; starting local HTTP server.".yellow.bold);
  server = http.createServer(app);
}

// Initialize the database connection pool
const pool = connectDB();

const startServer = async () => {
  try {
    await server.listen(process.env.PORT);
    const protocol = useHttps ? 'HTTPS' : 'HTTP';
    console.log(`?? ${protocol} server is running on port: ${process.env.PORT}`.cyan.bold);
  } catch (error) {
    console.error("? Error starting server:".red.bold, error);
    process.exit(1);
  }
};

process.title = 'MultyComm CRM';

// Graceful shutdown function
const gracefulShutdown = async () => {
  console.log('?? Received shutdown signal, closing server and database connections...'.yellow.bold);
  
  try {
    await pool.end();
    console.log('?? MySQL pool closed successfully.'.green.bold);
  } catch (err) {
    console.error('? Error closing MySQL pool:'.red.bold, err);
  }

  server.close(() => {
    console.log('?? Secure server closed successfully.'.blue.bold);
    process.exit(0);
  });
};

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Global error handling
process.on('uncaughtException', (err) => {
  console.error('? Uncaught Exception:'.red.bold, err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('? Unhandled Rejection at:'.red.bold, promise);
  console.error('Reason:', reason);
});

// WhatsApp-specific handling
process.on('SIGABRT', () => {
  console.log('?? WhatsApp connection reset detected, handling gracefully...'.yellow.bold);
});

// Connect to MySQL and start server
const initApp = async () => {
  try {
    const connection = await pool.getConnection();
    connection.release();

    console.log(`?? MySQL connected`.green.bold);
    await startServer();
  } catch (err) {
    console.error("? MySQL connection failed!!!".red.bold, err);
    process.exit(1);
  }
};

initApp();
