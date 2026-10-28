"""Bundle movement code and copy the optional first-person knife assets."""
from pathlib import Path
import re
import shutil

root = Path(__file__).resolve().parent
dist = root / 'dist'
# Keep the repository root directly usable by static hosts such as GitHub Pages.
modules = ('endless.js', 'course.js', 'physics.js', 'skybox.js', 'lighting.js', 'parkour-map.js', 'source-map.js', 'source-runtime.js', 'renderer.js', 'game-audio.js', 'leaderboard.js', 'menu.js', 'menu-music.js', 'app.js')
for filename in ('index.html', 'style.css', *modules):
    (root / filename).write_text((dist / filename).read_text())
for filename in ('favicon.ico', 'favicon.svg'):
    shutil.copyfile(dist / filename, root / filename)
for directory in ('butterfly', 'vendor', 'sounds', 'music', 'maps'):
    shutil.copytree(dist / directory, root / directory, dirs_exist_ok=True)
pieces = []
for filename in modules:
    source = (dist / filename).read_text()
    source = re.sub(r'^import .*?;\n', '', source, flags=re.MULTILINE)
    source = re.sub(r'^export ', '', source, flags=re.MULTILINE)
    pieces.append(source)
css = (dist / 'style.css').read_text()
html = (dist / 'index.html').read_text()
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
html = html.replace('<script type="module" src="app.js"></script>', '<script type="module">\n' + '\n'.join(pieces) + '\n</script>')
target = root / 'movement-lab.html'
target.write_text(html)
# Owner-edited leaderboard text files are authoritative at the repository root.
# A code rebuild must never replace published records with an older dist copy.
if (dist / 'leaderboards').exists():
    shutil.rmtree(dist / 'leaderboards')
shutil.copytree(root / 'leaderboards', dist / 'leaderboards')
# Serve the same complete build at the public entry point. Course code cannot
# come from an older cached module while the menu comes from a newer HTML file.
(root / 'index.html').write_text(html)
print(f'Built {target.name}: {target.stat().st_size:,} bytes')
