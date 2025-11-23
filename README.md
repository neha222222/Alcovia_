# Alcovia - Intervention Engine

A **closed-loop intervention system** that detects when students fall behind in real-time and automatically triggers a mentorship workflow. This system creates a seamless connection between Student App, Backend Server, and Automation Workflow.

## Live Demo

- **Deployment**: [[Alcovia](https://alcovia-ten.vercel.app/)]
- **Demo Video**: 

https://github.com/user-attachments/assets/8a12a22c-5272-431a-aaa9-ae4317f10e5f

## Screenshots of table schemas
![1,](https://github.com/user-attachments/assets/4c23d3fc-533e-405c-8553-4abebd37b622)

![2,](https://github.com/user-attachments/assets/02f9b1b0-175a-4f95-aad8-7deb5d1bc626)

![3,](https://github.com/user-attachments/assets/2a93da5a-c745-4743-a22c-3e0e9dc84682)



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

