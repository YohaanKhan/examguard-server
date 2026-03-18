# ExamGuard Server

The central backend infrastructure for the **ExamGuard** ecosystem. It acts as the command center, continuously ingesting high-frequency telemetry from students running the **TryCheat** VS Code Extension.

## Core Features

### 1. Robust Real-time WebSocket Engine
Handles concurrent, continuous WebSocket streams (`src/ws/wsHandler.ts`) from multiple students without dropping packets. It re-establishes broken connections and immediately flags abnormal network instability or disconnects.

### 2. Live Session Management
Maintains real-time state for all active exam sessions (`src/sessions/sessionStore.ts`). 
- Tracks active students and their connection statuses in a live Map.
- Parses incoming telemetry data (e.g., Focus Loss, Terminal Usage, Bulk Code Deletion) instantly to adjust "Trust Scores".

### 3. Persistent Analytics & Snapshots
- Utilizes a lightweight **SQLite DB** (`src/db/database.ts`) to securely log all infractions permanently.
- Stores historical code diff snapshots. This allows an instructor to practically "rewind" a student's entire exam session, guaranteeing that the code was written organically rather than copy-pasted.

### 4. Admin Dashboard API
Provides RESTful HTTP routes (`src/routes/adminRoutes.ts`) heavily protected by an `ADMIN_PASSWORD` (set in your `.env`). These routes allow front-end UIs or scripts to generate reports, check on active takers, and review flagged cheating behavior.

---

## Architecture and How it Works

1. **Initialization:** The Express.js server starts up and binds a WebSocket Server (`ws`) to the exact same HTTP port.
2. **Handshake:** Students connect and negotiate authentication. Once verified, a persistent session profile is created for them in the Session Store.
3. **Ingestion Engine:** As the student triggers events in VS Code (e.g., leaving full-screen, running an unauthorized terminal command), a JSON telemetry payload is beamed instantly to the server.
4. **Processing:** The server validates the payload, updates the student's integrity status, recalculates their trust score, and writes the event to the SQLite database for permanent administrative review.

---

## Prerequisites & Setup

- Node.js (v18 or higher recommended)
- npm or yarn

```bash
# 1. Install dependencies
npm install

# 2. Setup your Environment Variables
cp .env.example .env
# Edit .env to set your ADMIN_PASSWORD and port (Default: 3005)

# 3. Run the development server
npm run dev
```
