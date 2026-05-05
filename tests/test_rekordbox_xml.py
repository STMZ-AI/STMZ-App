"""
Tests for the Rekordbox XML Manager.
Tests parsing, querying, and generating stems XML.
"""

import os
import sys
import tempfile
import shutil
from pathlib import Path
from xml.etree import ElementTree as ET

# Add engine to path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine'))

from rekordbox_xml_manager import RekordboxXMLManager


def create_test_xml(path: str) -> str:
    """Create a minimal but valid rekordbox.xml for testing."""
    xml_content = """<?xml version="1.0" encoding="utf-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="6.0.0" Company="AlphaTheta"/>
  <COLLECTION Entries="3">
    <TRACK TrackID="1" Name="Test Track Alpha" Artist="DJ Test" Album="Test Album"
           Genre="House" AverageBpm="128.00" TotalTime="240" Tonality="Am"
           Location="file://localhost/C:/Music/test_alpha.mp3"
           BitRate="320" SampleRate="44100">
      <TEMPO Inizio="0.100" Bpm="128.00" Metro="4/4" Battito="1"/>
      <POSITION_MARK Name="Cue 1" Type="0" Num="0" Start="0.500"/>
      <POSITION_MARK Name="Cue 2" Type="0" Num="1" Start="32.000"/>
    </TRACK>
    <TRACK TrackID="2" Name="Test Track Beta" Artist="DJ Demo" Album="Demo Album"
           Genre="Techno" AverageBpm="130.00" TotalTime="300" Tonality="Cm"
           Location="file://localhost/C:/Music/test_beta.wav"
           BitRate="1411" SampleRate="44100">
      <TEMPO Inizio="0.050" Bpm="130.00" Metro="4/4" Battito="1"/>
      <POSITION_MARK Name="Drop" Type="0" Num="0" Start="64.000"/>
    </TRACK>
    <TRACK TrackID="3" Name="Test Track Gamma" Artist="DJ Sample" Album="Sample Pack"
           Genre="DnB" AverageBpm="174.00" TotalTime="180" Tonality="Fm"
           Location="file://localhost/C:/Music/test_gamma.flac"
           BitRate="1000" SampleRate="48000">
    </TRACK>
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="2">
      <NODE Name="My Playlist" Type="1" KeyType="0" Entries="2">
        <TRACK Key="1"/>
        <TRACK Key="2"/>
      </NODE>
      <NODE Name="Favorites" Type="1" KeyType="0" Entries="1">
        <TRACK Key="3"/>
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>"""

    with open(path, 'w', encoding='utf-8') as f:
        f.write(xml_content)

    return path


def test_load_and_parse():
    """Test that the XML is loaded and parsed correctly."""
    with tempfile.TemporaryDirectory() as tmpdir:
        xml_path = create_test_xml(os.path.join(tmpdir, 'rekordbox.xml'))
        manager = RekordboxXMLManager(xml_path)

        # Check playlists
        playlists = manager.get_playlists()
        assert len(playlists) == 2, f"Expected 2 playlists, got {len(playlists)}"
        assert playlists[0]['name'] == 'My Playlist'
        assert playlists[0]['track_count'] == 2
        assert playlists[1]['name'] == 'Favorites'
        assert playlists[1]['track_count'] == 1

        print("✅ test_load_and_parse PASSED")


def test_get_tracks_in_playlist():
    """Test fetching tracks from a playlist."""
    with tempfile.TemporaryDirectory() as tmpdir:
        xml_path = create_test_xml(os.path.join(tmpdir, 'rekordbox.xml'))
        manager = RekordboxXMLManager(xml_path)

        tracks = manager.get_tracks_in_playlist('My Playlist')
        assert len(tracks) == 2, f"Expected 2 tracks, got {len(tracks)}"
        assert tracks[0]['title'] == 'Test Track Alpha'
        assert tracks[0]['artist'] == 'DJ Test'
        assert tracks[0]['bpm'] == '128.00'
        assert tracks[1]['title'] == 'Test Track Beta'

        print("✅ test_get_tracks_in_playlist PASSED")


def test_get_all_tracks():
    """Test getting all tracks from the collection."""
    with tempfile.TemporaryDirectory() as tmpdir:
        xml_path = create_test_xml(os.path.join(tmpdir, 'rekordbox.xml'))
        manager = RekordboxXMLManager(xml_path)

        all_tracks = manager.get_all_tracks()
        assert len(all_tracks) == 3, f"Expected 3 tracks, got {len(all_tracks)}"

        print("✅ test_get_all_tracks PASSED")


