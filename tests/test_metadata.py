"""
Tests for the Metadata Manager.
Tests extracting track info and metadata copying between audio files.
Note: Tests that involve actual audio files require mutagen to be installed.
"""

import os
import sys
import tempfile
from pathlib import Path

# Add engine to path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine'))

from metadata import get_track_info, copy_metadata


def test_get_track_info_nonexistent():
    """Test that get_track_info handles nonexistent files gracefully."""
    info = get_track_info('/nonexistent/path/to/audio.mp3')
    assert info['title'] == 'audio'
    assert info['artist'] == 'Unknown'
    assert info['format'] == 'MP3'
    assert info['duration'] == 0
    print("✅ test_get_track_info_nonexistent PASSED")


def test_get_track_info_extracts_format():
    """Test that the format is correctly extracted from the file extension."""
    info = get_track_info('/fake/path/song.flac')
    assert info['format'] == 'FLAC'

    info2 = get_track_info('/fake/path/song.WAV')
    assert info2['format'] == 'WAV'

    info3 = get_track_info('/fake/path/song.m4a')
    assert info3['format'] == 'M4A'

    print("✅ test_get_track_info_extracts_format PASSED")


def test_copy_metadata_nonexistent_source():
    """Test that copy_metadata handles missing source gracefully."""
    result = copy_metadata('/nonexistent/source.mp3', '/nonexistent/dest.mp3', 'ACAPELLA')
    assert result is False
    print("✅ test_copy_metadata_nonexistent_source PASSED")


def test_get_track_info_filename_parsing():
    """Test that the title is correctly parsed from the filename."""
    info = get_track_info('/music/Artist - Song Title (Original Mix).mp3')
    assert info['title'] == 'Artist - Song Title (Original Mix)'
    assert info['filename'] == 'Artist - Song Title (Original Mix).mp3'

    print("✅ test_get_track_info_filename_parsing PASSED")


if __name__ == '__main__':
    test_get_track_info_nonexistent()
    test_get_track_info_extracts_format()
    test_copy_metadata_nonexistent_source()
    test_get_track_info_filename_parsing()
    print("\n🎉 All Metadata tests passed!")
