# ExamGuard Server

The backend server for the **ExamGuard** (TryCheat) VS Code extension. This server handles incoming WebSocket connections from the extension to monitor exam sessions and provides an admin interface.

## Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Copy the example environment file and configure your secrets:
   ```bash
   cp .env.example .env
   ```
   Edit the `.env` file to set your `ADMIN_PASSWORD` and `SECRET_KEY`.

## Running the Server

Start the server in development mode (with auto-reload):

```bash
npm run dev
```

The server will start on the port specified in your `.env` file (default: `3005`).

## Features
- WebSocket server for real-time telemetry from student extensions.
- Admin routes to view exam sessions.
- In-memory/SQLite database for session storage (depending on configuration).
