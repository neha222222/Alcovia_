# Alcovia - Intervention Engine

A **closed-loop intervention system** that detects when students fall behind in real-time and automatically triggers a mentorship workflow. This system creates a seamless connection between Student App, Backend Server, and Automation Workflow.

## Live Demo

- **Frontend**: [[Alcovia](https://alcovia-ten.vercel.app/)]
- **Loom Video**: [Your Video Link]

## Architecture Overview

This system implements a **State Machine Pattern** where students transition through different states based on their performance:

```
ACTIVE → (fail check-in) → NEEDS_INTERVENTION → (mentor assigns task) → REMEDIAL → (complete task) → ACTIVE
        (pass check-in) → ON_TRACK → ACTIVE
```

### How It Works

1. **Student submits daily check-in** with quiz score and focus time
2. **Backend validates** using logic gate: `quiz_score > 7 AND focus_minutes > 60`
3. **If failed**: Student is LOCKED → n8n webhook triggered → Mentor notified
4. **Mentor assigns task** via n8n → Backend receives callback → Student UNLOCKED with remedial task
5. **Student completes task** → Returns to ACTIVE state

### Why This Architecture?

- **SQL Database (PostgreSQL)**: ACID compliance ensures data integrity for educational records
- **State Machine**: Clear, predictable transitions prevent inconsistent states
- **WebSocket (Socket.io)**: Real-time updates eliminate polling, instant mentor-to-student communication
- **n8n Middleware**: Decouples notification logic from core business logic, enables flexible mentor workflows

## Project Structure

```
alcovia/
├── server/                 # Node.js + Express Backend
│   ├── database/
│   │   ├── db.js          # PostgreSQL connection & queries
│   │   └── schema.sql     # Database schema
│   ├── index.js           # Main server with API endpoints + WebSocket
│   └── package.json
├── client/                 # React Frontend
│   ├── src/
│   │   ├── App.jsx        # Main app component (4 states)
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── n8n_workflow/          # Automation workflow
    └── Student_Intervention_Workflow.json
```

## Database Schema

### Students Table
Stores student profiles and current intervention state.

```sql
CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Status Values**: `active`, `needs_intervention`, `remedial`, `on_track`

### Daily_Logs Table
Tracks daily check-ins with quiz scores and focus time.

```sql
CREATE TABLE daily_logs (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(100) REFERENCES students(student_id),
    quiz_score INTEGER CHECK (quiz_score >= 0 AND quiz_score <= 10),
    focus_minutes INTEGER CHECK (focus_minutes >= 0),
    session_date DATE DEFAULT CURRENT_DATE,
    passed BOOLEAN,
    tab_switches INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Interventions Table
Tracks mentor interventions and remedial tasks.

```sql
CREATE TABLE interventions (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(100) REFERENCES students(student_id),
    trigger_log_id INTEGER REFERENCES daily_logs(id),
    mentor_email VARCHAR(255),
    remedial_task TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    assigned_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);
```

## API Endpoints

### `GET /api/health`
Health check endpoint.

**Response**:
```json
{ "status": "ok", "message": "Server is running" }
```

### `GET /api/student/:studentId`
Get student status and current intervention.

**Response**:
```json
{
  "student": {
    "student_id": "123",
    "name": "Test Student",
    "status": "active"
  },
  "intervention": null
}
```

### `POST /api/daily-checkin`
**The Logic Gate** - Core endpoint that determines student state.

**Request**:
```json
{
  "student_id": "123",
  "quiz_score": 4,
  "focus_minutes": 30,
  "tab_switches": 5
}
```

**Success Response** (quiz_score > 7 AND focus_minutes > 60):
```json
{
  "status": "On Track",
  "message": "Great job! Keep up the good work.",
  "passed": true
}
```

**Failure Response** (triggers intervention):
```json
{
  "status": "Pending Mentor Review",
  "message": "Your performance needs attention.",
  "passed": false,
  "intervention_id": 1
}
```

**What Happens on Failure**:
1. Student status updated to `needs_intervention`
2. Intervention record created with 12-hour expiry
3. n8n webhook triggered with student data
4. WebSocket notification sent to student

### `POST /api/assign-intervention`
Called by n8n after mentor assigns remedial task. Unlocks the student.

**Request**:
```json
{
  "student_id": "123",
  "remedial_task": "Read Chapter 4 and complete exercises",
  "mentor_email": "mentor@alcovia.com",
  "intervention_id": 1
}
```

**Response**:
```json
{
  "success": true,
  "message": "Intervention assigned successfully"
}
```

**What Happens**:
1. Intervention status updated to `assigned`
2. Student status changed to `remedial`
3. Real-time WebSocket notification sent
4. Student app instantly unlocks and shows task

### `POST /api/complete-remedial`
Student marks remedial task as complete.

**Request**:
```json
{
  "student_id": "123",
  "intervention_id": 1
}
```

**Response**:
```json
{
  "success": true,
  "status": "active"
}
```

### `GET /api/student/:studentId/history`
Get student's history of logs and interventions.

## Frontend States

The React app implements **4 distinct states**:

### 1. ACTIVE State
- **UI**: Focus timer + Quiz input + Submit button
- **Features**:
  - Start/stop focus timer
  - Track tab switches (bonus feature)
  - Enter quiz score (0-10)
  - Submit daily check-in

### 2. ON_TRACK State
- **UI**: Success message + Continue button
- **Trigger**: Passed check-in (score > 7, time > 60 minutes)

### 3. NEEDS_INTERVENTION State (Locked)
- **UI**: Lock icon + "Waiting for mentor..." message
- **Features**:
  - All inputs disabled
  - Loading spinner
  - Real-time WebSocket connection active
  - Instant unlock when mentor assigns task

### 4. REMEDIAL State (Unlocked with Task)
- **UI**: Task card + Complete button
- **Features**:
  - Shows mentor-assigned task
  - Mentor email displayed
  - Single "Mark Complete" action

## Bonus Features Implemented

### Bonus #1: Tab Switching Detection
Detects when student switches tabs during focus session.

**How it works**:
- Uses `document.visibilitychange` event
- Tracks every tab switch during active timer
- Auto-fails session after 3 switches
- Sends tab switch count to backend

**Code Location**: `client/src/App.jsx` lines 36-55

**Why this matters**: Ensures focus integrity, prevents cheating

### Bonus #2: Real-Time WebSocket Updates
Instant updates when mentor assigns intervention - no polling or refresh needed!

**How it works**:
- Frontend connects to Socket.io server on load
- Student registers with their ID
- Server maps student IDs to socket connections
- When mentor assigns task, backend emits event to specific student
- Frontend instantly updates UI

**Code Location**: 
- Server: `server/index.js` lines 16-42, 164-169
- Client: `client/src/App.jsx` lines 67-97

**Why this matters**: Better UX, lower server load, instant feedback loop

## n8n Workflow

The workflow acts as the "Mentor Dispatcher" - the human-in-the-loop component.

### Workflow Steps

1. **Webhook Trigger**: Receives student failure data from backend
2. **Send Email to Mentor**: Notifies mentor with student stats
3. **Wait for Response**: Pauses execution for up to 12 hours
4. **Update Backend**: Calls `/api/assign-intervention` with mentor's task
5. **Send Confirmation**: Confirms task assignment

### Setup Instructions

1. **Import to n8n**:
   - Upload `n8n_workflow/Student_Intervention_Workflow.json`
   - Or copy to n8n Cloud

2. **Configure Webhook**:
   - Copy webhook URL from first node
   - Add to backend `.env` as `N8N_WEBHOOK_URL`

3. **Configure Email**:
   - Add SMTP credentials in email nodes
   - Recommended: Gmail (with App Password) or SendGrid

4. **Set Environment Variable**:
   - In n8n: Add `BACKEND_URL` with your deployed backend URL

5. **Create Mentor Response Form**:
   ```html
   <form action="YOUR_N8N_WAIT_WEBHOOK_URL" method="POST">
     <input type="hidden" name="student_id" value="123">
     <input type="hidden" name="intervention_id" value="1">
     <textarea name="remedial_task"></textarea>
     <input type="email" name="mentor_email">
     <button type="submit">Assign Task</button>
   </form>
   ```

## Fail-Safe Mechanism (Chaos Component)

### The Problem
If mentor doesn't respond within 12 hours, student remains locked indefinitely.

### Solutions Designed

#### 1. **Timeout in n8n** (Implemented)
- Wait node configured with 12-hour timeout
- After timeout, can auto-assign default remedial task

#### 2. **Database-Level Expiry** (Implemented)
- `interventions` table has `expires_at` column
- Set to 12 hours after creation
- Can query for expired interventions

#### 3. **Backend Cron Job** (Recommended for Production)
```javascript
setInterval(async () => {
  const expired = await query(
    'SELECT * FROM interventions WHERE status = "pending" AND expires_at < NOW()'
  );
  
  for (const intervention of expired.rows) {
    await assignDefaultTask(intervention);
  }
}, 3600000);
```

#### 4. **Escalation Strategy**
- **0-6 hours**: Wait for assigned mentor
- **6-12 hours**: Send reminder + escalate to head mentor
- **12-24 hours**: Auto-assign standard remedial task
- **24+ hours**: Auto-unlock with mandatory meeting requirement

### Why This Matters
Prevents system deadlock, ensures students aren't blocked indefinitely, balances automation with human oversight.

## Local Development Setup

### Prerequisites
- Node.js 18+ 
- PostgreSQL 14+
- npm or yarn

### Backend Setup

1. **Install dependencies**:
```bash
cd server
npm install
```

2. **Setup PostgreSQL**:
```bash
createdb alcovia

psql -U postgres
CREATE DATABASE alcovia;
```

3. **Create `.env` file**:
```bash
cp env.example .env
```

Edit `.env`:
```
PORT=3001
DATABASE_URL=postgresql://username:password@localhost:5432/alcovia
N8N_WEBHOOK_URL=https://your-n8n.app.n8n.cloud/webhook/student-intervention
NODE_ENV=development
```

4. **Start server**:
```bash
npm start
```

Server runs on `http://localhost:3001`

### Frontend Setup

1. **Install dependencies**:
```bash
cd client
npm install
```

2. **Create `.env` file** (optional):
```
VITE_API_URL=http://localhost:3001
```

3. **Start development server**:
```bash
npm run dev
```

Frontend runs on `http://localhost:3000`

## Deployment

### Backend Deployment (Heroku)

1. **Create Heroku app**:
```bash
heroku create alcovia-backend
```

2. **Add PostgreSQL**:
```bash
heroku addons:create heroku-postgresql:mini
```

3. **Set environment variables**:
```bash
heroku config:set N8N_WEBHOOK_URL=your_n8n_webhook_url
```

4. **Deploy**:
```bash
git subtree push --prefix server heroku main
```

### Backend Deployment (Railway)

1. **Connect GitHub repo**
2. **Select server folder as root**
3. **Add PostgreSQL service**
4. **Set environment variables**
5. **Deploy automatically on push**

### Frontend Deployment (Vercel)

1. **Install Vercel CLI**:
```bash
npm i -g vercel
```

2. **Deploy from client folder**:
```bash
cd client
vercel
```

3. **Set environment variable**:
```bash
vercel env add VITE_API_URL
```

4. **For production**:
```bash
vercel --prod
```

### Frontend Deployment (Netlify)

1. **Build the app**:
```bash
cd client
npm run build
```

2. **Deploy**:
```bash
netlify deploy --prod --dir=dist
```

3. **Set environment variables** in Netlify dashboard

## Testing the Complete Flow

### Test Case 1: Successful Check-in
1. Open app at deployed URL
2. Click "Start Focus Session"
3. Wait 61+ minutes (or manually set for testing)
4. Enter quiz score 8-10
5. Click "Submit Daily Check-in"
6. **Expected**: Status changes to "On Track", success message shown

### Test Case 2: Failed Check-in → Intervention Flow
1. Start focus timer, stop at < 60 minutes
2. Enter quiz score < 8
3. Submit check-in
4. **Expected**: 
   - App enters LOCKED state 
   - n8n workflow triggers
   - Mentor receives email
5. Click link in email (or use form)
6. Assign remedial task
7. **Expected**:
   - App instantly unlocks (WebSocket magic!)
   - Shows remedial task
8. Click "Mark Complete"
9. **Expected**: Returns to ACTIVE state

### Test Case 3: Tab Switching Detection
1. Start focus timer
2. Switch to another tab/window
3. Return to app
4. **Expected**: Tab switch counter increases
5. Switch 3+ times
6. **Expected**: Session auto-fails, warning shown

## Environment Variables

### Backend
| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `DATABASE_URL` | PostgreSQL connection | `postgresql://user:pass@localhost:5432/alcovia` |
| `N8N_WEBHOOK_URL` | n8n webhook endpoint | `https://n8n.app.n8n.cloud/webhook/student-intervention` |
| `CLIENT_URL` | Frontend URL for CORS | `https://your-app.vercel.app` |

### Frontend
| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `https://alcovia-backend.herokuapp.com` |

### n8n
| Variable | Description | Example |
|----------|-------------|---------|
| `BACKEND_URL` | Backend API URL | `https://alcovia-backend.herokuapp.com` |

## System Design Concepts

### 1. State Machine Pattern
**Why**: Prevents invalid state transitions. A student in `needs_intervention` can ONLY move to `remedial` (not directly to `active`).

**Benefits**:
- Predictable behavior
- Easy to debug
- Clear business logic

### 2. WebSocket vs Polling
**Polling** (traditional):
```javascript
// Client polls every 5 seconds
setInterval(() => fetch('/api/student/123'), 5000);
// Problems: Server load, delayed updates, wasted requests
```

**WebSocket** (our approach):
```javascript
socket.on('intervention_assigned', (data) => {
  updateUI(data); // Instant!
});
```

### 3. ACID Compliance in SQL
**Why not NoSQL?**
- Educational data requires consistency
- Relationships between students, logs, interventions must be maintained
- Transactions ensure data integrity (e.g., log + intervention created atomically)

### 4. Separation of Concerns
- **Backend**: Business logic, data validation, state management
- **n8n**: Notification, mentor workflow, timing
- **Frontend**: Presentation, user interaction, real-time updates

## Key Learnings & Concepts

### The "Digital Rigour" Principle
The system enforces **consequences** - if you fail, you're locked out. This creates accountability.

### Human-in-the-Loop AI
Not everything should be automated. Mentor judgment is crucial - the system facilitates but doesn't replace human decision-making.

### Real-Time Systems
WebSockets enable **event-driven** rather than **request-response** architecture. This is fundamental to modern real-time apps (chat, notifications, live updates).

### State Management
Frontend React state + Backend DB state + WebSocket sync = Complex but powerful. Understanding state synchronization is crucial for full-stack development.

## Troubleshooting

### Database Connection Error
```
Error: connect ECONNREFUSED
```
**Solution**: Check PostgreSQL is running, verify `DATABASE_URL`

### n8n Webhook Not Triggering
**Solution**: 
- Ensure workflow is activated
- Check backend logs for webhook POST request
- Verify `N8N_WEBHOOK_URL` is correct

### WebSocket Not Connecting
```
WebSocket connection to 'ws://localhost:3001' failed
```
**Solution**: 
- Check backend is running
- Verify CORS settings
- Check firewall/network settings

### Student Stuck in LOCKED State
**Solution**:
- Check n8n workflow execution logs
- Manually update DB: `UPDATE students SET status = 'active' WHERE student_id = '123';`
- Implement fail-safe mechanism



