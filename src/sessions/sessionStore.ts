import { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single telemetry event received from the VS Code extension.
 * The index signature accommodates any extra fields (file, content, charDelta, etc.)
 * without needing to enumerate every possible event shape upfront.
 */
export type TelemetryEvent = {
    type: string;
    timeStamp: number;
    [key: string]: unknown;
};

/**
 * A full-file snapshot captured by the extension every 60 seconds.
 */
export type Snapshot = {
    type: 'SNAPSHOT';
    timeStamp: number;
    file: string;
    content: string;
};

/**
 * Full state for one student's exam session.
 */
export type Session = {
    studentId: string;
    examCode: string;
    joinedAt: number;
    events: TelemetryEvent[];
    snapshots: Snapshot[];
    suspicionScore: number;
    /** Live WebSocket to the student's extension — null if disconnected */
    ws: WebSocket | null;
};

// ---------------------------------------------------------------------------
// Suspicion score weights (mirrors implementation.md constants)
// ---------------------------------------------------------------------------
const SUSPICION_PASTE_WEIGHT = 40;
const SUSPICION_FOCUS_WEIGHT = 20;
const SUSPICION_FULLSCREEN_EXIT_WEIGHT = 10;
const SUSPICION_FULLSCREEN_BLOCK_WEIGHT = 25;
const MAX_SUSPICION_SCORE = 100;

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

class SessionStore {

    /** studentId → Session */
    private sessions: Map<string, Session> = new Map();

    /**
     * Set of active teacher dashboard WebSocket clients.
     * Every time a suspicion score changes, the new sessions list is broadcast to all of them.
     */
    private dashboardClients: Set<WebSocket> = new Set();

    // -----------------------------------------------------------------------
    // Session lifecycle
    // -----------------------------------------------------------------------

    /**
     * Creates a new session for a student, storing their live WebSocket reference.
     * Called by the WebSocket handler as soon as a student connects.
     *
     * @param studentId - Unique student identifier e.g. 's12345678'
     * @param examCode  - Exam code the student authenticated with
     * @param ws        - The live WebSocket to the student's extension
     */
    createSession(studentId: string, examCode: string, ws: WebSocket): void {
        const session: Session = {
            studentId,
            examCode,
            joinedAt: Date.now(),
            events: [],
            snapshots: [],
            suspicionScore: 0,
            ws
        };
        this.sessions.set(studentId, session);
        console.log(`[SessionStore] Session created — ${studentId} (${examCode})`);
    }

    /**
     * Marks a student's session as disconnected by nulling the `ws` reference.
     * Session data is preserved for the teacher to review post-exam.
     *
     * @param studentId - The student who disconnected
     */
    markDisconnected(studentId: string): void {
        const session = this.sessions.get(studentId);
        if (session) {
            session.ws = null;
            console.log(`[SessionStore] ${studentId} disconnected — session data preserved`);
        }
    }

    // -----------------------------------------------------------------------
    // Event + snapshot ingestion
    // -----------------------------------------------------------------------

    /**
     * Appends a telemetry event to the session and recalculates the suspicion score
     * if the event type affects it (PASTE, FOCUS_LOST).
     *
     * @param studentId - The student to append the event to
     * @param event     - The telemetry event received from the extension
     */
    addEvent(studentId: string, event: TelemetryEvent): void {
        const session = this.sessions.get(studentId);
        if (!session) {
            console.warn(`[SessionStore] No session for ${studentId} — event dropped`);
            return;
        }

        session.events.push(event);

        // Recalculate and broadcast when a score-affecting event arrives
        if (
            event.type === 'PASTE' ||
            event.type === 'FOCUS_LOST' ||
            event.type === 'FULLSCREEN_EXIT' ||
            event.type === 'FULLSCREEN_BLOCKED'
        ) {
            this.recalculateScore(session);
            this.broadcastUpdate();
        }
    }

    /**
     * Appends a code snapshot to the session.
     *
     * @param studentId - The student whose snapshot this is
     * @param snapshot  - The full-file snapshot object
     */
    addSnapshot(studentId: string, snapshot: Snapshot): void {
        const session = this.sessions.get(studentId);
        if (!session) {
            console.warn(`[SessionStore] No session for ${studentId} — snapshot dropped`);
            return;
        }
        session.snapshots.push(snapshot);
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    /**
     * Retrieves a single student's session.
     *
     * @param studentId - The student ID to look up
     * @returns The session, or undefined if not found
     */
    getSession(studentId: string): Session | undefined {
        return this.sessions.get(studentId);
    }

    /**
     * Returns all sessions as an array (WebSocket refs stripped for JSON safety).
     * Used by `GET /api/sessions` to feed the teacher dashboard.
     */
    getAllSessions(): Omit<Session, 'ws'>[] {
        return Array.from(this.sessions.values()).map(({ ws: _ws, ...rest }) => rest);
    }

    // -----------------------------------------------------------------------
    // Dashboard broadcast
    // -----------------------------------------------------------------------

    /**
     * Registers a teacher dashboard WebSocket client so it receives live score updates.
     *
     * @param ws - The dashboard's WebSocket connection
     */
    addDashboardClient(ws: WebSocket): void {
        this.dashboardClients.add(ws);
        console.log(`[SessionStore] Dashboard client connected (total: ${this.dashboardClients.size})`);
    }

    /**
     * Removes a dashboard client when it disconnects.
     *
     * @param ws - The WebSocket to remove
     */
    removeDashboardClient(ws: WebSocket): void {
        this.dashboardClients.delete(ws);
        console.log(`[SessionStore] Dashboard client disconnected (total: ${this.dashboardClients.size})`);
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /**
     * Recalculates the suspicion score for a session based on paste + focus loss counts.
     *
     * Formula (from implementation.md):
     *   score = (pasteCount × 40) + (focusLossCount × 20), clamped to [0, 100]
     */
    private recalculateScore(session: Session): void {
        const pasteCount = session.events.filter(e => e.type === 'PASTE').length;
        const focusLossCount = session.events.filter(e => e.type === 'FOCUS_LOST').length;
        const fullscreenExits = session.events.filter(e => e.type === 'FULLSCREEN_EXIT').length;
        const fullscreenBlocked = session.events.filter(e => e.type === 'FULLSCREEN_BLOCKED').length;

        const raw =
            (pasteCount * SUSPICION_PASTE_WEIGHT) +
            (focusLossCount * SUSPICION_FOCUS_WEIGHT) +
            (fullscreenExits * SUSPICION_FULLSCREEN_EXIT_WEIGHT) +
            (fullscreenBlocked * SUSPICION_FULLSCREEN_BLOCK_WEIGHT);

        session.suspicionScore = Math.min(raw, MAX_SUSPICION_SCORE);

        console.log(`[SessionStore] ${session.studentId} suspicion score: ${session.suspicionScore}`);
    }

    /**
     * Pushes the current sessions list to every connected dashboard client.
     * Called automatically after each score recalculation.
     */
    private broadcastUpdate(): void {
        const payload = JSON.stringify({
            type: 'SESSIONS_UPDATE',
            sessions: this.getAllSessions()
        });

        for (const client of this.dashboardClients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }
}

/**
 * Singleton instance shared across the entire backend.
 *
 * @example
 * import { sessionStore } from './sessions/sessionStore';
 * sessionStore.createSession('s123', 'EXAM2024', ws);
 * sessionStore.addEvent('s123', { type: 'PASTE', timeStamp: Date.now() });
 */
export const sessionStore = new SessionStore();