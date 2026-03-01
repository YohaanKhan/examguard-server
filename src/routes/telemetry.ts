import { Router } from 'express';
import { sessionStore } from '../sessions/sessionStore';

/**
 * Router for telemetry data endpoints.
 * Exposes session data to the teacher dashboard.
 *
 * @returns An Express Router with telemetry endpoints mounted
 */
export function telemetryRouter(): Router {
    const router = Router();

    /**
     * GET /telemetry/sessions
     * Returns all active student sessions and their telemetry events.
     * Used by the teacher dashboard to display live student activity.
     */
    router.get('/telemetry/sessions', (req, res) => {
        const sessions = sessionStore.getAllSessions();
        res.json(sessions);
    });

    return router;
}