def test_get_track_by_id():
    """Test fetching a specific track by its ID."""
    with tempfile.TemporaryDirectory() as tmpdir:
        xml_path = create_test_xml(os.path.join(tmpdir, 'rekordbox.xml'))
        manager = RekordboxXMLManager(xml_path)

        track = manager.get_track_by_id('2')
        assert track is not None
        assert track['title'] == 'Test Track Beta'
        assert track['artist'] == 'DJ Demo'
        assert track['bpm'] == '130.00'

        # Non-existent track
        missing = manager.get_track_by_id('999')
        assert missing is None

        print("✅ test_get_track_by_id PASSED")


def test_generate_stems_xml():
    """Test generating a new XML with stem tracks and a STEMS playlist."""
    with tempfile.TemporaryDirectory() as tmpdir:
        xml_path = create_test_xml(os.path.join(tmpdir, 'rekordbox.xml'))
        output_xml = os.path.join(tmpdir, 'output', 'rekordbox_stems.xml')
        manager = RekordboxXMLManager(xml_path)

        # Simulate stem files for track 1
        stem_files = {
            '1': {
                'acapella': os.path.join(tmpdir, '[ACAPELLA - Test Track Alpha].mp3'),
                'drums': os.path.join(tmpdir, '[DRUMS - Test Track Alpha].mp3'),
            },
            '2': {
                'instrumental': os.path.join(tmpdir, '[INSTRUMENTAL - Test Track Beta].wav'),
            },
        }

        result_path = manager.generate_stems_xml(stem_files, output_xml)

        # Verify the output XML exists
        assert os.path.exists(result_path), "Output XML was not created"

        # Parse the output XML
        output_tree = ET.parse(result_path)
        output_root = output_tree.getroot()

        # Check that new tracks were added to the collection
        collection = output_root.find('.//COLLECTION')
        all_tracks = collection.findall('TRACK')
        assert len(all_tracks) == 6, f"Expected 6 tracks (3 original + 3 stems), got {len(all_tracks)}"

        # Check that original cue points are preserved in stems
        stem_tracks = [t for t in all_tracks if t.get('TrackID') not in ('1', '2', '3')]
        assert len(stem_tracks) == 3, f"Expected 3 stem tracks, got {len(stem_tracks)}"

        # Verify stem for track 1 has cue points preserved
        acapella_track = None
        for t in stem_tracks:
            if 'ACAPELLA' in t.get('Name', ''):
                acapella_track = t
                break

        assert acapella_track is not None, "Acapella stem track not found"
        cue_points = acapella_track.findall('POSITION_MARK')
        assert len(cue_points) == 2, f"Expected 2 cue points preserved, got {len(cue_points)}"
        assert cue_points[0].get('Start') == '0.500', "Cue point 1 not preserved"

        # Check the STEMS playlist
        stems_playlist = None
        for node in output_root.iter('NODE'):
            if node.get('Name') == 'STEMS':
                stems_playlist = node
                break

        assert stems_playlist is not None, "STEMS playlist not found"
        stem_refs = stems_playlist.findall('TRACK')
        assert len(stem_refs) == 3, f"Expected 3 tracks in STEMS playlist, got {len(stem_refs)}"

        print("✅ test_generate_stems_xml PASSED")


def test_generate_stems_xml_with_existing_stems_playlist():
    """Test that stems are appended to an existing STEMS playlist."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create XML, generate once, then load the output and generate again
        xml_path = create_test_xml(os.path.join(tmpdir, 'rekordbox.xml'))
        output_xml = os.path.join(tmpdir, 'output', 'rekordbox_stems.xml')
        manager = RekordboxXMLManager(xml_path)

        # First batch
        stem_files_1 = {
            '1': {'acapella': os.path.join(tmpdir, '[ACAPELLA - Test Track Alpha].mp3')},
        }
        manager.generate_stems_xml(stem_files_1, output_xml)

        # Reload the output and add more stems
        manager2 = RekordboxXMLManager(output_xml)
        output_xml_2 = os.path.join(tmpdir, 'output', 'rekordbox_stems_v2.xml')
        stem_files_2 = {
            '2': {'drums': os.path.join(tmpdir, '[DRUMS - Test Track Beta].wav')},
        }
        manager2.generate_stems_xml(stem_files_2, output_xml_2)

        # Parse the second output
        tree2 = ET.parse(output_xml_2)
        root2 = tree2.getroot()
        collection = root2.find('.//COLLECTION')
        all_tracks = collection.findall('TRACK')
        # 3 original + 1 from first batch + 1 from second batch = 5
        assert len(all_tracks) == 5, f"Expected 5 tracks, got {len(all_tracks)}"

        print("✅ test_generate_stems_xml_with_existing_stems_playlist PASSED")


if __name__ == '__main__':
    test_load_and_parse()
    test_get_tracks_in_playlist()
    test_get_all_tracks()
    test_get_track_by_id()
    test_generate_stems_xml()
    test_generate_stems_xml_with_existing_stems_playlist()
    print("\n🎉 All Rekordbox XML Manager tests passed!")
