"""
Test script to verify the RekordboxXMLManager generates valid output.

Simulates processing 2 tracks from the 'Afro House' playlist with 
'acapella' and 'drums' stems, then checks the output XML structure.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'engine'))

from rekordbox_xml_manager import RekordboxXMLManager
from xml.etree import ElementTree as ET

INPUT_XML = os.path.join(os.path.dirname(__file__), 'rekordbox.xml')
OUTPUT_XML = os.path.join(os.path.dirname(__file__), 'test_output_stems.xml')


def main():
    print("=" * 60)
    print("STMZ AI — Rekordbox XML Export Test")
    print("=" * 60)

    # ── Load ────────────────────────────────────────────────────
    mgr = RekordboxXMLManager(INPUT_XML)
    print(f"\n✅ Loaded XML: {INPUT_XML}")
    print(f"   Total tracks in collection: {len(mgr._tracks)}")
    print(f"   Total playlists:            {len(mgr._playlists)}")

    # Show playlists
    print("\n📋 Playlists found:")
    for pl in mgr.get_playlists():
        print(f"   • {pl['name']} ({pl['track_count']} tracks)")

    # ── Pick test tracks from Afro House ────────────────────────
    afro_tracks = mgr.get_tracks_in_playlist("Afro House")
    print(f"\n🎵 Tracks in 'Afro House': {len(afro_tracks)}")

    if len(afro_tracks) < 2:
        print("❌ Need at least 2 tracks in Afro House for the test")
        return

    test_tracks = afro_tracks[:2]
    print(f"   Using tracks:")
    for t in test_tracks:
        print(f"     [{t['id']}] {t['artist']} - {t['title']}")

    # ── Simulate stem separation results ────────────────────────
    stem_files = {}
    for t in test_tracks:
        stem_files[t["id"]] = {
            "acapella": f"D:/STMZ_Output/{t['title']}_acapella.mp3",
            "drums": f"D:/STMZ_Output/{t['title']}_drums.mp3",
        }

    # ── Generate output XML ─────────────────────────────────────
    output_path = mgr.generate_stems_xml(stem_files, OUTPUT_XML)
    print(f"\n✅ Output XML written to: {output_path}")

    # ── Verify the output ───────────────────────────────────────
    print("\n" + "=" * 60)
    print("VERIFICATION")
    print("=" * 60)

    tree = ET.parse(OUTPUT_XML)
    root = tree.getroot()

    # 1. Check DJ_PLAYLISTS version
    version = root.get("Version")
    print(f"\n1️⃣  DJ_PLAYLISTS Version: {version}")
    assert version == "1.0.0", f"Expected 1.0.0, got {version}"

    # 2. Check PRODUCT element
    product = root.find(".//PRODUCT")
    print(f"2️⃣  PRODUCT: {product.get('Name')} v{product.get('Version')}")

    # 3. Check COLLECTION count
    collection = root.find(".//COLLECTION")
    entries_attr = collection.get("Entries")
    actual_track_count = len(collection.findall("TRACK"))
    print(f"3️⃣  COLLECTION Entries attr: {entries_attr}")
    print(f"   Actual TRACK count:       {actual_track_count}")
    assert entries_attr == str(actual_track_count), \
        f"❌ Entries mismatch: attr={entries_attr}, actual={actual_track_count}"
    print(f"   ✅ Entries count matches ({actual_track_count})")

    # 4. Check new stem tracks exist in collection
    new_tracks = []
    for track in collection.findall("TRACK"):
        name = track.get("Name", "")
        if name.startswith("[ACAPELLA") or name.startswith("[DRUMS"):
            new_tracks.append(track)

    print(f"\n4️⃣  New stem tracks in COLLECTION: {len(new_tracks)}")
    for nt in new_tracks:
        loc = nt.get("Location", "")
        print(f"   • {nt.get('Name')}")
        print(f"     ID:       {nt.get('TrackID')}")
        print(f"     Location: {loc}")
        # Check that Location doesn't have encoded colons
        if "%3A" in loc or "%2F" in loc:
            print(f"     ❌ BAD ENCODING: colons/slashes are URL-encoded!")
        else:
            print(f"     ✅ Location encoding looks correct")
        # Check cue points are preserved
        cues = nt.findall("POSITION_MARK")
        tempos = nt.findall("TEMPO")
        print(f"     Cue points: {len(cues)}, Tempo marks: {len(tempos)}")

    assert len(new_tracks) == 4, f"Expected 4 stem tracks (2 tracks × 2 stems), got {len(new_tracks)}"

    # 5. Check PLAYLISTS structure
    playlists_root = root.find(".//PLAYLISTS")
    root_node = playlists_root.find("NODE")
    root_count = root_node.get("Count")
    root_type = root_node.get("Type")
    root_name = root_node.get("Name")
    actual_children = len(root_node.findall("NODE"))
    print(f"\n5️⃣  ROOT NODE: Name={root_name}, Type={root_type}, Count={root_count}")
    print(f"   Actual child NODEs: {actual_children}")
    
    if root_count and int(root_count) != actual_children:
        print(f"   ❌ ROOT Count mismatch! attr={root_count} vs actual={actual_children}")
    else:
        print(f"   ✅ ROOT Count matches")

    # 6. Check STEMS playlist exists
    stems_node = None
    for child in root_node.findall("NODE"):
        if child.get("Name") == "STEMS":
            stems_node = child
            break

    if stems_node is None:
        print(f"\n6️⃣  ❌ STEMS playlist NOT FOUND!")
    else:
        stems_type = stems_node.get("Type")
        stems_entries = stems_node.get("Entries")
        stems_tracks = stems_node.findall("TRACK")
        print(f"\n6️⃣  STEMS playlist found!")
        print(f"   Type:    {stems_type}")
        print(f"   Entries: {stems_entries}")
        print(f"   Actual TRACK refs: {len(stems_tracks)}")

        assert stems_type == "1", f"Expected Type=1, got {stems_type}"
        assert stems_entries == str(len(stems_tracks)), \
            f"❌ Entries mismatch: attr={stems_entries}, actual={len(stems_tracks)}"

        # Check that track Keys point to valid TrackIDs in collection
        collection_ids = set(t.get("TrackID") for t in collection.findall("TRACK"))
        for tr in stems_tracks:
            key = tr.get("Key")
            if key in collection_ids:
                print(f"   ✅ TRACK Key={key} found in collection")
            else:
                print(f"   ❌ TRACK Key={key} NOT in collection!")

    # ── Summary ─────────────────────────────────────────────────
    print("\n" + "=" * 60)
    
    # Count issues
    issues = []
    if root_count and int(root_count) != actual_children:
        issues.append(f"ROOT Count wrong ({root_count} vs {actual_children})")
    if stems_node is None:
        issues.append("STEMS playlist missing")
    for nt in new_tracks:
        loc = nt.get("Location", "")
        if "%3A" in loc or "%2F" in loc:
            issues.append(f"Bad encoding in {nt.get('Name')}")
    
    if issues:
        print("❌ ISSUES FOUND:")
        for i in issues:
            print(f"   • {i}")
    else:
        print("✅ ALL CHECKS PASSED!")
    print("=" * 60)

    # Cleanup
    if os.path.exists(OUTPUT_XML):
        os.remove(OUTPUT_XML)
        print(f"\n🗑️  Cleaned up {OUTPUT_XML}")


if __name__ == "__main__":
    main()
