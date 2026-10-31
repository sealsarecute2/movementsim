"""Discover menu tracks from the repository's music folder."""
from pathlib import Path
import argparse
import json
import re
from urllib.parse import quote

AUDIO_EXTENSIONS = {'.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.webm', '.mp4'}
MAX_TRACKS = 1000

def music_catalog(directory):
    directory = Path(directory).resolve()
    titles = {}
    try:
        source = json.loads((directory / 'sources.json').read_text())
        for item in source.get('tracks', []):
            if isinstance(item, dict) and isinstance(item.get('file'), str):
                title = item.get('title') or Path(item.get('provided_filename') or item['file']).stem
                if isinstance(title, str):
                    titles[item['file']] = title
    except (OSError, ValueError, TypeError):
        pass
    tracks = []
    if directory.is_dir():
        for file in sorted(directory.rglob('*'), key=lambda path: (path.relative_to(directory).as_posix().casefold(), path.as_posix())):
            relative = file.relative_to(directory)
            if file.suffix.lower() not in AUDIO_EXTENSIONS or any(part.startswith('.') for part in relative.parts):
                continue
            if any(ord(char) < 32 or ord(char) == 127 for char in relative.as_posix()):
                continue
            if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(directory):
                continue
            title = titles.get(relative.as_posix()) or file.stem.replace('_', ' ')
            title = re.sub(r'\s+', ' ', title).strip()[:200] or file.stem[:200]
            tracks.append({'title': title, 'src': 'music/' + quote(relative.as_posix(), safe='/')})
            if len(tracks) > MAX_TRACKS:
                raise ValueError('The music folder supports up to 1,000 tracks.')
    return {'version': 1, 'tracks': tracks}

def write_catalog(root):
    root = Path(root)
    catalog = music_catalog(root / 'music')
    payload = json.dumps(catalog, ensure_ascii=False, indent=2) + '\n'
    # This module is also embedded in the standalone HTML build.
    literal = json.dumps(catalog['tracks'], ensure_ascii=True, indent=2).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    module = '/* Generated from music/. Add or remove audio files there. */\nexport const MUSIC_CATALOG=Object.freeze(' + literal + ');\n'
    for folder in [root, root / 'dist']:
        (folder / 'music').mkdir(parents=True, exist_ok=True)
        (folder / 'music' / 'playlist.json').write_text(payload, encoding='utf-8')
        (folder / 'music-catalog.js').write_text(module, encoding='utf-8')
    return catalog

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    if args.json:
        print(json.dumps(music_catalog(args.root / 'music'), ensure_ascii=False))
    else:
        catalog = write_catalog(args.root)
        print(f"Found {len(catalog['tracks'])} music tracks.")
