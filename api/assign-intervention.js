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
}

