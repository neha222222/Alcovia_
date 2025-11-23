import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { query, initDatabase } from './database/db.js';
import axios from 'axios';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// WebSocket setup for real-time communication
// This enables instant updates when mentor unlocks a student
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Store connected clients mapped by student_id for targeted updates
const connectedStudents = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  // Student identifies themselves
  socket.on('register', (studentId) => {
    connectedStudents.set(studentId, socket.id);
    console.log(`📝 Student ${studentId} registered with socket ${socket.id}`);
  });

  socket.on('disconnect', () => {
    // Remove from connected students
    for (const [studentId, socketId] of connectedStudents.entries()) {
      if (socketId === socket.id) {
        connectedStudents.delete(studentId);
        console.log(`👋 Student ${studentId} disconnected`);
        break;
      }
    }
  });
});

// Helper function to notify student via WebSocket
const notifyStudent = (studentId, event, data) => {
  const socketId = connectedStudents.get(studentId);
  if (socketId) {
    io.to(socketId).emit(event, data);
    console.log(`📡 Sent ${event} to student ${studentId}`);
  }
};

// ============================================
// API ENDPOINTS
// ============================================

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Get student status and current intervention
app.get('/api/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;

    const studentResult = await query(
      'SELECT * FROM students WHERE student_id = $1',
      [studentId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = studentResult.rows[0];

    // Get current intervention if exists
    let intervention = null;
    if (student.status === 'needs_intervention' || student.status === 'remedial') {
      const interventionResult = await query(
        `SELECT * FROM interventions 
         WHERE student_id = $1 AND status IN ('pending', 'assigned') 
         ORDER BY created_at DESC LIMIT 1`,
        [studentId]
      );
      intervention = interventionResult.rows[0] || null;
    }

    res.json({
      student,
      intervention,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/daily-checkin
 * The core logic gate that determines student state
 * 
 * Success criteria: quiz_score > 7 AND focus_minutes > 60
 * Failure: Triggers intervention workflow via n8n webhook
 */
app.post('/api/daily-checkin', async (req, res) => {
  try {
    const { student_id, quiz_score, focus_minutes, tab_switches = 0 } = req.body;

    // Validation
    if (!student_id || quiz_score === undefined || focus_minutes === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: student_id, quiz_score, focus_minutes' 
      });
    }

    if (quiz_score < 0 || quiz_score > 10) {
      return res.status(400).json({ error: 'quiz_score must be between 0 and 10' });
    }

    if (focus_minutes < 0) {
      return res.status(400).json({ error: 'focus_minutes must be non-negative' });
    }

    // Check if student exists
    const studentCheck = await query(
      'SELECT * FROM students WHERE student_id = $1',
      [student_id]
    );

    if (studentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = studentCheck.rows[0];

    // THE LOGIC GATE: Determine pass/fail
    const passed = quiz_score > 7 && focus_minutes > 60 && tab_switches < 3;

    // Insert daily log
    const logResult = await query(
      `INSERT INTO daily_logs (student_id, quiz_score, focus_minutes, tab_switches, passed, session_date)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
       RETURNING *`,
      [student_id, quiz_score, focus_minutes, tab_switches, passed]
    );

    const dailyLog = logResult.rows[0];

    if (passed) {
      // SUCCESS PATH: Update student status to "on_track"
      await query(
        `UPDATE students SET status = 'on_track', updated_at = CURRENT_TIMESTAMP 
         WHERE student_id = $1`,
        [student_id]
      );

      console.log(`✅ Student ${student_id} passed daily check-in`);
      
      notifyStudent(student_id, 'status_update', { status: 'on_track' });

      return res.json({
        status: 'On Track',
        message: 'Great job! Keep up the good work.',
        data: dailyLog,
        passed: true
      });
    } else {
      // FAILURE PATH: Trigger intervention
      await query(
        `UPDATE students SET status = 'needs_intervention', updated_at = CURRENT_TIMESTAMP 
         WHERE student_id = $1`,
        [student_id]
      );

      // Create intervention record
      const interventionResult = await query(
        `INSERT INTO interventions (student_id, trigger_log_id, status, expires_at)
         VALUES ($1, $2, 'pending', CURRENT_TIMESTAMP + INTERVAL '12 hours')
         RETURNING *`,
        [student_id, dailyLog.id]
      );

      const intervention = interventionResult.rows[0];

      console.log(`⚠️ Student ${student_id} failed check-in. Triggering intervention...`);

      // Trigger n8n webhook
      if (process.env.N8N_WEBHOOK_URL) {
        try {
          await axios.post(process.env.N8N_WEBHOOK_URL, {
            student_id,
            student_name: student.name,
            student_email: student.email,
            quiz_score,
            focus_minutes,
            tab_switches,
            intervention_id: intervention.id,
            timestamp: new Date().toISOString()
          });
          console.log('📨 n8n webhook triggered successfully');
        } catch (webhookError) {
          console.error('❌ Failed to trigger n8n webhook:', webhookError.message);
        }
      }

      notifyStudent(student_id, 'status_update', { status: 'needs_intervention' });

      return res.json({
        status: 'Pending Mentor Review',
        message: 'Your performance needs attention. A mentor will review soon.',
        data: dailyLog,
        passed: false,
        intervention_id: intervention.id
      });
    }
  } catch (error) {
    console.error('Error in daily-checkin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/assign-intervention
 * Called by n8n after mentor assigns a remedial task
 * This "unlocks" the student with a specific task
 */
app.post('/api/assign-intervention', async (req, res) => {
  try {
    const { student_id, remedial_task, mentor_email, intervention_id } = req.body;

    if (!student_id || !remedial_task) {
      return res.status(400).json({ 
        error: 'Missing required fields: student_id, remedial_task' 
      });
    }

    // Update intervention
    await query(
      `UPDATE interventions 
       SET status = 'assigned', 
           remedial_task = $1, 
           mentor_email = $2,
           assigned_at = CURRENT_TIMESTAMP
       WHERE student_id = $3 AND id = $4`,
      [remedial_task, mentor_email, student_id, intervention_id]
    );

    // Update student status to remedial
    await query(
      `UPDATE students SET status = 'remedial', updated_at = CURRENT_TIMESTAMP 
       WHERE student_id = $1`,
      [student_id]
    );

    console.log(`✅ Remedial task assigned to student ${student_id}`);

    // Real-time notification via WebSocket
    notifyStudent(student_id, 'intervention_assigned', {
      status: 'remedial',
      remedial_task,
      mentor_email
    });

    res.json({
      success: true,
      message: 'Intervention assigned successfully',
      student_id,
      remedial_task
    });
  } catch (error) {
    console.error('Error assigning intervention:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/complete-remedial
 * Student marks remedial task as complete
 */
app.post('/api/complete-remedial', async (req, res) => {
  try {
    const { student_id, intervention_id } = req.body;

    if (!student_id) {
      return res.status(400).json({ error: 'Missing student_id' });
    }

    // Update intervention to completed
    await query(
      `UPDATE interventions 
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE student_id = $1 AND id = $2`,
      [student_id, intervention_id]
    );

    // Update student status back to active
    await query(
      `UPDATE students SET status = 'active', updated_at = CURRENT_TIMESTAMP 
       WHERE student_id = $1`,
      [student_id]
    );

    console.log(`✅ Student ${student_id} completed remedial task`);

    notifyStudent(student_id, 'status_update', { status: 'active' });

    res.json({
      success: true,
      message: 'Remedial task completed. You can now proceed with daily check-ins.',
      status: 'active'
    });
  } catch (error) {
    console.error('Error completing remedial:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get student history
app.get('/api/student/:studentId/history', async (req, res) => {
  try {
    const { studentId } = req.params;

    const logs = await query(
      `SELECT * FROM daily_logs 
       WHERE student_id = $1 
       ORDER BY created_at DESC 
       LIMIT 30`,
      [studentId]
    );

    const interventions = await query(
      `SELECT * FROM interventions 
       WHERE student_id = $1 
       ORDER BY created_at DESC 
       LIMIT 10`,
      [studentId]
    );

    res.json({
      logs: logs.rows,
      interventions: interventions.rows
    });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Initialize database and start server
const PORT = process.env.PORT || 3001;

initDatabase()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 WebSocket server ready for real-time updates`);
      console.log(`🔗 API: http://localhost:${PORT}/api`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });

export { io, notifyStudent };

