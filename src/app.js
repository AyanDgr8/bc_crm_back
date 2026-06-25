// src/app.js

import express from "express";
import cors from "cors";
import router from './routes/router.js';
import reportRoutes from './routes/reportRoutes.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandling.js';
import morgan from "morgan"; 
import { logger } from './logger.js';

const app = express();

const allowedOrigins = [  'http://181.214.10.246:9787', 'https://bccrm.voicemeetme.net',
			   'http://181.214.10.244:9787','https://181.214.10.244:9787',
			   'http://181.214.10.244:5566','https://181.214.10.244:5566'
                      ]; // Add frontend URL

const corsOptions = {
  origin: function (origin, callback) {
    // console.log(`Incoming request origin: ${origin}`); // Debugging
    // Allow requests with no origin, like mobile apps or curl requests
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  // origin: true,
  credentials: true, // Allow credentials
  optionsSuccessStatus: 200 // Some legacy browsers (IE11, various SmartTVs) choke on 204
};

// // Use Morgan for logging HTTP requests
// app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use("/", router);
app.use('/', reportRoutes);

// Middleware for handling 404 errors
app.use(notFoundHandler);

// Middleware for handling errors
app.use(errorHandler);


// Global error handling
process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

export { app };
