import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { createWebSocketServer } from './ws/wsHandler';
import { authRouter } from './routes/auth';
import { telemetryRouter } from './routes/telemetry';
import adminRoutes from './routes/adminRoutes';
import cookieParser from 'cookie-parser';

dotenv.config();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_TOKEN_VAL = 'secure_admin_session_token';

if (!ADMIN_PASSWORD) {
    console.error('[STRATEGIC] FATAL: ADMIN_PASSWORD not set in .env');
    process.exit(1);
}

/**
 * Entry point for the ExamGuard backend server.
 * Sets up Express middleware, mounts routers, attaches the WebSocket server,
 * and starts listening on port 3000.
 *
 * HTTP and WebSocket share the same port — no separate ports needed.
 */

const app = express();

/** Parse incoming JSON request bodies — required for POST /auth/verify */
app.use(express.json());
app.use(cookieParser(process.env.SECRET_KEY || 'examguard_dev_fallback_secret'));

/** Authentication middleware for Teacher Dashboard */
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Basic protection logic:
    // 1. If we have a valid signed cookie, proceed.
    // 2. Otherwise, if it's an API request (/admin), return 401.
    // 3. Otherwise, if it's a dashboard request, redirect to login.html.

    const token = req.signedCookies.admin_token;
    if (token === ADMIN_TOKEN_VAL) {
        return next();
    }

    // Paths that should ALWAYS be public
    const isLoginPath = req.originalUrl.includes('/login') || req.originalUrl.includes('/dashboard/login.html');
    const isTelemetryFallback = req.method === 'POST' && req.originalUrl.startsWith('/api/telemetry/');

    if (isLoginPath || isTelemetryFallback) {
        return next();
    }

    // For all other paths under /api, /admin or /dashboard, we require auth
    if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/admin') || req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        res.status(401).json({ error: 'Unauthorized' });
    } else {
        res.redirect('/dashboard/login.html');
    }
};

/** Admin Login Route */
app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.cookie('admin_token', ADMIN_TOKEN_VAL, {
            signed: true,
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid administrative password' });
    }
});

app.use(authRouter()); // Student auth remains public

// Apply protection to telemetry, admin, and dashboard
app.use('/api', requireAdmin, telemetryRouter());
app.use('/admin', requireAdmin, adminRoutes);
app.use('/dashboard', requireAdmin, express.static(path.join(__dirname, 'dashboard')));

/**
 * Health check endpoint.
 * Hit http://localhost:3000 to confirm the server is running.
 */
app.get('/', (req, res) => {
    res.json({ status: 'ExamGuard server running' });
});

/** Create the underlying HTTP server from the Express app */
const server = createServer(app);

/** Attach the WebSocket server to the same HTTP server and port */
createWebSocketServer(server);

/** Start listening */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
});