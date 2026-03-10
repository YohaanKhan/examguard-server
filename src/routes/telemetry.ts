import { Router, Request, Response } from 'express';
import { sessionStore } from '../sessions/sessionStore';

/**
 * Router for all session and telemetry endpoints.
 * Provides the teacher dashboard with session data, replays, and HTTP fallbacks.
 *
 * Routes:
 *  GET  /api/sessions              — all active sessions
 *  GET  /api/sessions/:id          — full detail for one student
 *  GET  /api/sessions/:id/replay   — ordered snapshots for replay scrubber
 *  POST /api/sessions/:id/end      — trigger post-exam peer comparison
 *  POST /api/telemetry/event       — HTTP fallback for single events
 *  POST /api/telemetry/snapshot    — HTTP fallback for snapshots
 */
export function telemetryRouter(): Router {
    const router = Router();

    // -----------------------------------------------------------------------
    // Session endpoints
    // -----------------------------------------------------------------------

    /**
     * GET /api/sessions
     * Returns a summary of all active student sessions.
     * Used by the teacher dashboard live overview table.
     */
    router.get('/api/sessions', (_req: Request, res: Response) => {
        res.json(sessionStore.getAllSessions());
    });

    /**
     * GET /api/sessions/:id
     * Returns the full session detail for one student — events, snapshots, score.
     */
    router.get('/api/sessions/:id', (req: Request, res: Response) => {
        const session = sessionStore.getSession(String(req.params.id));
        if (!session) {
            res.status(404).json({ error: `No session found for studentId: ${req.params.id}` });
            return;
        }
        // Strip the ws reference before sending — not JSON serialisable
        const { ws: _ws, ...safeSession } = session;
        res.json(safeSession);
    });

    /**
     * GET /api/sessions/:id/replay
     * Returns the ordered array of snapshots for the replay scrubber.
     */
    router.get('/api/sessions/:id/replay', (req: Request, res: Response) => {
        const session = sessionStore.getSession(String(req.params.id));
        if (!session) {
            res.status(404).json({ error: `No session found for studentId: ${req.params.id}` });
            return;
        }
        res.json(session.snapshots);
    });

    /**
     * POST /api/sessions/:id/end
     * Marks an exam as ended and triggers peer comparison.
     * Peer comparison runs asynchronously — the result is stored on the session store.
     */
    router.post('/api/sessions/:id/end', async (req: Request, res: Response) => {
        const session = sessionStore.getSession(String(req.params.id));
        if (!session) {
            res.status(404).json({ error: `No session found for studentId: ${req.params.id}` });
            return;
        }

        try {
            const { runPeerComparison } = await import('../peer/peerComparison');
            await runPeerComparison();
            res.json({ success: true, message: 'Exam ended. Peer comparison complete.' });
        } catch (err) {
            console.error('[Routes] Peer comparison failed:', err);
            res.status(500).json({ error: 'Peer comparison failed.' });
        }
    });

    // -----------------------------------------------------------------------
    // HTTP fallback endpoints (used when WebSocket is unavailable)
    // -----------------------------------------------------------------------

    /**
     * POST /api/telemetry/event
     * Accepts a single telemetry event from the extension as an HTTP fallback.
     *
     * @body studentId - The student sending the event
     * @body event     - The telemetry event object
     */
    router.post('/api/telemetry/event', (req: Request, res: Response) => {
        const { studentId, event } = req.body;
        if (!studentId || !event) {
            res.status(400).json({ error: 'studentId and event are required' });
            return;
        }
        sessionStore.addEvent(studentId, event);
        res.json({ success: true });
    });

    /**
     * POST /api/telemetry/snapshot
     * Accepts a full-file snapshot from the extension as an HTTP fallback.
     *
     * @body studentId - The student sending the snapshot
     * @body snapshot  - The snapshot object (type, timeStamp, file, content)
     */
    router.post('/api/telemetry/snapshot', (req: Request, res: Response) => {
        const { studentId, snapshot } = req.body;
        if (!studentId || !snapshot) {
            res.status(400).json({ error: 'studentId and snapshot are required' });
            return;
        }
        sessionStore.addSnapshot(studentId, snapshot);
        res.json({ success: true });
    });

    return router;
}