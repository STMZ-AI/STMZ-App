import { useState, useEffect, useCallback } from 'react';

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'ffmpeg', label: 'FFmpeg' },
  { id: 'models', label: 'AI Models' },
  { id: 'complete', label: 'Ready' },
];

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec) return '';
  return `${formatBytes(bytesPerSec)}/s`;
}

export default function SetupView({ onComplete, missingDeps }) {
  const [currentStep, setCurrentStep] = useState('welcome');
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState('');
  const [speed, setSpeed] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [error, setError] = useState(null);

  // What actually needs downloading
  const needsFfmpeg = missingDeps?.ffmpeg === false;
  const needsModels = missingDeps?.models === false;

  // Listen for progress events from main process
  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanup = window.electronAPI.onSetupProgress((data) => {
      if (data.phase === 'error') {
        setError(data.message);
        return;
      }
      setPercent(data.percent || 0);
      setMessage(data.message || '');
      if (data.speed) setSpeed(data.speed);
      if (data.downloadedBytes) setDownloadedBytes(data.downloadedBytes);
      if (data.totalBytes) setTotalBytes(data.totalBytes);

      if (data.phase === 'done') {
        setTimeout(() => advanceToNext(data.step), 800);
      }
    });
    return cleanup;
  }, [needsFfmpeg, needsModels]);

  // Listen for engine messages (model download completion)
  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanup = window.electronAPI.onEngineMessage((msg) => {
      if (currentStep === 'models') {
        if (msg.type === 'download_complete') {
          setTimeout(() => setCurrentStep('complete'), 800);
        } else if (msg.type === 'error') {
          setError(msg.message);
        }
      }
    });
    return cleanup;
  }, [currentStep]);

  const advanceToNext = useCallback((completedStep) => {
    setPercent(0);
    setMessage('');
    setSpeed(0);
    setDownloadedBytes(0);
    setTotalBytes(0);

    if (completedStep === 'ffmpeg') {
      if (needsModels) {
        setCurrentStep('models');
        startDownload('models');
      } else {
        setCurrentStep('complete');
      }
    } else if (completedStep === 'models') {
      setCurrentStep('complete');
    }
  }, [needsFfmpeg, needsModels]);

  const startDownload = async (name) => {
    setError(null);
    setPercent(0);
    try {
      await window.electronAPI.downloadDependency(name);
    } catch (err) {
      setError(`Download failed: ${err.message}`);
    }
  };

  const handleStart = () => {
    if (needsFfmpeg) {
      setCurrentStep('ffmpeg');
      startDownload('ffmpeg');
    } else if (needsModels) {
      setCurrentStep('models');
      startDownload('models');
    } else {
      setCurrentStep('complete');
    }
  };

  const handleSkipModels = () => {
    setCurrentStep('complete');
  };

  const handleRetry = () => {
    setError(null);
    startDownload(currentStep);
  };

  // Auto-transition to app after completion
  useEffect(() => {
    if (currentStep === 'complete') {
      const timer = setTimeout(onComplete, 2000);
      return () => clearTimeout(timer);
    }
  }, [currentStep, onComplete]);

  const stepIndex = STEPS.findIndex(s => s.id === currentStep);

  return (
    <div className="setup-overlay">
      <div className="setup-container">
        {/* Logo */}
        <div className="setup-logo">
          <img src="./icon.png" alt="STMZ AI" className="setup-logo-img" />
          <h1 className="setup-title">STMZ AI</h1>
          <p className="setup-subtitle">First Launch Setup</p>
        </div>

        {/* Step indicators */}
        <div className="setup-steps">
          {STEPS.map((step, i) => (
            <div key={step.id} className={`setup-step-dot ${i <= stepIndex ? 'active' : ''} ${i === stepIndex ? 'current' : ''}`}>
              {i < stepIndex ? '✓' : i + 1}
            </div>
          ))}
        </div>

        {/* Content card */}
        <div className="setup-card">
          {error ? (
            <div className="setup-error-view">
              <div className="setup-error-icon">⚠️</div>
              <h2>Download Failed</h2>
              <p className="setup-error-msg">{error}</p>
              <div className="setup-error-actions">
                <button className="setup-btn setup-btn-primary" onClick={handleRetry}>
                  Retry
                </button>
                {currentStep === 'models' && (
                  <button className="setup-btn setup-btn-secondary" onClick={handleSkipModels}>
                    Skip for Now
                  </button>
                )}
              </div>
            </div>
          ) : currentStep === 'welcome' ? (
            <div className="setup-welcome-view">
              <h2>Almost ready.</h2>
              <p>STMZ AI needs to download a few extra components to get started.</p>
              <div className="setup-checklist">
                {needsFfmpeg && (
                  <div className="setup-checklist-item">
                    <span className="setup-check-icon">🎵</span>
                    <div>
                      <span className="setup-check-label">FFmpeg</span>
                      <span className="setup-check-desc">Audio codec support (~100 MB)</span>
                    </div>
                  </div>
                )}
                {needsModels && (
                  <div className="setup-checklist-item">
                    <span className="setup-check-icon">🧠</span>
                    <div>
                      <span className="setup-check-label">AI Models</span>
                      <span className="setup-check-desc">HTDemucs stem separation weights (~2.5 GB)</span>
                    </div>
                  </div>
                )}
              </div>
              <button className="setup-btn setup-btn-primary" onClick={handleStart}>
                Download & Setup
              </button>
            </div>
          ) : currentStep === 'complete' ? (
            <div className="setup-complete-view">
              <div className="setup-complete-icon">🚀</div>
              <h2>All Set!</h2>
              <p>STMZ AI is ready. Launching...</p>
              <div className="setup-spinner" />
            </div>
          ) : (
            /* Download/extract progress */
            <div className="setup-progress-view">
              <h2>
                {currentStep === 'ffmpeg' && 'Downloading FFmpeg'}
                {currentStep === 'models' && 'Downloading AI Models'}
              </h2>
              <p className="setup-progress-msg">{message || 'Preparing...'}</p>

              <div className="setup-progress-track">
                <div
                  className="setup-progress-fill"
                  style={{ width: `${Math.max(percent, 2)}%` }}
                />
              </div>

              <div className="setup-progress-stats">
                <span>{percent}%</span>
                {totalBytes > 0 && (
                  <span>{formatBytes(downloadedBytes)} / {formatBytes(totalBytes)}</span>
                )}
                {speed > 0 && <span>{formatSpeed(speed)}</span>}
              </div>

              {currentStep === 'models' && (
                <button className="setup-btn setup-btn-ghost" onClick={handleSkipModels}>
                  Skip — download later on first use
                </button>
              )}

              <p className="setup-sub-note">Please keep the application open during this process.</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .setup-overlay {
          position: fixed;
          inset: 0;
          background: radial-gradient(ellipse at 50% 30%, #1a1a2e 0%, #0a0a0f 70%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          z-index: 9999;
          font-family: 'Inter', 'Segoe UI', sans-serif;
        }

        .setup-container {
          width: 100%;
          max-width: 520px;
          text-align: center;
          padding: 24px;
        }

        /* ── Logo ── */
        .setup-logo {
          margin-bottom: 28px;
          animation: setupFadeDown 0.7s ease-out;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .setup-logo-img {
          width: 72px;
          height: 72px;
          margin-bottom: 8px;
          filter: drop-shadow(0 0 12px rgba(0, 242, 255, 0.35));
        }
        .setup-title {
          font-size: 30px;
          font-weight: 800;
          letter-spacing: 2px;
          margin: 0;
          background: linear-gradient(135deg, #ffffff 30%, #00f2ff 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .setup-subtitle {
          color: rgba(255,255,255,0.4);
          text-transform: uppercase;
          letter-spacing: 5px;
          font-size: 11px;
          margin-top: 4px;
        }

        /* ── Step dots ── */
        .setup-steps {
          display: flex;
          justify-content: center;
          gap: 12px;
          margin-bottom: 24px;
          animation: setupFadeDown 0.7s ease-out 0.1s both;
        }
        .setup-step-dot {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.25);
          border: 1px solid rgba(255,255,255,0.08);
          transition: all 0.4s ease;
        }
        .setup-step-dot.active {
          background: rgba(0, 242, 255, 0.12);
          color: #00f2ff;
          border-color: rgba(0, 242, 255, 0.3);
        }
        .setup-step-dot.current {
          box-shadow: 0 0 12px rgba(0, 242, 255, 0.25);
          transform: scale(1.15);
        }

        /* ── Card ── */
        .setup-card {
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px;
          padding: 36px 32px;
          backdrop-filter: blur(24px);
          box-shadow: 0 24px 48px rgba(0,0,0,0.35);
          animation: setupFadeUp 0.7s ease-out 0.2s both;
        }
        .setup-card h2 {
          font-size: 19px;
          font-weight: 600;
          margin: 0 0 16px;
        }
        .setup-card p {
          color: rgba(255,255,255,0.6);
          line-height: 1.6;
          font-size: 14px;
          margin: 0 0 24px;
        }

        /* ── Welcome checklist ── */
        .setup-checklist {
          background: rgba(0,0,0,0.25);
          border-radius: 14px;
          padding: 16px;
          margin-bottom: 28px;
          text-align: left;
        }
        .setup-checklist-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        .setup-checklist-item:last-child { border-bottom: none; }
        .setup-check-icon { font-size: 20px; }
        .setup-check-label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: rgba(255,255,255,0.9);
        }
        .setup-check-desc {
          display: block;
          font-size: 11px;
          color: rgba(255,255,255,0.35);
          margin-top: 2px;
        }

        /* ── Buttons ── */
        .setup-btn {
          border: none;
          border-radius: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.25s ease;
          font-size: 14px;
        }
        .setup-btn-primary {
          background: linear-gradient(135deg, #00f2ff 0%, #0080ff 100%);
          color: #000;
          padding: 14px 32px;
          width: 100%;
        }
        .setup-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 242, 255, 0.3);
        }
        .setup-btn-secondary {
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.7);
          padding: 10px 20px;
        }
        .setup-btn-secondary:hover {
          background: rgba(255,255,255,0.12);
        }
        .setup-btn-ghost {
          background: transparent;
          color: rgba(255,255,255,0.35);
          padding: 8px 16px;
          font-size: 12px;
          font-weight: 500;
          margin-top: 12px;
        }
        .setup-btn-ghost:hover {
          color: rgba(255,255,255,0.6);
        }

        /* ── Progress ── */
        .setup-progress-msg {
          font-size: 13px !important;
          color: rgba(255,255,255,0.7) !important;
          margin-bottom: 16px !important;
          min-height: 20px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .setup-progress-track {
          height: 6px;
          background: rgba(255,255,255,0.08);
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 12px;
        }
        .setup-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #00f2ff, #7000ff);
          box-shadow: 0 0 12px rgba(0, 242, 255, 0.4);
          transition: width 0.3s ease-out;
          border-radius: 3px;
        }
        .setup-progress-stats {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: rgba(255,255,255,0.4);
          margin-bottom: 8px;
        }
        .setup-progress-stats span:first-child {
          color: #00f2ff;
          font-weight: 700;
        }
        .setup-sub-note {
          font-size: 11px !important;
          color: rgba(255,255,255,0.2) !important;
          margin-top: 16px !important;
          margin-bottom: 0 !important;
        }

        /* ── Error ── */
        .setup-error-view { text-align: center; }
        .setup-error-icon { font-size: 40px; margin-bottom: 12px; }
        .setup-error-msg {
          font-size: 12px !important;
          color: rgba(255,100,100,0.8) !important;
          background: rgba(255,0,0,0.06);
          padding: 12px;
          border-radius: 10px;
          word-break: break-word;
          max-height: 120px;
          overflow-y: auto;
        }
        .setup-error-actions {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin-top: 20px;
        }

        /* ── Complete ── */
        .setup-complete-view { text-align: center; }
        .setup-complete-icon {
          font-size: 48px;
          margin-bottom: 12px;
          animation: setupPulse 1.5s ease-in-out infinite;
        }
        .setup-spinner {
          width: 24px;
          height: 24px;
          border: 2px solid rgba(0, 242, 255, 0.2);
          border-top-color: #00f2ff;
          border-radius: 50%;
          margin: 0 auto;
          animation: setupSpin 0.8s linear infinite;
        }

        /* ── Animations ── */
        @keyframes setupFadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes setupFadeDown {
          from { opacity: 0; transform: translateY(-16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes setupPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        @keyframes setupSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
