// Vercel Serverless API Handler
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import pg from 'pg';
import axios from 'axios';

const { Pool } = pg;

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Database connection
let pool;
const initPool = () => {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
};

// Initialize database schema
const initDatabase = async () => {
  const pool = initPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'needs_intervention', 'remedial', 'on_track')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_logs (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(100) REFERENCES students(student_id) ON DELETE CASCADE,
        quiz_score INTEGER CHECK (quiz_score >= 0 AND quiz_score <= 10),
        focus_minutes INTEGER CHECK (focus_minutes >= 0),
        session_date DATE DEFAULT CURRENT_DATE,
        passed BOOLEAN,
        tab_switches INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS interventions (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(100) REFERENCES students(student_id) ON DELETE CASCADE,
        trigger_log_id INTEGER REFERENCES daily_logs(id),
        mentor_email VARCHAR(255),
        remedial_task TEXT,
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'completed', 'expired')),
        assigned_at TIMESTAMP,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP
      );
    `);

    await pool.query(`
      INSERT INTO students (student_id, name, email, status) 
      VALUES ('123', 'Test Student', 'student@test.com', 'active')
      ON CONFLICT (student_id) DO NOTHING;
    `);

    console.log('✅ Database initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Get student status
app.get('/api/student/:studentId', async (req, res) => {
  try {
    const pool = initPool();
    await initDatabase();
    
    const { studentId } = req.params;
    const studentResult = await pool.query(
      'SELECT * FROM students WHERE student_id = $1',
      [studentId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = studentResult.rows[0];
    let intervention = null;
    
    if (student.status === 'needs_intervention' || student.status === 'remedial') {
      const interventionResult = await pool.query(
        `SELECT * FROM interventions 
         WHERE student_id = $1 AND status IN ('pending', 'assigned') 
         ORDER BY created_at DESC LIMIT 1`,
        [studentId]
      );
      intervention = interventionResult.rows[0] || null;
    }

    res.json({ student, intervention, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Daily check-in
app.post('/api/daily-checkin', async (req, res) => {
  try {
    const pool = initPool();
    await initDatabase();
    
    const { student_id, quiz_score, focus_minutes, tab_switches = 0 } = req.body;

    if (!student_id || quiz_score === undefined || focus_minutes === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: student_id, quiz_score, focus_minutes' 
      });
    }

    const studentCheck = await pool.query(
      'SELECT * FROM students WHERE student_id = $1',
      [student_id]
    );

    if (studentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = studentCheck.rows[0];
    const passed = quiz_score > 7 && focus_minutes > 60 && tab_switches < 3;

    const logResult = await pool.query(
      `INSERT INTO daily_logs (student_id, quiz_score, focus_minutes, tab_switches, passed, session_date)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
       RETURNING *`,
      [student_id, quiz_score, focus_minutes, tab_switches, passed]
    );

    const dailyLog = logResult.rows[0];

    if (passed) {
      await pool.query(
        `UPDATE students SET status = 'on_track', updated_at = CURRENT_TIMESTAMP 
         WHERE student_id = $1`,
        [student_id]
      );

      return res.json({
        status: 'On Track',
        message: 'Great job! Keep up the good work.',
        data: dailyLog,
        passed: true
      });
    } else {
      await pool.query(
        `UPDATE students SET status = 'needs_intervention', updated_at = CURRENT_TIMESTAMP 
         WHERE student_id = $1`,
        [student_id]
      );

      const interventionResult = await pool.query(
        `INSERT INTO interventions (student_id, trigger_log_id, status, expires_at)
         VALUES ($1, $2, 'pending', CURRENT_TIMESTAMP + INTERVAL '12 hours')
         RETURNING *`,
        [student_id, dailyLog.id]
      );

      const intervention = interventionResult.rows[0];

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
        } catch (webhookError) {
          console.error('Failed to trigger n8n:', webhookError.message);
        }
      }

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

// Assign intervention
app.post('/api/assign-intervention', async (req, res) => {
  try {
    const pool = initPool();
    const { student_id, remedial_task, mentor_email, intervention_id } = req.body;

    if (!student_id || !remedial_task) {
      return res.status(400).json({ 
        error: 'Missing required fields: student_id, remedial_task' 
      });
    }

    await pool.query(
      `UPDATE interventions 
       SET status = 'assigned', 
           remedial_task = $1, 
           mentor_email = $2,
           assigned_at = CURRENT_TIMESTAMP
       WHERE student_id = $3 AND id = $4`,
      [remedial_task, mentor_email, student_id, intervention_id]
    );

    await pool.query(
      `UPDATE students SET status = 'remedial', updated_at = CURRENT_TIMESTAMP 
       WHERE student_id = $1`,
      [student_id]
    );

    res.json({
      success: true,
      message: 'Intervention assigned successfully',
      student_id,
      remedial_task
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Complete remedial
app.post('/api/complete-remedial', async (req, res) => {
  try {
    const pool = initPool();
    const { student_id, intervention_id } = req.body;

    if (!student_id) {
      return res.status(400).json({ error: 'Missing student_id' });
    }

    await pool.query(
      `UPDATE interventions 
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE student_id = $1 AND id = $2`,
      [student_id, intervention_id]
    );

    await pool.query(
      `UPDATE students SET status = 'active', updated_at = CURRENT_TIMESTAMP 
       WHERE student_id = $1`,
      [student_id]
    );

    res.json({
      success: true,
      message: 'Remedial task completed.',
      status: 'active'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Student history
app.get('/api/student/:studentId/history', async (req, res) => {
  try {
    const pool = initPool();
    const { studentId } = req.params;

    const logs = await pool.query(
      `SELECT * FROM daily_logs 
       WHERE student_id = $1 
       ORDER BY created_at DESC 
       LIMIT 30`,
      [studentId]
    );

    const interventions = await pool.query(
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
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;

