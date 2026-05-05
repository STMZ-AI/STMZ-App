"""
STMZ AI - Engine Entry Point
JSON-line IPC bridge between Electron and the Python audio processing engine.

Protocol:
  Electron sends JSON commands via stdin.
  Engine responds with JSON messages via stdout.
  
Commands:
  {"cmd": "scan_folder", "path": "..."}
  {"cmd": "scan_rekordbox", "xml_path": "..."}  (xml_path optional, auto-detect if missing)
  {"cmd": "get_playlist_tracks", "playlist": "..."}
  {"cmd": "process", "files": [...], "stems": [...], "output_dir": "...", "rekordbox_xml": "...", "track_ids": [...]}
  {"cmd": "quit"}
"""

import sys
import json
import os
import traceback
from pathlib import Path

# Ensure the engine directory is in the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from separator import StemSeparator
from metadata import copy_metadata, get_track_info
from rekordbox_xml_manager import RekordboxXMLManager, find_rekordbox_xml


AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma", ".aiff", ".aif"}


def send(msg: dict):
    """Send a JSON message to Electron via stdout."""
    print(json.dumps(msg), flush=True)


def handle_scan_folder(data: dict):
    """Scan a folder for audio files and return their info."""
    folder = data.get("path", "")
    if not folder or not os.path.isdir(folder):
        send({"type": "error", "message": f"Invalid folder path: {folder}"})
        return

    send({"type": "scan_start"})
    count = 0
    batch = []
    folder_path = Path(folder)
    
    # We use a simple rglob without sorting to allow streaming of large folders
    for f in folder_path.rglob("*"):
        if f.suffix.lower() in AUDIO_EXTENSIONS and f.is_file():
            # Skip cover art to make scanning instantaneous
            info = get_track_info(str(f), include_cover=False)
            batch.append(info)
            count += 1
            if len(batch) >= 100:
                send({"type": "scan_batch", "files": batch, "count": count})
                batch = []

    if batch:
        send({"type": "scan_batch", "files": batch, "count": count})

    send({"type": "scan_complete", "count": count})


def handle_scan_rekordbox(data: dict):
    """Scan a Rekordbox XML for playlists and tracks."""
    xml_path = data.get("xml_path")

    if not xml_path:
        xml_path = find_rekordbox_xml()

    if not xml_path or not os.path.exists(xml_path):
        send({
            "type": "error",
            "message": "Could not find rekordbox.xml. Please export your library from Rekordbox: File > Export Collection in xml format."
        })
        return

    manager = RekordboxXMLManager(xml_path)
    playlists = manager.get_playlists()

    send({
        "type": "rekordbox_scan",
        "xml_path": xml_path,
        "playlists": playlists,
    })


def handle_get_playlist_tracks(data: dict):
    """Get track details for a specific playlist."""
    xml_path = data.get("xml_path")
    playlist = data.get("playlist", "")

    if not xml_path or not os.path.exists(xml_path):
        send({"type": "error", "message": "No rekordbox XML loaded."})
        return

    manager = RekordboxXMLManager(xml_path)
    tracks = manager.get_tracks_in_playlist(playlist)
    
    send({"type": "playlist_tracks_start", "playlist": playlist, "total": len(tracks)})
    
    # Send tracks in batches so the UI doesn't freeze
    batch = []
    for track in tracks:
        file_path = track.get("file_path")
        if file_path and os.path.exists(file_path):
            try:
                # We do NOT extract cover art here anymore, UI will request it lazily
                info = get_track_info(file_path, include_cover=False)
                # Merge XML data with file data (XML data takes precedence for title/artist if exists)
                if not track.get("title") and info.get("title"):
                    track["title"] = info["title"]
                if not track.get("artist") and info.get("artist"):
                    track["artist"] = info["artist"]
                if not track.get("duration") and info.get("duration"):
                    track["duration"] = info["duration"]
            except Exception:
                pass
        
        batch.append(track)
        if len(batch) >= 100:
            send({"type": "playlist_tracks_batch", "playlist": playlist, "tracks": batch})
            batch = []

    if batch:
        send({"type": "playlist_tracks_batch", "playlist": playlist, "tracks": batch})
        
    send({"type": "playlist_tracks_complete", "playlist": playlist})

