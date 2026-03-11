import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import { sessionStore, Snapshot, TelemetryEvent } from '../sessions/sessionStore';
import { validateExamCode } from '../routes/auth';

/**
 * Creates a WebSocket server attached to the existing Express HTTP server.
 * Shares port 3000 with the HTTP server — no separate port needed.
 *
 * Handles two types of clients:
 *  - Student extensions → identified by `?studentId=...` query param
 *  - Teacher dashboard  → identified by `?role=dashboard` query param
 *
 * @param server - The Express HTTP server instance to attach the WS server to
 * @returns The created WebSocketServer instance
 */
export function createWebSocketServer(server: Server): WebSocketServer {

    const wss = new WebSocketServer({ server });

    wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {

        const params = new URL(req.url!, 'http://localhost').searchParams;
        const role = params.get('role');
        const studentId = params.get('studentId') ?? 'unknown';
        const examCode = params.get('examCode') ?? 'unknown';

        // ------------------------------------------------------------------
        // Teacher dashboard client — just register and handle disconnect
        // ------------------------------------------------------------------
        if (role === 'dashboard') {
            sessionStore.addDashboardClient(ws);
            console.log('[WS] Dashboard client connected');

            ws.on('close', () => {
                sessionStore.removeDashboardClient(ws);
                console.log('[WS] Dashboard client disconnected');
            });

            return;
        }

        // ------------------------------------------------------------------
        // Student extension client
        // ------------------------------------------------------------------
        const authStatus = await validateExamCode(examCode);
        if (!authStatus.isValid) {
            console.warn(`[WS] Rejected student connection with invalid or inactive exam code (${authStatus.reason}): ${examCode}`);
            ws.close(1008, `Student Auth Error: ${authStatus.reason || 'Invalid exam code'}`);
            return;
        }

        const result = sessionStore.createSession(studentId, examCode, ws);
        if (!result.success) {
            ws.close(1008, result.reason || 'Connection rejected');
            return;
        }

        ws.on('message', (data) => {
            try {
                const event = JSON.parse(data.toString()) as TelemetryEvent;

                if (event.type === 'SNAPSHOT') {
                    // Route snapshots to the dedicated snapshot list
                    sessionStore.addSnapshot(studentId, event as unknown as Snapshot);
                } else {
                    // All other events (PASTE, KEYSTROKE, FOCUS_LOST, etc.) go to events[]
                    sessionStore.addEvent(studentId, event);
                }

                console.log(`[WS] ${event.type} from ${studentId}`);
            } catch (err) {
                console.warn(`[WS] Failed to parse message from ${studentId}:`, err);
            }
        });

        ws.on('close', () => {
            sessionStore.markDisconnected(studentId);
            console.log(`[WS] Student disconnected: ${studentId}`);
        });
    });

    return wss;
}