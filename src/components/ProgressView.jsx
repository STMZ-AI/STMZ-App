export default function ProgressView({ progress }) {
  return (
    <div className="progress-container">
      <div className="progress-header">
        <span className="progress-status">
          {progress.status || 'Preparing...'}
          {progress.totalFiles > 0 && ` (${progress.fileIndex}/${progress.totalFiles})`}
        </span>
        <span className="progress-percent">{progress.percent}%</span>
      </div>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}
