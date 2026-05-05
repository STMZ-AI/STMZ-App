import { useCallback } from 'react';

const isElectron = !!(window.electronAPI);

const STEM_OPTIONS = [
  { key: 'acapella', label: 'Acapella', color: 'var(--color-stem-acapella)' },
  { key: 'instrumental', label: 'Instrumental', color: 'var(--color-stem-instrumental)' },
  { key: 'bass', label: 'Bass', color: 'var(--color-stem-bass)' },
  { key: 'drums', label: 'Drums', color: 'var(--color-stem-drums)' },
  { key: 'melody', label: 'Melody', color: 'var(--color-stem-melody)' },
];

export default function ProcessingOptions({
  outputFolder,
  setOutputFolder,
  stems,
  setStems,
  onProcess,
  onCancel,
  processing,
  canProcess,
  onShowGuide,
}) {
  const handleSelectOutput = useCallback(async () => {
    if (isElectron) {
      const folder = await window.electronAPI.selectOutputFolder();
      if (folder) setOutputFolder(folder);
    }
  }, [setOutputFolder]);

  const toggleStem = useCallback((key) => {
    setStems(prev => ({ ...prev, [key]: !prev[key] }));
  }, [setStems]);

  const enabledCount = Object.values(stems).filter(Boolean).length;

  return (
    <div className="sidebar">
      {/* Output Folder */}
      <div className="sidebar-section">
        <h4>Output Folder</h4>
        <button className="output-folder-btn" onClick={handleSelectOutput} id="select-output-folder">
          <span>📁</span>
          <span className="path">{outputFolder || 'Select output folder...'}</span>
        </button>
      </div>

      {/* Stem Selection */}
      <div className="sidebar-section" style={{ flex: 1, overflowY: 'auto' }}>
        <h4>Stems to Extract</h4>
        <div className="stem-grid">
          {STEM_OPTIONS.map((stem) => (
            <div
              key={stem.key}
              className={`stem-option ${stems[stem.key] ? 'checked' : ''}`}
              style={{ '--stem-color': stem.color }}
              onClick={() => toggleStem(stem.key)}
              id={`stem-${stem.key}`}
            >
              <div className="stem-checkbox">
                {stems[stem.key] && <span style={{ fontSize: 12, color: 'white' }}>✓</span>}
              </div>
              <div className="stem-dot" />
              <span className="stem-label">{stem.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Info Button */}
      <div className="sidebar-section" style={{ borderBottom: 'none', paddingBottom: 0 }}>
        <button className="btn-secondary" style={{ width: '100%', fontSize: 12 }} onClick={onShowGuide}>
          📖 Rekordbox Import Guide
        </button>
      </div>

      {/* Process Button */}
      <div className="process-section">
        {processing ? (
          <button
            className="process-btn"
            onClick={onCancel}
            style={{ backgroundColor: 'var(--color-stem-acapella)', borderColor: 'var(--color-stem-acapella)' }}
          >
            ⏹ Cancel Processing
          </button>
        ) : (
          <button
            id="process-btn"
            className="process-btn"
            onClick={onProcess}
            disabled={!canProcess || enabledCount === 0 || !outputFolder}
          >
            {`▶ Process${canProcess ? '' : ' (select tracks)'}`}
          </button>
        )}
      </div>
    </div>
  );
}
