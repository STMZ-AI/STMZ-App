import { useEffect, useRef } from 'react';

export default function LogPanel({ logs }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="log-panel">
      {logs.slice(-50).map((log, idx) => (
        <div key={idx} className={`log-entry ${log.type === 'error' ? 'error' : ''}`}>
          <span style={{ color: 'var(--color-text-muted)', marginRight: 8 }}>
            {new Date(log.timestamp).toLocaleTimeString()}
          </span>
          {log.message}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
