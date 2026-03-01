import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';
import { sessionStore } from '../sessions/sessionStore';
import { generateQuestion } from '../ollama/ollamaClient';

/**
 * Creates a WebSocket server attached to the existing Express HTTP server.
 * Shares port 3000 with the HTTP server — no separate port needed.
 *
 * Handles the full lifecycle of a student connection:
 * 1. Connection — parse studentId + examCode, create session
 * 2. Message — parse telemetry event, store in session
 * 3. On SNAPSHOT — generate a question via Ollama and push it back to the student
 * 4. Close — log disconnection for teacher dashboard
 *
 * @param server - The Express HTTP server instance to attach the WS server to
 * @returns The created WebSocketServer instance
 */
export function createWebSocketServer(server: Server): WebSocketServer {

    const wss = new WebSocketServer({ server });

    /**
     * Fires every time a student's extension connects.
     * Each connection gets its own `ws` socket and its own `studentId` scope.
     */
    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {

        /**
         * Parse studentId and examCode from the WebSocket URL query params.
         * The extension connects with: ws://localhost:3000?studentId=s123&examCode=EXAM2024
         * req.url! — we use ! because we know the URL exists on an incoming connection
         */
        const params = new URL(req.url!, 'http://localhost').searchParams;
        const studentId = params.get('studentId') ?? 'unknown';
        const examCode = params.get('examCode') ?? 'unknown';

        // Create a fresh session for this student
        sessionStore.createSession(studentId, examCode);
        console.log(`[WS] Student connected: ${studentId} — Exam: ${examCode}`);

        /**
         * Fires every time the extension sends a telemetry event.
         * Events arrive as JSON strings and are parsed before being stored.
         * On SNAPSHOT events, Ollama generates a question and sends it back.
         */
        ws.on('message', (data) => {
            try {
                const event = JSON.parse(data.toString());
                sessionStore.addEvent(studentId, event);
                console.log(`[WS] Event received from ${studentId}: ${event.type}`);

                /**
                 * When a snapshot arrives, send the code to Ollama and push
                 * the generated question back to the student's extension.
                 * The extension displays it in the Q&A panel with a 90 second timer.
                 * We use .then() instead of await because the message handler isn't async
                 * and we don't want to block processing of other incoming events.
                 */
                if (event.type === 'SNAPSHOT' && event.content) {
                    generateQuestion(event.content as string).then(question => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'NEW_QUESTION',
                                question,
                                timeLimit: 90
                            }));
                            console.log(`[WS] Question sent to ${studentId}: ${question.slice(0, 60)}...`);
                        }
                    }).catch(err => {
                        console.error('[WS] Failed to generate question:', err);
                    });
                }

            } catch (err) {
                console.warn(`[WS] Failed to parse message from ${studentId}:`, err);
                return;
            }
        });

        /**
         * Fires when the student's extension disconnects.
         * Could be intentional (exam ended) or suspicious (mid-exam disconnect).
         * The teacher dashboard will flag unexpected disconnections.
         */
        ws.on('close', () => {
            console.log(`[WS] Student disconnected: ${studentId}`);
            // TODO: flag unexpected disconnections as suspicious on the dashboard
        });
    });

    return wss;
}