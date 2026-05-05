import stmzLogo from '../assets/STMZ logo.png';

const isElectron = !!(window.electronAPI);

export default function TitleBar() {
  return (
    <div className="titlebar">
      <div className="titlebar-title">
        <img src={stmzLogo} alt="STMZ AI" style={{ height: 22, marginRight: 6, borderRadius: 4 }} />
        <span className="titlebar-logo">STMZ</span>
        <span>AI Stem Splitter</span>
      </div>
      {isElectron && (
        <div className="titlebar-controls">
          <button className="titlebar-btn" onClick={() => window.electronAPI.minimize()} title="Minimize">
            ─
          </button>
          <button className="titlebar-btn" onClick={() => window.electronAPI.maximize()} title="Maximize">
            □
          </button>
          <button className="titlebar-btn close" onClick={() => window.electronAPI.close()} title="Close">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
