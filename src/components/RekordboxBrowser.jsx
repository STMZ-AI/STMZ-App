import { useState, useCallback, useEffect } from 'react';

const isElectron = !!(window.electronAPI);

export default function RekordboxBrowser({
  selectedFiles,
  setSelectedFiles,
  selectedTrackIds,
  setSelectedTrackIds,
  rekordboxXml,
  setRekordboxXml,
  defaultRekordboxXml,
  addLog,
}) {
  const [playlists, setPlaylists] = useState([]);
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [xmlLoaded, setXmlLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('name'); // 'name' | 'artist' | 'bpm' | 'key' | 'date'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' | 'desc'
  const [autoLoadAttempted, setAutoLoadAttempted] = useState(false);

  // Listen for engine messages
  useEffect(() => {
    if (!isElectron) return;

    const cleanup = window.electronAPI.onEngineMessage((msg) => {
      if (msg.type === 'rekordbox_scan') {
        setPlaylists(msg.playlists || []);
        setRekordboxXml(msg.xml_path);
        setXmlLoaded(true);
        setLoading(false);
        addLog(`Loaded ${msg.playlists?.length || 0} playlists from Rekordbox.`);
      } else if (msg.type === 'playlist_tracks_start') {
        setTracks([]);
        setLoading(true);
      } else if (msg.type === 'playlist_tracks_batch') {
        setTracks(prev => [...prev, ...msg.tracks]);
      } else if (msg.type === 'playlist_tracks_complete') {
        setLoading(false);
      } else if (msg.type === 'cover_art_result') {
        setTracks(prev => prev.map(t => 
          t.id === msg.track_id ? { ...t, cover_art: msg.cover_art } : t
        ));
      } else if (msg.type === 'error') {
        setLoading(false);
      }
    });

    return cleanup;
  }, [addLog, setRekordboxXml]);

  // Auto-load the default XML on mount if set
  useEffect(() => {
    if (!isElectron || autoLoadAttempted || xmlLoaded) return;
    setAutoLoadAttempted(true);

    if (defaultRekordboxXml) {
      // User has a default path configured — load it directly
      setLoading(true);
      addLog(`Auto-loading Rekordbox XML: ${defaultRekordboxXml}`);
      window.electronAPI.sendToEngine({ cmd: 'scan_rekordbox', xml_path: defaultRekordboxXml });
    } else {
      // No default set — try auto-detect from common system locations
      setLoading(true);
      addLog('Auto-detecting Rekordbox library...');
      window.electronAPI.sendToEngine({ cmd: 'scan_rekordbox' });
    }
  }, [defaultRekordboxXml, autoLoadAttempted, xmlLoaded, addLog]);

  const handleScanRekordbox = useCallback(async () => {
    if (!isElectron) return;
    setLoading(true);
    addLog('Scanning for Rekordbox library...');
    await window.electronAPI.sendToEngine({ cmd: 'scan_rekordbox' });
  }, [addLog]);

  const handleBrowseXml = useCallback(async () => {
    if (!isElectron) return;
    const xmlPath = await window.electronAPI.selectXmlFile();
    if (xmlPath) {
      setLoading(true);
      addLog(`Loading XML: ${xmlPath}`);
      await window.electronAPI.sendToEngine({ cmd: 'scan_rekordbox', xml_path: xmlPath });
    }
  }, [addLog]);

  const handleSelectPlaylist = useCallback(async (playlist) => {
    setActivePlaylist(playlist.name);
    setLoading(true);

    if (isElectron) {
      await window.electronAPI.sendToEngine({
        cmd: 'get_playlist_tracks',
        xml_path: rekordboxXml,
        playlist: playlist.name,
      });
    }
  }, [rekordboxXml]);

  const toggleTrack = useCallback((track) => {
    const isSelected = selectedTrackIds.includes(track.id);
    if (isSelected) {
      setSelectedTrackIds(prev => prev.filter(id => id !== track.id));
      setSelectedFiles(prev => prev.filter(f => f.id !== track.id));
    } else {
      setSelectedTrackIds(prev => [...prev, track.id]);
      setSelectedFiles(prev => [...prev, track]);
    }
  }, [selectedTrackIds, setSelectedTrackIds, setSelectedFiles]);

  const toggleAllTracks = useCallback(() => {
    const filteredTracks = tracks.filter(t => 
      t.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.artist?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const filteredIds = filteredTracks.map(t => t.id);
    const allFilteredSelected = filteredIds.every(id => selectedTrackIds.includes(id));

    if (allFilteredSelected) {
      setSelectedTrackIds(prev => prev.filter(id => !filteredIds.includes(id)));
      setSelectedFiles(prev => prev.filter(f => !filteredIds.includes(f.id)));
    } else {
      const newIds = filteredIds.filter(id => !selectedTrackIds.includes(id));
      const newTracks = filteredTracks.filter(t => !selectedTrackIds.includes(t.id));
      setSelectedTrackIds(prev => [...prev, ...newIds]);
      setSelectedFiles(prev => [...prev, ...newTracks]);
    }
  }, [tracks, selectedTrackIds, setSelectedTrackIds, setSelectedFiles, searchQuery]);

  const selectEntirePlaylist = useCallback(async (playlist, e) => {
    e.stopPropagation();
    // Load the playlist tracks if not the active playlist
    if (activePlaylist !== playlist.name) {
      setActivePlaylist(playlist.name);
      if (isElectron) {
        await window.electronAPI.sendToEngine({
          cmd: 'get_playlist_tracks',
          xml_path: rekordboxXml,
          playlist: playlist.name,
        });
      }
    }
    // Will select all once tracks are loaded
    addLog(`Selected entire playlist: ${playlist.name}`);
  }, [activePlaylist, rekordboxXml, addLog]);

  const formatDuration = (seconds) => {
    if (!seconds || seconds === '0') return '--:--';
    const s = parseInt(seconds);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const getSortedTracks = useCallback(() => {
    let filtered = tracks.filter(t => 
      t.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.artist?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return filtered.sort((a, b) => {
      let valA, valB;
      switch (sortBy) {
        case 'artist':
          valA = (a.artist || '').toLowerCase();
          valB = (b.artist || '').toLowerCase();
          break;
        case 'bpm':
          valA = parseFloat(a.bpm || 0);
          valB = parseFloat(b.bpm || 0);
          break;
        case 'key':
          valA = a.key || '';
          valB = b.key || '';
          break;
        case 'date':
          valA = a.date_added || '';
          valB = b.date_added || '';
          break;
        default: // 'name'
          valA = (a.title || '').toLowerCase();
          valB = (b.title || '').toLowerCase();
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [tracks, searchQuery, sortBy, sortOrder]);

  const sortedTracks = getSortedTracks();

  // Subcomponent for lazy loading cover art
  const TrackItem = ({ track, isSelected, onToggle }) => {
    const observerRef = useCallback((node) => {
      if (!node || !isElectron || track.cover_art !== undefined) return; // already loaded or attempted

      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          // Track is visible, request cover art
          // We set it to null initially so we don't request it twice
          setTracks(prev => prev.map(t => t.id === track.id ? { ...t, cover_art: null } : t));
          window.electronAPI.sendToEngine({
            cmd: 'get_cover_art',
            file_path: track.file_path || track.path,
            track_id: track.id
          });
          observer.disconnect();
        }
      }, { rootMargin: '100px' });
      
      observer.observe(node);
      
      return () => observer.disconnect();
    }, [track.id, track.cover_art, track.file_path, track.path]);

    return (
      <div
        ref={observerRef}
        className={`track-item ${isSelected ? 'selected' : ''}`}
        onClick={() => onToggle(track)}
      >
        <div className="track-checkbox">
          {isSelected && <span style={{ fontSize: 12, color: 'white' }}>✓</span>}
        </div>
        {track.cover_art ? (
          <img src={track.cover_art} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <div style={{ width: 36, height: 36, borderRadius: 4, backgroundColor: 'var(--color-bg-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 16, opacity: 0.5 }}>🎵</span>
          </div>
        )}
        <div className="track-info" style={{ marginLeft: 8 }}>
          <div className="track-title">{track.title}</div>
          <div className="track-artist">{track.artist}</div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-accent)', marginRight: 8 }}>{track.bpm && track.bpm !== '0' ? `${parseFloat(track.bpm).toFixed(0)} BPM` : ''}</span>
        <span className="track-duration">{formatDuration(track.duration)}</span>
      </div>
    );
  };

  // Not loaded yet
  if (!xmlLoaded) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">💿</div>
        <h3>Connect to Rekordbox</h3>
        <p>Scan your system to auto-detect Rekordbox, or manually browse for your exported XML library file.</p>
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button className="process-btn" style={{ width: 'auto', padding: '12px 24px' }} onClick={handleScanRekordbox} disabled={loading}>
            {loading ? '⏳ Scanning...' : '🔍 Auto-Detect'}
          </button>
          <button className="btn-secondary" onClick={handleBrowseXml} disabled={loading}>
            📂 Browse XML
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%' }}>
      {/* Playlist List (left) */}
      <div style={{ width: 260, borderRight: '1px solid var(--color-border)', overflowY: 'auto', padding: '12px 0', flexShrink: 0 }}>
        <div style={{ padding: '0 16px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)' }}>
          Playlists
        </div>
        <div className="playlist-list">
          {playlists.map((pl) => (
            <div
              key={pl.path}
              className={`playlist-item ${activePlaylist === pl.name ? 'active' : ''}`}
              onClick={() => handleSelectPlaylist(pl)}
            >
              <span className="playlist-icon">🎵</span>
              <span className="playlist-name">{pl.name}</span>
              <span className="playlist-count">{pl.track_count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Track List (right) */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {!activePlaylist ? (
          <div className="empty-state">
            <div className="empty-state-icon">👈</div>
            <h3>Select a Playlist</h3>
            <p>Choose a playlist from the left to view and select tracks.</p>
          </div>
        ) : loading ? (
          <div className="empty-state">
            <div className="empty-state-icon animate-pulse">⏳</div>
            <h3>Loading tracks...</h3>
          </div>
        ) : (
          <>
            <div className="track-list-header sticky-header">
              <h3>{activePlaylist} — {tracks.length} tracks</h3>
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
                    <option value="bpm">BPM</option>
                    <option value="key">Key</option>
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
                <button className="select-all-btn" onClick={toggleAllTracks}>
                  {sortedTracks.every(t => selectedTrackIds.includes(t.id)) ? 'Deselect All' : 'Select All'}
                </button>
              </div>
            </div>

            <div className="track-list">
              {sortedTracks.map((track) => (
                <TrackItem 
                  key={track.id} 
                  track={track} 
                  isSelected={selectedTrackIds.includes(track.id)} 
                  onToggle={toggleTrack} 
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
