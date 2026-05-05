import { useState, useCallback, useEffect, useRef } from 'react';

const isElectron = !!(window.electronAPI);

export default function ImportFolder({ selectedFiles, setSelectedFiles, addLog }) {
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('name'); // 'name' | 'artist' | 'format'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' | 'desc'
  const [loading, setLoading] = useState(false);

  // Listen for scan results from the engine
  useEffect(() => {
    if (!isElectron) return;

    const cleanup = window.electronAPI.onEngineMessage((msg) => {
      if (msg.type === 'scan_start') {
        setFiles([]);
      } else if (msg.type === 'scan_batch') {
        setFiles(prev => [...prev, ...msg.files]);
        addLog(`Loaded ${msg.count} audio files so far...`);
      } else if (msg.type === 'scan_complete') {
        addLog(`Finished loading folder. Found ${msg.count} tracks.`);
        setLoading(false);
      } else if (msg.type === 'cover_art_result') {
        setFiles(prev => prev.map(f => {
          // Normalize paths for comparison just in case
          const isMatch = f.path === msg.track_id || 
                         f.path.replace(/\\/g, '/') === msg.track_id.replace(/\\/g, '/');
          return isMatch ? { ...f, cover_art: msg.cover_art || null } : f;
        }));
      } else if (msg.type === 'error') {
        setLoading(false);
      }
    });

    return cleanup;
  }, [addLog]);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);

    if (isElectron) {
      const paths = Array.from(e.dataTransfer.files).map(f => f.path);
      const result = await window.electronAPI.getDroppedFiles(paths);

      if (result.type === 'folder') {
        setFolderPath(result.path);
        setFiles([]);
        addLog(`Scanning folder: ${result.path}`);
        setLoading(true);
        await window.electronAPI.sendToEngine({
          cmd: 'scan_folder',
          path: result.path,
        });
      } else if (result.files && result.files.length > 0) {
        // Individual files dropped — create file info objects
        const fileInfos = result.files.map(f => ({
          path: f,
          filename: f.split(/[\\/]/).pop(),
          title: f.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''),
          artist: 'Unknown',
          duration: 0,
          format: f.split('.').pop().toUpperCase(),
        }));
        setFiles(fileInfos);
        addLog(`Added ${fileInfos.length} audio files.`);
      }
    } else {
      // Browser fallback — just show file names
      const droppedFiles = Array.from(e.dataTransfer.files);
      const fileInfos = droppedFiles
        .filter(f => /\.(mp3|wav|flac|ogg|m4a|aiff?)$/i.test(f.name))
        .map(f => ({
          path: f.name,
          filename: f.name,
          title: f.name.replace(/\.[^.]+$/, ''),
          artist: 'Unknown',
          duration: 0,
          format: f.name.split('.').pop().toUpperCase(),
        }));
      setFiles(fileInfos);
    }
  }, [addLog]);

  const handleBrowse = useCallback(async () => {
    if (!isElectron) return;

    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      setFolderPath(folder);
      setFiles([]);
      addLog(`Scanning folder: ${folder}`);
      await window.electronAPI.sendToEngine({
        cmd: 'scan_folder',
        path: folder,
      });
    }
  }, [addLog]);

  const handleBrowseFiles = useCallback(async () => {
    if (!isElectron) return;

    const selectedFilePaths = await window.electronAPI.selectFiles();
    if (selectedFilePaths && selectedFilePaths.length > 0) {
      const fileInfos = selectedFilePaths.map(f => ({
        path: f,
        filename: f.split(/[\\/]/).pop(),
        title: f.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''),
        artist: 'Unknown',
        duration: 0,
        format: f.split('.').pop().toUpperCase(),
      }));
      setFiles(fileInfos);
      setFolderPath('');
      addLog(`Added ${fileInfos.length} audio files.`);
    }
  }, [addLog]);

  const handleClear = useCallback(() => {
    setFiles([]);
    setFolderPath('');
    setSearchQuery('');
    addLog('Cleared folder import.');
  }, [addLog]);

  const toggleFile = useCallback((file) => {
    setSelectedFiles(prev => {
      const isSelected = prev.some(f => f.path === file.path);
      if (isSelected) {
        return prev.filter(f => f.path !== file.path);
      } else {
        return [...prev, file];
      }
    });
  }, [setSelectedFiles]);

  const toggleAll = useCallback(() => {
    const filteredFiles = files.filter(f => 
      (f.title || f.filename).toLowerCase().includes(searchQuery.toLowerCase()) ||
      (f.artist || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const allFilteredSelected = filteredFiles.every(f => selectedFiles.some(sf => sf.path === f.path));

    if (allFilteredSelected) {
      // Deselect all filtered
      setSelectedFiles(prev => prev.filter(f => !filteredFiles.some(ff => ff.path === f.path)));
    } else {
      // Select all filtered
      const newSelections = [...selectedFiles];
      filteredFiles.forEach(f => {
        if (!newSelections.some(sf => sf.path === f.path)) {
          newSelections.push(f);
        }
      });
      setSelectedFiles(newSelections);
    }
  }, [files, selectedFiles, setSelectedFiles, searchQuery]);

  const formatDuration = (seconds) => {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const filteredFiles = files.filter(f => 
    (f.title || f.filename).toLowerCase().includes(searchQuery.toLowerCase()) ||
    (f.artist || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedFiles = filteredFiles.sort((a, b) => {
    let valA, valB;
    switch (sortBy) {
      case 'artist':
        valA = (a.artist || '').toLowerCase();
        valB = (b.artist || '').toLowerCase();
        break;
      case 'format':
        valA = (a.format || '').toLowerCase();
        valB = (b.format || '').toLowerCase();
        break;
      default: // 'name'
        valA = (a.title || a.filename || '').toLowerCase();
        valB = (b.title || b.filename || '').toLowerCase();
    }

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  // Subcomponent for lazy loading cover art
  const TrackItem = ({ file, isSelected, onToggle }) => {
    const observerRef = useCallback((node) => {
      if (!node || !isElectron || file.cover_art !== undefined) return; // already loaded or attempted

      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          // Track is visible, request cover art
          // We set it to 'loading' initially so we don't request it twice
          setFiles(prev => prev.map(f => f.path === file.path ? { ...f, cover_art: 'loading' } : f));
          window.electronAPI.sendToEngine({
            cmd: 'get_cover_art',
            file_path: file.path,
            track_id: file.path
          });
          observer.disconnect();
        }
      }, { rootMargin: '100px' });
      
      observer.observe(node);
      
      return () => observer.disconnect();
    }, [file.path, file.cover_art]);

    return (
      <div
        ref={observerRef}
        className={`track-item ${isSelected ? 'selected' : ''}`}
        onClick={() => onToggle(file)}
      >
        <div className="track-checkbox">
          {isSelected && <span style={{ fontSize: 12, color: 'white' }}>✓</span>}
        </div>
        {file.cover_art && file.cover_art !== 'loading' ? (
          <img src={file.cover_art} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <div style={{ width: 36, height: 36, borderRadius: 4, backgroundColor: 'var(--color-bg-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {file.cover_art === 'loading' ? (
              <div className="animate-pulse" style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--color-accent)' }} />
            ) : (
              <span style={{ fontSize: 16, opacity: 0.5 }}>🎵</span>
            )}
          </div>
        )}
        <div className="track-info" style={{ marginLeft: 8 }}>
          <div className="track-title">{file.title || file.filename}</div>
          <div className="track-artist">{file.artist}</div>
        </div>
        <span className="track-duration">{formatDuration(file.duration)}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 40, textAlign: 'right' }}>{file.format}</span>
      </div>
    );
  };

  return (
    <div>
      {files.length === 0 ? (
        <div
          className={`drop-zone ${dragOver ? 'active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="drop-zone-icon">📂</div>
          <h3>Drop a folder or audio files here</h3>
          <p>Or click below to browse — supports MP3, WAV, FLAC, OGG, M4A, AIFF</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'center' }}>
            <button className="btn-secondary" onClick={handleBrowse} disabled={loading}>
              {loading ? '⏳ Scanning...' : 'Browse Folder'}
            </button>
            <button className="btn-secondary" onClick={handleBrowseFiles} disabled={loading}>
              Browse Files
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="track-list-header sticky-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={handleClear}>
                ← Exit
              </button>
              <h3 style={{ margin: 0 }}>{files.length} tracks found {folderPath && <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 400 }}>— {folderPath}</span>}</h3>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="sort-control" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Sort by:</span>
                <select 
                  value={sortBy} 
                  onChange={(e) => setSortBy(e.target.value)}
                  style={{ padding: '6px', borderRadius: 4, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-dark)', color: 'white', fontSize: 12, outline: 'none' }}
                >
                  <option value="name">Name</option>
                  <option value="artist">Artist</option>
                  <option value="format">Format</option>
                </select>
                <button 
                  onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                >
                  {sortOrder === 'asc' ? '↑' : '↓'}
                </button>
              </div>
              <input
                type="text"
                placeholder="Search tracks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-dark)', color: 'white', outline: 'none' }}
              />
              <button className="select-all-btn" onClick={toggleAll}>
                {sortedFiles.every(f => selectedFiles.some(sf => sf.path === f.path)) ? 'Deselect All' : 'Select All'}
              </button>
            </div>
          </div>

          <div className="track-list">
            {sortedFiles.map((file, idx) => (
              <TrackItem 
                key={file.path || idx} 
                file={file} 
                isSelected={selectedFiles.some(f => f.path === file.path)} 
                onToggle={toggleFile} 
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
