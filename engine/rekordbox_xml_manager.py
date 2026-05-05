"""
STMZ AI - Rekordbox XML Manager
Parses and generates rekordbox.xml files for seamless integration with Rekordbox.

Handles:
  - Reading the user's rekordbox.xml to list playlists and tracks.
  - Duplicating track entries for generated stems.
  - Preserving cue points, beat grids, BPM, and all Rekordbox-specific metadata.
  - Creating a "STEMS" playlist in the output XML.
"""

import os
import copy
import urllib.parse
from pathlib import Path
from xml.etree import ElementTree as ET


# ── Default Rekordbox XML locations ─────────────────────────────────────────

def find_rekordbox_xml() -> str | None:
    """
    Attempt to locate the user's rekordbox.xml file.

    Checks common locations on Windows:
      - %APPDATA%/Pioneer/rekordbox/rekordbox.xml
      - %USERPROFILE%/Documents/rekordbox/rekordbox.xml
      - %APPDATA%/Pioneer/rekordbox6/rekordbox.xml

    Returns:
        Path to the XML file, or None if not found.
    """
    home = Path.home()
    appdata = Path(os.environ.get("APPDATA", ""))

    candidates = [
        appdata / "Pioneer" / "rekordbox" / "rekordbox.xml",
        appdata / "Pioneer" / "rekordbox6" / "rekordbox.xml",
        home / "Documents" / "rekordbox" / "rekordbox.xml",
        # macOS paths
        home / "Library" / "Pioneer" / "rekordbox" / "rekordbox.xml",
    ]

    for path in candidates:
        if path.exists():
            return str(path)

    return None


