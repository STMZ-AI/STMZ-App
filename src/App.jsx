import { useState, useEffect, useCallback, useRef } from 'react';
import TitleBar from './components/TitleBar';
import ImportFolder from './components/ImportFolder';
import RekordboxBrowser from './components/RekordboxBrowser';
import ProcessingOptions from './components/ProcessingOptions';
import ProgressView from './components/ProgressView';
import ImportGuideModal from './components/ImportGuideModal';
import LogPanel from './components/LogPanel';
import SetupView from './components/SetupView';

// Check if running inside Electron
const isElectron = !!(window.electronAPI);

export default function App() {
  const [activeTab, setActiveTab] = useState('import'); // 'import' | 'rekordbox'
  const [setupDone, setSetupDone] = useState(!isElectron); // Default to ready if not in electron (dev)
  const [missingDeps, setMissingDeps] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedTrackIds, setSelectedTrackIds] = useState([]);
  const [rekordboxXml, setRekordboxXml] = useState(null);
  const [defaultRekordboxXml, setDefaultRekordboxXml] = useState(() => localStorage.getItem('stmz_defaultRekordboxXml') || '');
  const [outputFolder, setOutputFolder] = useState(() => localStorage.getItem('stmz_outputFolder') || '');
  const [quality, setQuality] = useState(() => localStorage.getItem('stmz_quality') || 'balanced');
  const [gpuJobs, setGpuJobs] = useState(() => {
    const saved = localStorage.getItem('stmz_gpuJobs');
    return saved !== null ? parseInt(saved) : -1;
  });
  const [stems, setStems] = useState({
    acapella: true,
    instrumental: true,
    bass: false,
    drums: false,
    melody: false,
  });
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, status: '', file: '', fileIndex: 0, totalFiles: 0 });
  const [completed, setCompleted] = useState(false);
  const [completionData, setCompletionData] = useState(null);
  const [showGuide, setShowGuide] = useState(false);
  const [logs, setLogs] = useState([]);

  // Check dependencies on startup
  useEffect(() => {
    if (!isElectron) return;
    
    const checkDeps = async () => {
      const deps = await window.electronAPI.checkDependencies();
      setMissingDeps(deps);
      // App is ready if engine + ffmpeg are installed (models can be lazy)
      if (deps.engine && deps.ffmpeg) {
        setSetupDone(true);
      }
    };
    
    checkDeps();
  }, []);

  // Persist settings
  useEffect(() => {
    localStorage.setItem('stmz_defaultRekordboxXml', defaultRekordboxXml);
  }, [defaultRekordboxXml]);

  useEffect(() => {
    localStorage.setItem('stmz_outputFolder', outputFolder);
  }, [outputFolder]);

  useEffect(() => {
    localStorage.setItem('stmz_quality', quality);
  }, [quality]);

  useEffect(() => {
    localStorage.setItem('stmz_gpuJobs', gpuJobs);
  }, [gpuJobs]);

  // Engine message handler
  useEffect(() => {
    if (!isElectron) return;

    const cleanup = window.electronAPI.onEngineMessage((msg) => {
      switch (msg.type) {
        case 'progress':
          setProgress({
            percent: msg.percent || 0,
            status: msg.status || '',
            file: msg.file || '',
            fileIndex: msg.file_index || 0,
            totalFiles: msg.total_files || 0,
          });
          break;
        case 'complete':
          setProcessing(false);
          setCompleted(true);
          setCompletionData(msg);
          break;
        case 'error':
          addLog(msg.message, 'error');
          break;
        case 'log':
          addLog(msg.message);
          break;
        case 'scan_result':
          // Handled by ImportFolder component via callback
          break;
        case 'rekordbox_scan':
        case 'playlist_tracks':
          // Handled by RekordboxBrowser component via callback
          break;
        default:
          break;
      }
    });

    return cleanup;
  }, []);

  const addLog = useCallback((message, type = 'info') => {
    setLogs(prev => [...prev.slice(-100), { message, type, timestamp: Date.now() }]);
  }, []);

  const handleProcess = useCallback(async () => {
    const enabledStems = Object.entries(stems)
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (enabledStems.length === 0) {
      addLog('Please select at least one stem to extract.', 'error');
      return;
    }
    if (!outputFolder) {
      addLog('Please select an output folder.', 'error');
      return;
    }
    if (selectedFiles.length === 0) {
      addLog('Please select at least one track to process.', 'error');
      return;
    }

    setProcessing(true);
    setCompleted(false);
    setCompletionData(null);
    setProgress({ percent: 0, status: 'Starting...', file: '', fileIndex: 0, totalFiles: selectedFiles.length });

    if (isElectron) {
      await window.electronAPI.sendToEngine({
        cmd: 'process',
        files: selectedFiles.map(f => f.path || f.file_path || f),
        stems: enabledStems,
        quality: quality,
        gpu_jobs: gpuJobs,
        output_dir: outputFolder,
        rekordbox_xml: activeTab === 'rekordbox' ? rekordboxXml : null,
        track_ids: activeTab === 'rekordbox' ? selectedTrackIds : [],
      });
    } else {
      // Mock progress for browser-only development
      addLog('Running in browser mode — no engine available.', 'error');
      setProcessing(false);
    }
  }, [stems, outputFolder, quality, gpuJobs, selectedFiles, selectedTrackIds, activeTab, rekordboxXml, addLog]);

  const handleCancel = useCallback(async () => {
    if (isElectron) {
      await window.electronAPI.cancelEngine();
      setProcessing(false);
      setProgress({ percent: 0, status: 'Cancelled', file: '', fileIndex: 0, totalFiles: 0 });
      addLog('Processing cancelled by user.', 'error');
    }
  }, [addLog]);

  const handleReset = useCallback(() => {
    setCompleted(false);
    setCompletionData(null);
    setProgress({ percent: 0, status: '', file: '', fileIndex: 0, totalFiles: 0 });
  }, []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {!setupDone && missingDeps && <SetupView onComplete={() => setSetupDone(true)} missingDeps={missingDeps} />}
      
      <TitleBar />

      {/* Tab Bar */}
      <div className="tab-bar">
        <div className="tab-bar-left">
          <button
            id="tab-import"
            className={`tab-btn ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            📁 Import Folder
          </button>
          <button
            id="tab-rekordbox"
            className={`tab-btn ${activeTab === 'rekordbox' ? 'active' : ''}`}
            onClick={() => setActiveTab('rekordbox')}
          >
            💿 Rekordbox
          </button>
        </div>

        <div className="tab-bar-right">
          <button
            id="tab-settings"
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            ⚙️ Settings
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Content Area */}
        <div className="content-area" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflowY: (activeTab === 'rekordbox' || completed) ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
            {completed ? (
              <div className="completion-card">
                <div className="completion-icon">✅</div>
                <h3>Processing Complete!</h3>
                <p>
                  {completionData?.total_processed || 0} tracks processed successfully.
                  {completionData?.rekordbox_xml && (
                    <><br />Rekordbox XML generated — use the import guide to add your stems.</>
                  )}
                </p>
                <div className="completion-actions">
                  <button className="btn-secondary" onClick={handleReset}>
                    Process More
                  </button>
                  {completionData?.rekordbox_xml && (
                    <button className="btn-secondary" onClick={() => setShowGuide(true)}>
                      📖 Import Guide
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Import Folder Tab */}
                <div style={{ display: activeTab === 'import' ? 'flex' : 'none', flex: 1, flexDirection: 'column' }}>
                  <ImportFolder
                    selectedFiles={selectedFiles}
                    setSelectedFiles={setSelectedFiles}
                    addLog={addLog}
                  />
                </div>

                {/* Rekordbox Tab */}
                <div style={{ display: activeTab === 'rekordbox' ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%' }}>
                  <RekordboxBrowser
                    selectedFiles={selectedFiles}
                    setSelectedFiles={setSelectedFiles}
                    selectedTrackIds={selectedTrackIds}
                    setSelectedTrackIds={setSelectedTrackIds}
                    rekordboxXml={rekordboxXml}
                    setRekordboxXml={setRekordboxXml}
                    defaultRekordboxXml={defaultRekordboxXml}
                    addLog={addLog}
                  />
                </div>

                {/* Settings Tab */}
                <div style={{ display: activeTab === 'settings' ? 'flex' : 'none', flex: 1, flexDirection: 'column' }}>
                  <div className="settings-view">
                    <div className="settings-group">
                      <h3>Processing Quality</h3>
                      <p>Choose the level of AI processing depth. Higher quality uses more sophisticated algorithms and random shifts to eliminate artifacts, but takes longer to process.</p>
                      <div className="settings-control">
                        <select 
                          className="quality-select" 
                          value={quality} 
                          onChange={(e) => setQuality(e.target.value)}
                          style={{ width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: 'var(--color-bg-primary)', color: 'white', border: '1px solid var(--color-border)', outline: 'none' }}
                        >
                          <option value="extreme">Extreme (Slower) - Maximum fidelity</option>
                          <option value="high">High - Extra predictive passes</option>
                          <option value="balanced">Balanced - Standard HTDemucs</option>
                          <option value="low">Low (Faster) - Optimized for speed</option>
                        </select>
                      </div>
                    </div>

                    <div className="settings-group">
                      <h3>GPU Concurrency (VRAM)</h3>
                      <p>Control how many audio segments are processed in parallel on your GPU. More cores significantly increase speed but require more Video RAM.</p>
                      <div className="settings-control">
                        <select 
                          className="quality-select" 
                          value={gpuJobs} 
                          onChange={(e) => setGpuJobs(parseInt(e.target.value))}
                          style={{ width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: 'var(--color-bg-primary)', color: 'white', border: '1px solid var(--color-border)', outline: 'none' }}
                        >
                          <option value={-1}>Auto (Recommended - Detects VRAM)</option>
                          <option value={1}>1 Core - Safest / Lowest VRAM usage</option>
                          <option value={2}>2 Cores - Fast (Requires 8GB+ VRAM)</option>
                          <option value={4}>4 Cores - Blazing Fast (Requires 12GB+ VRAM)</option>
                        </select>
                      </div>
                    </div>

                    <div className="settings-group">
                      <h3>Default Rekordbox XML</h3>
                      <p>Set your rekordbox.xml location to skip the manual browse step every time you open the Rekordbox tab. The file is usually at <code style={{ fontSize: 11, color: 'var(--color-accent)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>C:/Users/&lt;YourName&gt;/AppData/Roaming/Pioneer/rekordbox/rekordbox.xml</code></p>
                      <div className="settings-control" style={{ display: 'flex', gap: 8 }}>
                        <input
                          type="text"
                          value={defaultRekordboxXml}
                          onChange={(e) => setDefaultRekordboxXml(e.target.value)}
                          placeholder="Path to rekordbox.xml (leave empty for auto-detect)"
                          style={{ flex: 1, padding: '10px', borderRadius: '6px', backgroundColor: 'var(--color-bg-primary)', color: 'white', border: '1px solid var(--color-border)', outline: 'none', fontSize: 13 }}
                        />
                        <button
                          className="btn-secondary"
                          style={{ whiteSpace: 'nowrap' }}
                          onClick={async () => {
                            if (isElectron) {
                              const xmlPath = await window.electronAPI.selectXmlFile();
                              if (xmlPath) setDefaultRekordboxXml(xmlPath);
                            }
                          }}
                        >
                          📂 Browse
                        </button>
                        {defaultRekordboxXml && (
                          <button
                            className="btn-secondary"
                            style={{ whiteSpace: 'nowrap', color: '#ff6b6b' }}
                            onClick={() => setDefaultRekordboxXml('')}
                          >
                            ✕ Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Progress Bar */}
          {processing && <ProgressView progress={progress} />}

          {/* Log Panel */}
          {logs.length > 0 && <LogPanel logs={logs} />}
        </div>

        {/* Sidebar */}
        <ProcessingOptions
          outputFolder={outputFolder}
          setOutputFolder={setOutputFolder}
          stems={stems}
          setStems={setStems}
          onProcess={handleProcess}
          onCancel={handleCancel}
          processing={processing}
          canProcess={selectedFiles.length > 0}
          onShowGuide={() => setShowGuide(true)}
        />
      </div>

      {/* Import Guide Modal */}
      {showGuide && <ImportGuideModal onClose={() => setShowGuide(false)} />}
    </div>
  );
}
