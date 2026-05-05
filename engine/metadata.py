"""
STMZ AI - Metadata Manager
Copies ID3 tags, album art, and other metadata from source audio to generated stems.
"""

import os
import shutil
from pathlib import Path

from mutagen import File as MutagenFile
from mutagen.id3 import ID3, APIC, TIT2, TPE1, TALB, TDRC, TRCK, TCON
from mutagen.mp3 import MP3
from mutagen.flac import FLAC, Picture
from mutagen.wave import WAVE


def copy_metadata(source_path: str, dest_path: str, stem_type: str) -> bool:
    """
    Copy metadata from source audio file to the destination stem file.
    Updates the title to include the stem type prefix.

    Args:
        source_path: Path to the original audio file.
        dest_path: Path to the generated stem file.
        stem_type: The stem type name (e.g., "ACAPELLA", "DRUMS").

    Returns:
        True if metadata was successfully copied, False otherwise.
    """
    source_path = Path(source_path)
    dest_path = Path(dest_path)

    try:
        source_audio = MutagenFile(str(source_path))
        if source_audio is None:
            return False

        dest_ext = dest_path.suffix.lower()
        source_ext = source_path.suffix.lower()

        if dest_ext == ".mp3":
            return _copy_mp3_metadata(source_path, dest_path, stem_type)
        elif dest_ext == ".flac":
            return _copy_flac_metadata(source_path, dest_path, stem_type)
        elif dest_ext == ".wav":
            return _copy_wav_metadata(source_path, dest_path, stem_type)
        else:
            # For unsupported formats, attempt a generic copy
            return _copy_generic_metadata(source_path, dest_path, stem_type)

    except Exception as e:
        print(f"Warning: Could not copy metadata: {e}")
        return False


def _copy_mp3_metadata(source_path: Path, dest_path: Path, stem_type: str) -> bool:
    """Copy ID3 tags from source to destination MP3 file."""
    try:
        # Load source tags
        source = MP3(str(source_path))
        if source.tags is None:
            return False

        # Try to add ID3 tags to destination
        try:
            dest = MP3(str(dest_path))
            if dest.tags is None:
                dest.add_tags()
        except Exception:
            dest = MP3(str(dest_path))
            dest.add_tags()

        # Copy all frames from source
        for key, value in source.tags.items():
            if key.startswith("TIT2"):
                # Modify title to include stem type
                original_title = str(value)
                dest.tags.add(TIT2(encoding=3, text=f"[ {stem_type.capitalize()} ] - {original_title}"))
            else:
                dest.tags.add(value)

        dest.save()
        return True

    except Exception as e:
        print(f"Warning: MP3 metadata copy failed: {e}")
        return False


def _copy_flac_metadata(source_path: Path, dest_path: Path, stem_type: str) -> bool:
    """Copy Vorbis comments and pictures from source to destination FLAC file."""
    try:
        source = FLAC(str(source_path))
        dest = FLAC(str(dest_path))

        # Copy all tags
        for key, value in source.tags or {}:
            if key.lower() == "title":
                dest[key] = [f"[ {stem_type.capitalize()} ] - {v}" for v in value] if isinstance(value, list) else f"[ {stem_type.capitalize()} ] - {value}"
            else:
                dest[key] = value

        # Copy pictures (album art)
        for pic in source.pictures:
            dest.add_picture(pic)

        dest.save()
        return True

    except Exception as e:
        print(f"Warning: FLAC metadata copy failed: {e}")
        return False


def _copy_wav_metadata(source_path: Path, dest_path: Path, stem_type: str) -> bool:
    """Copy ID3 tags from source to WAV file (WAV supports ID3v2)."""
    try:
        source = MutagenFile(str(source_path))
        if source is None or source.tags is None:
            return False

        dest = WAVE(str(dest_path))
        if dest.tags is None:
            dest.add_tags()

        # Copy what we can from source tags
        if hasattr(source.tags, 'items'):
            for key, value in source.tags.items():
                try:
                    if key.startswith("TIT2"):
                        original_title = str(value)
                        dest.tags.add(TIT2(encoding=3, text=f"[ {stem_type.capitalize()} ] - {original_title}"))
                    else:
                        dest.tags.add(value)
                except Exception:
                    pass  # Skip incompatible frames

        dest.save()
        return True

    except Exception as e:
        print(f"Warning: WAV metadata copy failed: {e}")
        return False


def _copy_generic_metadata(source_path: Path, dest_path: Path, stem_type: str) -> bool:
    """Attempt a generic metadata copy using mutagen."""
    try:
        source = MutagenFile(str(source_path))
        dest = MutagenFile(str(dest_path))

        if source is None or dest is None:
            return False

        if source.tags and dest.tags is not None:
            for key, value in source.tags.items():
                try:
                    dest.tags[key] = value
                except Exception:
                    pass

        dest.save()
        return True

    except Exception as e:
        print(f"Warning: Generic metadata copy failed: {e}")
        return False


def get_track_info(audio_path: str, include_cover: bool = True) -> dict:
    """
    Extract basic track information from an audio file.

    Returns:
        Dict with keys: title, artist, album, duration, format
    """
    audio_path = Path(audio_path)
    info = {
        "path": str(audio_path),
        "filename": audio_path.name,
        "title": audio_path.stem,
        "artist": "Unknown",
        "album": "Unknown",
        "duration": 0,
        "format": audio_path.suffix.lstrip(".").upper(),
        "cover_art": None,
    }

    try:
        audio = MutagenFile(str(audio_path))
        if audio is None:
            return info

        # Duration
        if hasattr(audio.info, "length"):
            info["duration"] = round(audio.info.length, 2)

        # Try to extract tags
        if audio.tags:
            # ID3 tags (MP3, WAV)
            if hasattr(audio.tags, "get"):
                title = audio.tags.get("TIT2")
                if title:
                    info["title"] = str(title)
                artist = audio.tags.get("TPE1")
                if artist:
                    info["artist"] = str(artist)
                album = audio.tags.get("TALB")
                if album:
                    info["album"] = str(album)
            # Vorbis comments (FLAC, OGG)
            elif hasattr(audio.tags, "__getitem__"):
                try:
                    info["title"] = audio.tags["title"][0]
                except (KeyError, IndexError):
                    pass
                try:
                    info["artist"] = audio.tags["artist"][0]
                except (KeyError, IndexError):
                    pass
                try:
                    info["album"] = audio.tags["album"][0]
                except (KeyError, IndexError):
                    pass
            
            # Extract Album Art (Cover)
            if include_cover:
                info["cover_art"] = get_cover_art(str(audio_path), audio)

    except Exception:
        pass

    return info

def get_cover_art(audio_path: str, audio=None) -> str:
    """Extract only the cover art as a base64 string."""
    try:
        if audio is None:
            audio = MutagenFile(audio_path)
        if audio is None or not audio.tags:
            return None

        import base64
        if hasattr(audio.tags, "keys"):
            for key in audio.tags.keys():
                if key.startswith("APIC:"):
                    apic = audio.tags[key]
                    if hasattr(apic, "data") and hasattr(apic, "mime"):
                        mime = apic.mime
                        b64 = base64.b64encode(apic.data).decode('ascii')
                        return f"data:{mime};base64,{b64}"
        if hasattr(audio, "pictures") and audio.pictures:
            pic = audio.pictures[0]
            if hasattr(pic, "data") and hasattr(pic, "mime"):
                mime = pic.mime
                b64 = base64.b64encode(pic.data).decode('ascii')
                return f"data:{mime};base64,{b64}"
    except Exception:
        pass
    return None
