import React, { useState, useEffect } from 'react';
import './App.css';

const API_URL = 'http://localhost:3001/api';

function App() {
  // State Management
  const [user, setUser] = useState(null);
  const [currentView, setCurrentView] = useState('login');
  const [questions, setQuestions] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [score, setScore] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [topics, setTopics] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState('');
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [explanation, setExplanation] = useState(null);
  const [hearts, setHearts] = useState(5);
  const [totalXP, setTotalXP] = useState(0);

  // Auth State
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ username: '', email: '', password: '' });

  // Icons as text/symbols
  const icons = {
    arrays: '[  ]',
    linkedlists: '->->',
    stacks_queues: '[ | ]',
    trees: '/\\',
    graphs: '<->',
    dp: '{}',
    sorting: '↑↓',
    bits: '101',
    advanced: '⚙'
  };

  // Fetch topics on mount
  useEffect(() => {
    fetchTopics();
    fetchLeaderboard();
  }, []);

  const fetchTopics = async () => {
    try {
      const response = await fetch(`${API_URL}/topics`);
      const data = await response.json();
      setTopics(data.topics || []);
    } catch (err) {
      console.error('Failed to fetch topics');
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch(`${API_URL}/leaderboard`);
      const data = await response.json();
      setLeaderboard(data.leaderboard || []);
    } catch (err) {
      console.error('Failed to fetch leaderboard');
    }
  };

  const login = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setUser(data.user);
        setTotalXP(data.user.totalXP || 0);
        setHearts(data.user.hearts || 5);
        localStorage.setItem('token', data.token);
        setCurrentView('dashboard');
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err) {
      setError('Connection failed');
    }
    setLoading(false);
  };

  const register = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerForm)
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setUser(data.user);
        setTotalXP(data.user.totalXP || 0);
        setHearts(data.user.hearts || 5);
        localStorage.setItem('token', data.token);
        setCurrentView('dashboard');
      } else {
        setError(data.error || 'Registration failed');
      }
    } catch (err) {
      setError('Connection failed');
    }
    setLoading(false);
  };

  const startLesson = async (topic) => {
    if (hearts <= 0) {
      setError('No hearts left! Wait for them to regenerate.');
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/questions/random?category=${topic}&count=10`);
      const data = await response.json();
      setQuestions(data.questions || []);
      setCurrentQuestion(0);
      setScore(0);
      setSelectedAnswer('');
      setShowFeedback(false);
      setCurrentView('lesson');
    } catch (err) {
      setError('Failed to load questions');
    }
    setLoading(false);
  };

  const handleAnswer = async (answer) => {
    setSelectedAnswer(answer);
    const correct = answer === questions[currentQuestion].correct;
    setIsCorrect(correct);
    setShowFeedback(true);
    
    if (correct) {
      const xpGained = questions[currentQuestion].xp || 10;
      setScore(score + xpGained);
      setTotalXP(prev => prev + xpGained);
      setUser(prev => ({ ...prev, totalXP: (prev.totalXP || 0) + xpGained }));
    } else {
      setHearts(prev => Math.max(0, prev - 1));
      if (hearts <= 1) {
        setTimeout(() => {
          setCurrentView('results');
        }, 2000);
      }
    }
    
    // Submit progress
    if (user) {
      try {
        const response = await fetch(`${API_URL}/progress/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: user.username,
            questionId: questions[currentQuestion].id,
            correct,
            category: selectedTopic
          })
        });
        
        const data = await response.json();
        if (data.totalXP) {
          setTotalXP(data.totalXP);
          setUser(prev => ({ ...prev, totalXP: data.totalXP, level: data.level }));
        }
      } catch (err) {
        console.error('Failed to submit progress');
      }
    }
  };

  const nextQuestion = () => {
    if (hearts <= 0) {
      setCurrentView('results');
      return;
    }
    
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
      setSelectedAnswer('');
      setShowFeedback(false);
      setHint('');
      setExplanation(null);
    } else {
      setCurrentView('results');
      fetchLeaderboard();
    }
  };

  const getHint = async () => {
    if (!user || user.gems < 5) {
      setError('Not enough gems!');
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/ai/hint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: questions[currentQuestion].id,
          username: user.username
        })
      });
      
      const data = await response.json();
      setHint(data.hint);
      setUser({ ...user, gems: data.gemsRemaining });
    } catch (err) {
      setError('Failed to get hint');
    }
  };

  const getExplanation = async () => {
    try {
      const response = await fetch(`${API_URL}/ai/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: questions[currentQuestion].id
        })
      });
      
      const data = await response.json();
      setExplanation(data.explanation);
    } catch (err) {
      console.error('Failed to get explanation');
    }
  };

  // Login View
  if (currentView === 'login') {
    return (
      <div className="min-h-screen login-bg flex items-center justify-center p-4">
        <div className="glass-card rounded-3xl p-8 w-full max-w-md">
          <h1 className="text-4xl font-bold text-white mb-2 text-center">DS&A Master</h1>
          <p className="text-white-70 text-center mb-8">Master Data Structures & Algorithms</p>
          
          {error && (
            <div className="error-box rounded-lg mb-4 p-3">
              {error}
            </div>
          )}
          
          <form onSubmit={login} className="space-y-4">
            <input
              type="text"
              placeholder="Username"
              value={loginForm.username}
              onChange={(e) => setLoginForm({...loginForm, username: e.target.value})}
              className="input-field"
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={loginForm.password}
              onChange={(e) => setLoginForm({...loginForm, password: e.target.value})}
              className="input-field"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? 'Loading...' : 'Login'}
            </button>
          </form>
          
          <div className="mt-6 text-center">
            <p className="text-white-70">Don't have an account?</p>
            <button
              onClick={() => setCurrentView('register')}
              className="text-white font-semibold hover-underline mt-2"
            >
              Create Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Register View
  if (currentView === 'register') {
    return (
      <div className="min-h-screen login-bg flex items-center justify-center p-4">
        <div className="glass-card rounded-3xl p-8 w-full max-w-md">
          <h1 className="text-4xl font-bold text-white mb-2 text-center">Create Account</h1>
          <p className="text-white-70 text-center mb-8">Join the learning platform</p>
          
          {error && (
            <div className="error-box rounded-lg mb-4 p-3">
              {error}
            </div>
          )}
          
          <form onSubmit={register} className="space-y-4">
            <input
              type="text"
              placeholder="Username"
              value={registerForm.username}
              onChange={(e) => setRegisterForm({...registerForm, username: e.target.value})}
              className="input-field"
              required
            />
            <input
              type="email"
              placeholder="Email"
              value={registerForm.email}
              onChange={(e) => setRegisterForm({...registerForm, email: e.target.value})}
              className="input-field"
              required
            />
            <input
              type="password"
              placeholder="Password (min 6 characters)"
              value={registerForm.password}
              onChange={(e) => setRegisterForm({...registerForm, password: e.target.value})}
              className="input-field"
              required
              minLength="6"
            />
            <button
              type="submit"
              disabled={loading}
              className="btn-success w-full"
            >
              {loading ? 'Creating...' : 'Create Account'}
            </button>
          </form>
          
          <div className="mt-6 text-center">
            <button
              onClick={() => setCurrentView('login')}
              className="text-white-70 hover-text-white"
            >
              ← Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard View
  if (currentView === 'dashboard') {
    return (
      <div className="min-h-screen dashboard-bg text-white">
        <header className="header-bar p-4">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <h1 className="text-2xl font-bold">DS&A Master</h1>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-4">
                <span>Level {user?.level || Math.floor(totalXP / 100) + 1}</span>
                <span className="text-yellow">{totalXP} XP</span>
                <span>{user?.gems || 100} Gems</span>
                <span className="text-red">{hearts}/5 Hearts</span>
              </div>
              <button
                onClick={() => {
                  setUser(null);
                  localStorage.removeItem('token');
                  setCurrentView('login');
                }}
                className="btn-logout"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto p-6">
          <h2 className="text-3xl font-bold mb-6">Choose Your Topic</h2>
          <div className="grid grid-cols-1 md-grid-cols-2 lg-grid-cols-3 gap-6 mb-12">
            {topics.map(topic => (
              <div
                key={topic.id}
                onClick={() => {
                  setSelectedTopic(topic.id);
                  startLesson(topic.id);
                }}
                className="topic-card"
              >
                <div className="text-3xl mb-3 font-mono">{icons[topic.id] || '[ ]'}</div>
                <h3 className="text-xl font-semibold mb-2">{topic.name}</h3>
                <p className="text-white-60 text-sm mb-3">{topic.questionCount} questions</p>
                <div className="progress-container">
                  <div className="progress-bar" style={{width: '0%'}}></div>
                </div>
              </div>
            ))}
          </div>

          <div className="leaderboard-section">
            <h2 className="text-2xl font-bold mb-4">Top Players</h2>
            <div className="space-y-2">
              {leaderboard.slice(0, 5).map((entry, index) => (
                <div key={index} className="leaderboard-item">
                  <div className="flex items-center gap-3">
                    <span className="rank-badge">
                      {index === 0 ? '1st' : index === 1 ? '2nd' : index === 2 ? '3rd' : `${index + 1}th`}
                    </span>
                    <span className="font-semibold">{entry.username}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span>Lv.{entry.level}</span>
                    <span className="text-yellow">{entry.xp} XP</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Lesson View
  if (currentView === 'lesson' && questions.length > 0) {
    const question = questions[currentQuestion];
    const progress = ((currentQuestion + 1) / questions.length) * 100;
    
    return (
      <div className="min-h-screen lesson-bg text-white p-4">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <div className="flex justify-between items-center mb-2">
              <button
                onClick={() => setCurrentView('dashboard')}
                className="exit-button"
              >
                ← Exit Lesson
              </button>
              <div className="flex items-center gap-4">
                <span className="text-sm">Q {currentQuestion + 1}/{questions.length}</span>
                <span className="text-red">Hearts: {hearts}/5</span>
              </div>
            </div>
            <div className="progress-container">
              <div className="progress-bar-active" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="question-card">
            <h2 className="text-2xl font-semibold mb-6">{question.question}</h2>
            
            <div className="grid grid-cols-1 md-grid-cols-2 gap-4 mb-6">
              {question.options.map((option, index) => (
                <button
                  key={index}
                  onClick={() => !showFeedback && handleAnswer(option)}
                  disabled={showFeedback}
                  className={`option-button ${
                    showFeedback && option === question.correct
                      ? 'option-correct'
                      : showFeedback && option === selectedAnswer && !isCorrect
                      ? 'option-wrong'
                      : selectedAnswer === option
                      ? 'option-selected'
                      : ''
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>

            {!showFeedback && (
              <button
                onClick={getHint}
                className="hint-button"
              >
                Get Hint (-5 Gems)
              </button>
            )}
            
            {hint && (
              <div className="hint-box">
                <p>{hint}</p>
              </div>
            )}

            {showFeedback && (
              <div className={`feedback-box ${isCorrect ? 'feedback-correct' : 'feedback-wrong'}`}>
                <p className="font-semibold mb-2">
                  {isCorrect ? '✓ Correct! +' + (questions[currentQuestion].xp || 10) + ' XP' : '✗ Incorrect'}
                </p>
                {!isCorrect && (
                  <p>Correct answer: <strong>{question.correct}</strong></p>
                )}
                {hearts <= 0 && (
                  <p className="text-red mt-2">No hearts left! Lesson ending...</p>
                )}
                <button
                  onClick={getExplanation}
                  className="explanation-button"
                >
                  See Explanation
                </button>
              </div>
            )}

            {explanation && (
              <div className="explanation-box">
                <h3 className="font-semibold mb-2">Explanation:</h3>
                <p className="mb-2">{explanation.concept}</p>
                {explanation.example && (
                  <div className="code-example">
                    {explanation.example}
                  </div>
                )}
              </div>
            )}

            {showFeedback && (
              <button
                onClick={nextQuestion}
                className="btn-primary w-full mt-4"
              >
                {currentQuestion < questions.length - 1 ? 'Next Question' : 'See Results'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Results View
  if (currentView === 'results') {
    return (
      <div className="min-h-screen results-bg flex items-center justify-center p-4">
        <div className="results-card">
          <h1 className="text-3xl font-bold mb-4">Lesson Complete!</h1>
          <div className="space-y-4 mb-6">
            <div className="stat-box">
              <p className="text-white-60">XP Earned</p>
              <p className="text-3xl font-bold text-yellow">{score}</p>
            </div>
            <div className="stat-box">
              <p className="text-white-60">Total XP</p>
              <p className="text-2xl font-bold">{totalXP}</p>
            </div>
            <div className="stat-box">
              <p className="text-white-60">Hearts Remaining</p>
              <p className="text-2xl font-bold text-red">{hearts}/5</p>
            </div>
          </div>
          <button
            onClick={() => {
              setHearts(5);
              setCurrentView('dashboard');
            }}
            className="btn-primary w-full"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default App;