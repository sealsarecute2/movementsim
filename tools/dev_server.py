"""Local preview with a live music catalog and root music assets."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse
import json
from music_catalog import music_catalog

class MusicPreviewHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/ogg'}
    def __init__(self, *args, root, **kwargs):
        self.root = Path(root).resolve()
        super().__init__(*args, directory=str(self.root / 'dist'), **kwargs)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def translate_path(self, path):
        pathname = unquote(urlsplit(path).path)
        if pathname.startswith('/music/'):
            music = self.root / 'music'
            target = (music / pathname[len('/music/'):]).resolve()
            if not target.is_relative_to(music) or not target.is_file():
                return str(music / '.missing-file')
            return str(target)
        return super().translate_path(path)
    def send_head(self):
        if urlsplit(self.path).path == '/music/playlist.json':
            try:
                payload = json.dumps(music_catalog(self.root / 'music'), ensure_ascii=False).encode()
            except ValueError as error:
                self.send_error(422, str(error))
                return None
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            import io
            return io.BytesIO(payload)
        return super().send_head()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5173)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(MusicPreviewHandler, root=args.root))
    print(f'Movement Lab: http://localhost:{server.server_port}/', flush=True)
    server.serve_forever()