def handle_get_cover_art(data: dict):
    """Lazily load cover art for a specific track path."""
    from metadata import get_cover_art
    file_path = data.get("file_path")
    track_id = data.get("track_id")
    if not file_path or not os.path.exists(file_path):
        return
        
    try:
        cover_art = get_cover_art(file_path)
        send({"type": "cover_art_result", "track_id": track_id, "cover_art": cover_art})
    except Exception:
        send({"type": "cover_art_result", "track_id": track_id, "cover_art": None})


def handle_process(data: dict):
    """Process audio files: separate stems, copy metadata, generate XML."""
    files = data.get("files", [])
    stems = data.get("stems", [])
    quality = data.get("quality", "balanced")
    gpu_jobs = data.get("gpu_jobs", 1)
    output_dir = data.get("output_dir", "")
    rekordbox_xml = data.get("rekordbox_xml")
    track_ids = data.get("track_ids", [])

    if not files:
        send({"type": "error", "message": "No files provided."})
        return
    if not stems:
        send({"type": "error", "message": "No stems selected."})
        return
    if not output_dir:
        send({"type": "error", "message": "No output directory specified."})
        return

    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)

    # Initialize separator
    try:
        separator = StemSeparator()
    except Exception as e:
        send({"type": "error", "message": f"Failed to initialize separator: {e}"})
        return

    total_files = len(files)
    all_stem_files = {}  # track_id -> {stem_name: path}

    for idx, file_path in enumerate(files):
        file_name = Path(file_path).name
        send({
            "type": "progress",
            "file": file_name,
            "file_index": idx + 1,
            "total_files": total_files,
            "percent": int((idx / total_files) * 100),
            "status": f"Processing {file_name}...",
        })

        try:
            # Separate stems
            def progress_cb(stem_name, pct):
                send({
                    "type": "progress",
                    "file": file_name,
                    "file_index": idx + 1,
                    "total_files": total_files,
                    "percent": int((idx / total_files) * 100) + int(pct / total_files),
                    "status": f"Separating {stem_name} from {file_name}...",
                })

            results = separator.separate(
                audio_path=file_path,
                stems=stems,
                quality=quality,
                gpu_jobs=gpu_jobs,
                output_dir=output_dir,
                progress_callback=progress_cb,
            )

            # Copy metadata to each generated stem
            for stem_name, stem_path in results.items():
                copy_metadata(file_path, stem_path, stem_name.upper())

            # Track results for Rekordbox XML generation
            if track_ids and idx < len(track_ids):
                all_stem_files[track_ids[idx]] = results

        except Exception as e:
            send({
                "type": "error",
                "message": f"Failed to process {file_name}: {traceback.format_exc()}",
            })

    # Generate Rekordbox XML if requested
    output_xml_path = None
    if rekordbox_xml and all_stem_files:
        try:
            manager = RekordboxXMLManager(rekordbox_xml)
            output_xml_path = os.path.join(output_dir, "rekordbox_stems.xml")
            manager.generate_stems_xml(all_stem_files, output_xml_path)
            send({
                "type": "log",
                "message": f"Rekordbox XML generated: {output_xml_path}",
            })
        except Exception as e:
            send({
                "type": "error",
                "message": f"Failed to generate Rekordbox XML: {e}",
            })

    send({
        "type": "complete",
        "total_processed": total_files,
        "output_dir": output_dir,
        "rekordbox_xml": output_xml_path,
    })


def main():
    """Main IPC loop: read JSON commands from stdin, dispatch handlers."""
    send({"type": "ready", "message": "STMZ AI Engine ready."})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            send({"type": "error", "message": f"Invalid JSON: {line}"})
            continue

        cmd = data.get("cmd", "")

        try:
            if cmd == "scan_folder":
                handle_scan_folder(data)
            elif cmd == "scan_rekordbox":
                handle_scan_rekordbox(data)
            elif cmd == "get_playlist_tracks":
                handle_get_playlist_tracks(data)
            elif cmd == "get_cover_art":
                handle_get_cover_art(data)
            elif cmd == "process":
                handle_process(data)
            elif cmd == "quit":
                send({"type": "log", "message": "Engine shutting down."})
                break
            else:
                send({"type": "error", "message": f"Unknown command: {cmd}"})
        except Exception as e:
            send({"type": "error", "message": f"Command failed: {traceback.format_exc()}"})


if __name__ == "__main__":
    main()
