import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { createWebSocketServer } from './ws/wsHandler';
import { authRouter } from './routes/auth';
import { telemetryRouter } from './routes/telemetry';

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

/** Mount routers */
app.use(authRouter());
app.use(telemetryRouter());

/** Serve the teacher dashboard at /dashboard */
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

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
server.listen(3000, () => {
    console.log('[Server] Listening on http://localhost:3000');
});