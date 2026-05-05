export default function ImportGuideModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>📖 How to Import Stems into Rekordbox</h2>
        <p>
          After processing, STMZ AI generates a <strong>rekordbox_stems.xml</strong> file
          alongside your separated stems. This file contains all the stem tracks with
          their original cue points, beat grids, and BPM preserved. Follow these steps
          to import them into your Rekordbox library:
        </p>

        <ol className="modal-steps">
          <li>
            Open <strong>Rekordbox</strong> on your computer.
          </li>
          <li>
            Go to <strong>File → Preferences → Advanced</strong> and enable
            <strong> "rekordbox xml"</strong> under the database section. Set the imported
            library path to the <strong>rekordbox_stems.xml</strong> file that was generated.
          </li>
          <li>
            In the left sidebar, you will see <strong>"rekordbox xml"</strong> appear.
            Click on it to expand the imported library.
          </li>
          <li>
            Find the <strong>"STEMS"</strong> playlist inside the imported XML tree.
            Right-click on it and select <strong>"Import Playlist"</strong> or drag the
            tracks into your Collection.
          </li>
          <li>
            All stem tracks will appear in your library with their original metadata,
            cue points, beat grids, and BPM intact. 🎉
          </li>
        </ol>

        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          💡 <strong>Tip:</strong> You can also drag individual stem tracks from the XML
          view into any of your existing playlists.
        </p>

        <button className="modal-close-btn" onClick={onClose}>
          Got it!
        </button>
      </div>
    </div>
  );
}
