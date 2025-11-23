import pg from 'pg';
import axios from 'axios';

const { Pool } = pg;

let pool;
const getPool = () => {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
};

const initDatabase = async (pool) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_logs (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(100) REFERENCES students(student_id) ON DELETE CASCADE,
        quiz_score INTEGER,
        focus_minutes INTEGER,
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
        status VARCHAR(50) DEFAULT 'pending',
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
  } catch (error) {
    console.error('DB init error:', error);
  }
};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const pool = getPool();
    await initDatabase(pool);
    
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
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}

