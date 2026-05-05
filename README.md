# STMZ AI - The Ultimate Stem Splitter for DJs

<p align="center">
  <img src="src/assets/STMZ%20logo.png" alt="STMZ AI Logo" width="400">
</p>

**STMZ AI** is a professional, open-source audio stem separation tool designed specifically for the Rekordbox ecosystem. It allows DJs to split their library into high-quality stems (Acapella, Instrumental, Bass, Drums, Melody) while perfectly preserving all metadata, cue points, beat grids, and BPM.

## 🚀 Key Features

- **📂 Batch Processing** — Drag & drop entire folders. Process hundreds of tracks with one click.
- **🎧 Rekordbox Integration** — Directly browse your Rekordbox XML library, view your playlists, and select tracks to split.
- **✨ Metadata Preservation** — Full preservation of ID3 tags, high-res album art, and Rekordbox-specific metadata (Cues, Grids, BPM).
- **🎛️ 5-Stem Separation** — Powered by state-of-the-art AI models for studio-quality isolation.
- **📦 Smart Export** — Automatically generates a `rekordbox_stems.xml` file for instant import back into Rekordbox.
- **🛠️ Format Matching** — Output stems in their original format (MP3, WAV, FLAC, AIFF, etc.) to maintain library consistency.

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Electron + React + Vite + Vanilla CSS |
| **Engine** | UVR5 + HTDemucs v4 (Fine-Tuned) |
| **Metadata** | Mutagen & Pydub |
| **Integration** | Custom Rekordbox XML Parser/Generator |

## 🚦 Getting Started

### Prerequisites
- **Node.js** (v18 or higher)
- **Python** (v3.10 or higher)
- **FFmpeg** (installed and added to your PATH)
- **CUDA** (optional, but highly recommended for GPU acceleration)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/STMZ-AI/STMZ-App.git
   cd STMZ-App
   ```

2. **Install Node dependencies:**
   ```bash
   npm install
   ```

3. **Install Python dependencies:**
   ```bash
   pip install -r engine/requirements.txt
   ```

4. **Run the application:**
   ```bash
   # Start in development mode
   npm run dev:electron
   ```

## 🏗️ Project Structure

```text
STMZ_AI/
├── electron/          # Electron main process & IPC
├── src/               # React frontend (Vite)
├── engine/            # Python audio processing core
│   ├── separator.py   # AI Separation logic
│   ├── metadata.py    # Tag & Art preservation
│   └── rekordbox_xml_manager.py
├── public/            # Static assets
└── tests/             # Unit & Integration tests
```

## 🤖 Built with AI

This project was built with the help of **Gemini** and **Claude** via the **Antigravity** AI pair programming assistant. The combination of state-of-the-art LLMs allowed for rapid prototyping, robust XML integration, and a polished user interface.

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

*Created with ❤️ for the DJ community.*
