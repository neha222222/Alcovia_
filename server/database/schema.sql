-- Alcovia Intervention Engine Database Schema
-- This schema implements a state machine for student intervention tracking

-- Students Table: Core student information and current state
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'needs_intervention', 'remedial', 'on_track')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Daily Logs: Tracks daily check-ins with quiz scores and focus time
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

-- Interventions: Tracks mentor interventions and remedial tasks
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_students_student_id ON students(student_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_daily_logs_student_id ON daily_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(session_date);
CREATE INDEX IF NOT EXISTS idx_interventions_student_id ON interventions(student_id);
CREATE INDEX IF NOT EXISTS idx_interventions_status ON interventions(status);

-- Insert sample student for testing
INSERT INTO students (student_id, name, email, status) 
VALUES ('123', 'Test Student', 'student@test.com', 'active')
ON CONFLICT (student_id) DO NOTHING;

COMMENT ON TABLE students IS 'Stores student profiles and their current intervention state';
COMMENT ON TABLE daily_logs IS 'Records daily check-ins with quiz scores and focus time';
COMMENT ON TABLE interventions IS 'Tracks mentor interventions and remedial tasks assigned to students';

