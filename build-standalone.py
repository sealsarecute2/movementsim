"""Bundle the dependency-free modules into a double-clickable browser file."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent
dist = root / 'dist'
# Keep the repository root directly usable by static hosts such as GitHub Pages.
for filename in ('index.html', 'style.css', 'endless.js', 'course.js', 'physics.js', 'renderer.js', 'app.js'):
    (root / filename).write_text((dist / filename).read_text())
pieces = []
for filename in ('endless.js', 'course.js', 'physics.js', 'renderer.js', 'app.js'):
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
print(f'Built {target.name}: {target.stat().st_size:,} bytes')
