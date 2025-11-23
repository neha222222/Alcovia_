import pg from 'pg';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const pool = getPool();
    await initDatabase(pool);
    const { studentId } = req.query;
    
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
}

