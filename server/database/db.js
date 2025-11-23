import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// PostgreSQL connection pool for efficient connection management
// Pool maintains multiple connections and reuses them for better performance
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Connection pool settings
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 2000, // How long to wait for a connection
});

// Test database connection on startup
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
  process.exit(-1);
});

// Helper function to execute queries with error handling
export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('📊 Query executed:', { text: text.substring(0, 50) + '...', duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('❌ Query error:', error);
    throw error;
  }
};

// Initialize database schema
export const initDatabase = async () => {
  try {
    // Create tables if they don't exist
    await query(`
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

    await query(`
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

    await query(`
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

    // Create indexes
    await query(`CREATE INDEX IF NOT EXISTS idx_students_student_id ON students(student_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_daily_logs_student_id ON daily_logs(student_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_interventions_student_id ON interventions(student_id);`);

    // Insert sample student for testing
    await query(`
      INSERT INTO students (student_id, name, email, status) 
      VALUES ('123', 'Test Student', 'student@test.com', 'active')
      ON CONFLICT (student_id) DO NOTHING;
    `);

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
};

export default pool;

