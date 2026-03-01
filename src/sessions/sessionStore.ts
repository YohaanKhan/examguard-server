/**
 * Represents a single telemetry event sent from the VS Code extension.
 * The index signature allows any additional properties (file, content, charDelta, etc.)
 * without needing to define every possible shape upfront.
 */
type TelemetryEvent = { type: string; timeStamp: number; [key: string]: unknown };

/**
 * Represents a single student's exam session.
 * Holds all telemetry events captured during the session.
 */
type Session = {
    studentId: string;
    examCode: string;
    events: TelemetryEvent[];
    startedAt: number;
};

/**
 * In-memory store for all active student sessions.
 * Keyed by studentId — each student gets one session per exam.
 *
 * Note: this is in-memory only. If the backend restarts, all session data is lost.
 * Persistence to disk or a database can be added later.
 */
class SessionStore {

    /** The underlying map — studentId → Session */
    private sessions: Map<string, Session> = new Map();

    /**
     * Creates a new session for a student and stores it in the map.
     * Should be called when the student first connects via WebSocket.
     *
     * @param studentId - The student's unique ID e.g. 's12345678'
     * @param examCode  - The exam code the student entered e.g. 'EXAM2024'
     */
    createSession(studentId: string, examCode: string): void {
        const session: Session = {
            studentId,
            examCode,
            events: [],
            startedAt: Date.now()
        };
        this.sessions.set(studentId, session);
        console.log(`[SessionStore] Session created for ${studentId} — Exam: ${examCode}`);
    }

    /**
     * Appends a telemetry event to a student's session.
     * Called every time the backend receives an event from the extension.
     *
     * @param studentId - The student whose session to append to
     * @param event     - The telemetry event to store
     */
    addEvent(studentId: string, event: TelemetryEvent): void {
        const session = this.sessions.get(studentId);

        if (!session) {
            console.warn(`[SessionStore] No session found for studentId: ${studentId}. Event dropped.`);
            return;
        }

        session.events.push(event);
    }

    /**
     * Retrieves a single student's session by ID.
     *
     * @param studentId - The student ID to look up
     * @returns The student's Session, or undefined if not found
     */
    getSession(studentId: string): Session | undefined {
        return this.sessions.get(studentId);
    }

    /**
     * Returns all active sessions as an array.
     * Used by the teacher dashboard to display all students.
     *
     * @returns An array of all Session objects currently in the store
     */
    getAllSessions(): Session[] {
        return Array.from(this.sessions.values());
    }
}

/**
 * Singleton instance of SessionStore shared across the entire backend.
 * Import this wherever you need to read or write session data.
 *
 * @example
 * import { sessionStore } from './sessions/sessionStore';
 * sessionStore.createSession('s12345678', 'EXAM2024');
 * sessionStore.addEvent('s12345678', { type: 'PASTE', timestamp: Date.now() });
 */
export const sessionStore = new SessionStore();