class RekordboxXMLManager:
    """Parse and manipulate rekordbox.xml files."""

    def __init__(self, xml_path: str | None = None):
        self.xml_path = xml_path
        self.tree = None
        self.root = None
        self._tracks = {}  # TrackID -> Element
        self._playlists = []  # List of playlist dicts

        if xml_path and os.path.exists(xml_path):
            self.load(xml_path)

    # ── Loading ─────────────────────────────────────────────────────────────

    def load(self, xml_path: str):
        """Load and parse a rekordbox.xml file."""
        self.xml_path = xml_path
        self.tree = ET.parse(xml_path)
        self.root = self.tree.getroot()
        self._parse_tracks()
        self._parse_playlists()

    def _parse_tracks(self):
        """Parse the COLLECTION element to build a track lookup."""
        self._tracks = {}
        collection = self.root.find(".//COLLECTION")
        if collection is not None:
            for track in collection.findall("TRACK"):
                track_id = track.get("TrackID")
                if track_id:
                    self._tracks[track_id] = track

    def _parse_playlists(self, node=None, path=""):
        """Recursively parse the PLAYLISTS element."""
        if node is None:
            self._playlists = []
            playlists_root = self.root.find(".//PLAYLISTS")
            if playlists_root is None:
                return
            # The root NODE element
            root_node = playlists_root.find("NODE")
            if root_node is None:
                return
            for child in root_node.findall("NODE"):
                self._parse_playlists(child, "")
            return

        name = node.get("Name", "Unknown")
        node_type = node.get("Type", "0")
        current_path = f"{path}/{name}" if path else name

        if node_type == "0":
            # Folder: recurse into children
            for child in node.findall("NODE"):
                self._parse_playlists(child, current_path)
        elif node_type == "1":
            # Playlist: collect track references
            track_ids = []
            for track_ref in node.findall("TRACK"):
                key = track_ref.get("Key")
                if key:
                    track_ids.append(key)

            self._playlists.append({
                "name": name,
                "path": current_path,
                "track_ids": track_ids,
                "track_count": len(track_ids),
            })

    # ── Querying ────────────────────────────────────────────────────────────

    def get_playlists(self) -> list[dict]:
        """Return a list of playlist summaries."""
        return self._playlists

    def get_tracks_in_playlist(self, playlist_name: str) -> list[dict]:
        """Return track details for all tracks in a given playlist."""
        for pl in self._playlists:
            if pl["name"] == playlist_name or pl["path"] == playlist_name:
                tracks = []
                for tid in pl["track_ids"]:
                    track_el = self._tracks.get(tid)
                    if track_el is not None:
                        tracks.append(self._track_to_dict(track_el))
                return tracks
        return []

    def get_all_tracks(self) -> list[dict]:
        """Return all tracks in the collection."""
        return [self._track_to_dict(t) for t in self._tracks.values()]

    def get_track_by_id(self, track_id: str) -> dict | None:
        """Return a single track's details by TrackID."""
        track_el = self._tracks.get(track_id)
        if track_el is not None:
            return self._track_to_dict(track_el)
        return None

    def _track_to_dict(self, track_el) -> dict:
        """Convert a TRACK XML element to a dict."""
        location = track_el.get("Location", "")
        # Decode file:// URI to a regular path
        if location.startswith("file://localhost/"):
            file_path = urllib.parse.unquote(location.replace("file://localhost/", ""))
        else:
            file_path = urllib.parse.unquote(location)

        return {
            "id": track_el.get("TrackID", ""),
            "title": track_el.get("Name", "Unknown"),
            "artist": track_el.get("Artist", "Unknown"),
            "album": track_el.get("Album", ""),
            "genre": track_el.get("Genre", ""),
            "bpm": track_el.get("AverageBpm", "0"),
            "key": track_el.get("Tonality", ""),
            "duration": track_el.get("TotalTime", "0"),
            "location": location,
            "file_path": file_path,
            "bitrate": track_el.get("BitRate", ""),
            "sample_rate": track_el.get("SampleRate", ""),
        }

    # ── Generating output XML ───────────────────────────────────────────────

    def generate_stems_xml(
        self,
        stem_files: dict[str, dict[str, str]],
        output_xml_path: str,
    ):
        """
        Generate a new rekordbox.xml containing stem tracks in a "STEMS" playlist.

        Args:
            stem_files: Dict mapping original TrackID -> { stem_name: file_path }.
                Example: {"123": {"acapella": "/path/to/acapella.mp3", "drums": "/path/to/drums.mp3"}}
            output_xml_path: Path to write the new XML file.
        """
        if self.root is None:
            raise RuntimeError("No rekordbox.xml loaded. Call load() first.")

        # Deep copy the tree so we don't mutate the original
        new_tree = copy.deepcopy(self.tree)
        new_root = new_tree.getroot()

        collection = new_root.find(".//COLLECTION")
        if collection is None:
            raise RuntimeError("No COLLECTION element found in XML.")

        # Find the max TrackID to generate new unique IDs
        max_id = max(int(t.get("TrackID", 0)) for t in collection.findall("TRACK"))

        # Track new stem entries for the STEMS playlist
        new_track_ids = []

        for original_id, stems in stem_files.items():
            original_track = None
            for t in collection.findall("TRACK"):
                if t.get("TrackID") == original_id:
                    original_track = t
                    break

            if original_track is None:
                continue

            for stem_name, stem_path in stems.items():
                max_id += 1
                new_id = str(max_id)

                # Deep copy the original track element
                new_track = copy.deepcopy(original_track)
                new_track.set("TrackID", new_id)

                # Update the file location
                stem_path_abs = Path(stem_path).resolve()
                # Preserve : and / so Rekordbox gets a valid file://localhost/C:/... URI
                encoded_path = urllib.parse.quote(
                    str(stem_path_abs).replace("\\", "/"),
                    safe="/:"
                )
                new_track.set("Location", f"file://localhost/{encoded_path}")

                # Update the title
                original_name = original_track.get("Name", "Unknown")
                new_track.set("Name", f"[{stem_name.upper()} - {original_name}]")

                # All cue points, beat grids, tempo, etc. are preserved
                # because we deep-copied the original track element

                collection.append(new_track)
                new_track_ids.append(new_id)

        # Update collection count
        collection.set("Entries", str(len(collection.findall("TRACK"))))

        # Create or update the STEMS playlist
        playlists_root = new_root.find(".//PLAYLISTS")
        if playlists_root is not None:
            root_node = playlists_root.find("NODE")
            if root_node is not None:
                # Look for existing STEMS folder/playlist
                stems_node = None
                for child in root_node.findall("NODE"):
                    if child.get("Name") == "STEMS":
                        stems_node = child
                        break

                if stems_node is None:
                    # Create a new STEMS playlist node
                    stems_node = ET.SubElement(root_node, "NODE")
                    stems_node.set("Name", "STEMS")
                    stems_node.set("Type", "1")  # Playlist type
                    stems_node.set("KeyType", "0")
                    stems_node.set("Entries", "0")
                    # Increment the root NODE's Count
                    # (Rekordbox uses "Count" on folder nodes, Type=0)
                    root_count = root_node.get("Count")
                    if root_count is not None:
                        root_node.set("Count", str(int(root_count) + 1))
                    else:
                        # Fallback: set Count to the actual child count
                        root_node.set(
                            "Count",
                            str(len(root_node.findall("NODE")))
                        )

                # Add new tracks to the STEMS playlist
                for tid in new_track_ids:
                    track_ref = ET.SubElement(stems_node, "TRACK")
                    track_ref.set("Key", tid)

                # Update entry count
                stems_node.set(
                    "Entries",
                    str(len(stems_node.findall("TRACK")))
                )

        # Write the output XML
        output_path = Path(output_xml_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Write with XML declaration
        new_tree.write(
            str(output_path),
            encoding="utf-8",
            xml_declaration=True,
        )

        return str(output_path)
