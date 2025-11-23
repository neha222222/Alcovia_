import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

// Use relative API URL for Vercel deployment (same domain)
const API_URL = import.meta.env.VITE_API_URL || '';
const STUDENT_ID = '123'; // Default test student

/**
 * Main Application Component
 * 
 * STATE MACHINE:
 * 1. ACTIVE: Normal state - can start focus timer and submit quiz
 * 2. NEEDS_INTERVENTION: Locked state - waiting for mentor review
 * 3. REMEDIAL: Unlocked with remedial task - must complete task
 * 4. ON_TRACK: Success state - shows positive feedback
 */
function App() {
  // Student state management
  const [studentStatus, setStudentStatus] = useState('active');
  const [intervention, setIntervention] = useState(null);
  const [loading, setLoading] = useState(true);

  // Focus timer state
  const [focusMinutes, setFocusMinutes] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerStartTime, setTimerStartTime] = useState(null);

  // Quiz state
  const [quizScore, setQuizScore] = useState('');

  // Tab switching detection (Bonus Challenge #1)
  const [tabSwitches, setTabSwitches] = useState(0);
  const [isTabActive, setIsTabActive] = useState(true);

  // Alert messages
  const [alert, setAlert] = useState(null);

  /**
   * BONUS CHALLENGE #1: Tab Switching Detection
   * Detects when user switches tabs during focus session
   * Automatically fails session if too many switches occur
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isTimerRunning) {
        // User switched away from tab during focus session
        setTabSwitches(prev => {
          const newCount = prev + 1;
          console.log('⚠️ Tab switch detected! Count:', newCount);
          
          if (newCount >= 3) {
            // Auto-fail session after 3 tab switches
            setIsTimerRunning(false);
            showAlert('Session failed! You switched tabs too many times.', 'error');
          }
          
          return newCount;
        });
        setIsTabActive(false);
      } else if (!document.hidden) {
        setIsTabActive(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isTimerRunning]);

  // Fetch initial student status
  useEffect(() => {
    fetchStudentStatus();
  }, []);

  // Timer update effect
  useEffect(() => {
    let interval;
    if (isTimerRunning) {
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - timerStartTime) / 60000);
        setFocusMinutes(elapsed);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timerStartTime]);

  const fetchStudentStatus = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/student/${STUDENT_ID}`);
      setStudentStatus(response.data.student.status);
      setIntervention(response.data.intervention);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching student status:', error);
      showAlert('Failed to load student data', 'error');
      setLoading(false);
    }
  };

  const showAlert = (message, type) => {
    setAlert({ message, type });
    setTimeout(() => setAlert(null), 5000);
  };

  const startFocusTimer = () => {
    setIsTimerRunning(true);
    setTimerStartTime(Date.now());
    setFocusMinutes(0);
    setTabSwitches(0);
    showAlert('Focus timer started! Stay on this tab.', 'success');
  };

  const stopFocusTimer = () => {
    setIsTimerRunning(false);
    showAlert(`Timer stopped at ${focusMinutes} minutes`, 'success');
  };

  const submitDailyCheckin = async () => {
    if (!quizScore || quizScore === '') {
      showAlert('Please enter your quiz score', 'error');
      return;
    }

    const score = parseInt(quizScore);
    if (score < 0 || score > 10) {
      showAlert('Quiz score must be between 0 and 10', 'error');
      return;
    }

    if (focusMinutes === 0) {
      showAlert('Please complete a focus session first', 'error');
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post(`${API_URL}/api/daily-checkin`, {
        student_id: STUDENT_ID,
        quiz_score: score,
        focus_minutes: focusMinutes,
        tab_switches: tabSwitches
      });

      console.log('Check-in response:', response.data);

      if (response.data.passed) {
        setStudentStatus('on_track');
        showAlert(response.data.message, 'success');
      } else {
        setStudentStatus('needs_intervention');
        showAlert(response.data.message, 'warning');
      }

      // Reset form
      setQuizScore('');
      setFocusMinutes(0);
      setIsTimerRunning(false);
      setTabSwitches(0);

      setLoading(false);
    } catch (error) {
      console.error('Error submitting check-in:', error);
      showAlert('Failed to submit check-in', 'error');
      setLoading(false);
    }
  };

  const completeRemedialTask = async () => {
    try {
      setLoading(true);
      await axios.post(`${API_URL}/api/complete-remedial`, {
        student_id: STUDENT_ID,
        intervention_id: intervention?.id
      });

      setStudentStatus('active');
      setIntervention(null);
      showAlert('Great job! You can now continue with daily check-ins.', 'success');
      setLoading(false);
    } catch (error) {
      console.error('Error completing remedial:', error);
      showAlert('Failed to complete remedial task', 'error');
      setLoading(false);
    }
  };

  const formatTime = (minutes) => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`;
  };

  const getStatusBadgeClass = () => {
    switch (studentStatus) {
      case 'active': return 'status-active';
      case 'on_track': return 'status-on-track';
      case 'needs_intervention': return 'status-needs-intervention';
      case 'remedial': return 'status-remedial';
      default: return 'status-active';
    }
  };

  const getStatusText = () => {
    switch (studentStatus) {
      case 'active': return 'Active';
      case 'on_track': return 'On Track';
      case 'needs_intervention': return 'Pending Review';
      case 'remedial': return 'Remedial Task';
      default: return 'Unknown';
    }
  };

  if (loading) {
    return (
      <div className="app-container">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="header">
        <h1>🎓 Alcovia Focus</h1>
        <p>Student Intervention Engine</p>
        <div className={`status-badge ${getStatusBadgeClass()}`}>
          {getStatusText()}
        </div>
      </header>

      <main className="main-content">
        {alert && (
          <div className={`alert alert-${alert.type}`}>
            {alert.message}
          </div>
        )}

        {/* STATE 1: ACTIVE - Normal operation */}
        {studentStatus === 'active' && (
          <>
            <div className="card">
              <h2>⏱️ Focus Timer</h2>
              <div className="timer-display">
                {formatTime(focusMinutes)}
              </div>
              {!isTimerRunning ? (
                <button className="button button-primary" onClick={startFocusTimer}>
                  Start Focus Session
                </button>
              ) : (
                <>
                  <button className="button button-danger" onClick={stopFocusTimer}>
                    Stop Timer
                  </button>
                  {tabSwitches > 0 && (
                    <div className="tab-warning">
                      ⚠️ Tab switches: {tabSwitches}/3 - Stay focused!
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="card">
              <h2>📝 Daily Quiz</h2>
              <div className="form-group">
                <label>Enter your quiz score (0-10):</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={quizScore}
                  onChange={(e) => setQuizScore(e.target.value)}
                  placeholder="Enter score..."
                />
              </div>
              <button
                className="button button-success"
                onClick={submitDailyCheckin}
                disabled={focusMinutes === 0 || !quizScore}
              >
                Submit Daily Check-in
              </button>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{focusMinutes}</div>
                <div className="stat-label">Focus Minutes</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{quizScore || '-'}</div>
                <div className="stat-label">Quiz Score</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{tabSwitches}</div>
                <div className="stat-label">Tab Switches</div>
              </div>
            </div>
          </>
        )}

        {/* STATE 2: ON_TRACK - Success state */}
        {studentStatus === 'on_track' && (
          <>
            <div className="card">
              <h2>✅ Excellent Work!</h2>
              <p style={{ fontSize: '1.2rem', color: '#059669', marginBottom: '20px' }}>
                You're doing great! Your focus and quiz performance are on track.
              </p>
              <button 
                className="button button-primary" 
                onClick={async () => {
                  try {
                    // Reset locally first for instant UI update
                    setStudentStatus('active');
                    setQuizScore('');
                    setFocusMinutes(0);
                    setTabSwitches(0);
                    
                    // Update database status to active
                    await axios.post(`${API_URL}/api/complete-remedial`, {
                      student_id: STUDENT_ID,
                      intervention_id: null
                    });
                  } catch (error) {
                    console.error('Error resetting session:', error);
                  }
                }}
              >
                Start New Session
              </button>
            </div>
          </>
        )}

        {/* STATE 3: NEEDS_INTERVENTION - Locked state */}
        {studentStatus === 'needs_intervention' && (
          <div className="locked-screen">
            <div className="locked-icon">🔒</div>
            <h2>Analysis in Progress</h2>
            <p>Your performance needs attention. A mentor is reviewing your progress.</p>
            <p style={{ marginTop: '20px', fontWeight: 600 }}>
              Please wait for mentor feedback...
            </p>
            <div className="spinner" style={{ marginTop: '30px' }}></div>
            <p style={{ marginTop: '20px', fontSize: '0.9rem', color: '#9ca3af' }}>
              💡 Refresh the page to check if mentor has assigned a task
            </p>
          </div>
        )}

        {/* STATE 4: REMEDIAL - Unlocked with task */}
        {studentStatus === 'remedial' && intervention && (
          <div className="remedial-screen">
            <div className="remedial-icon">📚</div>
            <h2>Remedial Task Assigned</h2>
            <p>A mentor has reviewed your progress and assigned a task.</p>
            
            <div className="remedial-task">
              <h3>Your Task:</h3>
              <p>{intervention.remedial_task}</p>
              {intervention.mentor_email && (
                <p style={{ marginTop: '15px', fontSize: '0.9rem', color: '#78350f' }}>
                  Assigned by: {intervention.mentor_email}
                </p>
              )}
            </div>

            <button 
              className="button button-success" 
              onClick={completeRemedialTask}
            >
              Mark as Complete
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
