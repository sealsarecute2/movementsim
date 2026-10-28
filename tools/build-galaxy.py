"""Prepare the licensed HDRI as a Movement Lab background and lighting data.

Usage: python3 tools/build-galaxy.py /path/to/Free-Galaxies-8k.hdr
The original HDR stays outside the repository. NumPy is required; --preview
optionally writes a scratch PNG using Pillow for visual verification.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import re
import struct
import zlib
import numpy as np


def read_environment(path, width=2048, height=1024):
    data = path.read_bytes()
    match = re.search(rb'\n-Y (\d+) \+X (\d+)\r?\n', data[:4096])
    if not match or b'FORMAT=32-bit_rle_rgbe' not in data[:match.start()]:
        raise ValueError('Expected a Radiance -Y / +X RGBE HDR panorama.')
    source_h, source_w = map(int, match.groups())
    offset = match.end()
    output = np.zeros((height, width, 3), dtype=np.float32)
    edges = np.linspace(0, source_w, width + 1)
    indices = np.floor(edges).astype(int)
    fractions = (edges - indices).astype(np.float32)[:, None]
    bins = source_h / height
    for row in range(source_h):
        if data[offset:offset + 4] != bytes((2, 2, source_w >> 8, source_w & 255)):
            raise ValueError('Unsupported HDR scanline.')
        offset += 4
        scan = np.empty((4, source_w), dtype=np.uint8)
        for channel in range(4):
            x = 0
            while x < source_w:
                code = data[offset]
                offset += 1
                count = code - 128 if code > 128 else code
                if not count or x + count > source_w:
                    raise ValueError('Invalid HDR scanline run.')
                if code > 128:
                    scan[channel, x:x + count] = data[offset]
                    offset += 1
                else:
                    scan[channel, x:x + count] = np.frombuffer(data, dtype=np.uint8, count=count, offset=offset)
                    offset += count
                x += count
        rgb = scan[:3].T.astype(np.float32) * np.ldexp(np.ones(source_w, dtype=np.float32), scan[3].astype(int) - 136)[:, None]
        integral = np.concatenate((np.zeros((1, 3), dtype=np.float32), np.cumsum(rgb, axis=0)))
        samples = integral[indices] + fractions * rgb[np.minimum(indices, source_w - 1)]
        averaged = np.diff(samples, axis=0) / (source_w / width)
        target = min(height - 1, int(row / bins))
        portion = min(1.0, (target + 1) * bins - row)
        output[target] += averaged * portion / bins
        if portion < 1 and target + 1 < height:
            output[target + 1] += averaged * (1 - portion) / bins
    if not np.isfinite(output).all():
        raise ValueError('HDR contains nonfinite radiance.')
    return output, [source_w, source_h], hashlib.sha256(data).hexdigest()


def lighting_from_environment(rgb, display):
    coarse = rgb.reshape(32, 32, 64, 32, 3).mean(axis=(1, 3))
    theta = np.pi * (np.arange(32) + .5) / 32
    phi = 2 * np.pi * (np.arange(64) + .5) / 64 - np.pi
    longitude, latitude = np.meshgrid(phi, theta)
    vectors = np.stack((np.sin(latitude) * np.cos(longitude), np.cos(latitude), np.sin(latitude) * np.sin(longitude)), axis=-1).reshape(-1, 3)
    colours = coarse.reshape(-1, 3)
    energy = colours @ np.array([.2126, .7152, .0722])
    area = np.sin(latitude).reshape(-1)
    weights = np.minimum(energy, np.quantile(energy, .98)) * area
    candidates = weights * (vectors[:, 1] > .1)
    primary = vectors[np.argmax(candidates)]
    rotation = -np.pi / 2 - math.atan2(primary[2], primary[0])

    def rotate(vector):
        x, y, z = vector
        return [x * math.cos(rotation) - z * math.sin(rotation), y, x * math.sin(rotation) + z * math.cos(rotation)]

    def light(centre):
        region = np.exp((vectors @ centre - 1) * 24) * area
        colour = (colours * region[:, None]).sum(axis=0) / region.sum()
        return np.array(rotate(centre)), colour / max(float(colour.max()), 1e-10)

    direction, colour = light(primary)
    other = vectors[np.argmax(candidates * (vectors @ primary < .35))]
    fill_direction, fill_colour = light(other)
    average = (colours * area[:, None]).sum(axis=0) / area.sum()
    ambient = .12 + .16 * average / max(float(average.max()), 1e-10)
    rounded = lambda values: [round(float(n), 6) for n in values]
    return {
        'direction': rounded(direction), 'colour': rounded(colour), 'ambient': rounded(ambient), 'power': 1.0,
        'fillDirection': rounded(fill_direction), 'fillColour': rounded(fill_colour * .66),
        'uvOffset': round(float((-rotation / (2 * np.pi)) % 1), 8),
        'zenith': rounded(display[:128].mean(axis=(0, 1)) / 255),
        'horizon': rounded(display[480:544].mean(axis=(0, 1)) / 255),
        'ground': rounded(display[-128:].mean(axis=(0, 1)) / 255),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--preview', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    rgb, source_size, source_hash = read_environment(args.source)
    luminance = rgb @ np.array([.2126, .7152, .0722])
    exposure = 1.7 / max(float(np.quantile(luminance, .99)), .0001)
    display = np.round(np.clip(1 - np.exp(-rgb * exposure), 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)
    rgba = np.concatenate((display, np.full((*display.shape[:2], 1), 255, dtype=np.uint8)), axis=2)
    height, width = display.shape[:2]
    # MLBG is a runtime-only game texture container, not a redistributed HDR or
    # standalone image. The original asset retains its author's license.
    packed = struct.pack('<4sBBHHHI', b'MLBG', 1, 4, 0, width, height, rgba.nbytes) + zlib.compress(rgba.tobytes(), 9)
    target = root / 'dist/backgrounds/galaxies.mlbg'
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(packed)
    metadata = {'author': 'Alex Melas (alexandr-melas)', 'sourceSize': source_size, 'sourceSha256': source_hash,
                'packedSha256': hashlib.sha256(packed).hexdigest(), 'width': width, 'height': height,
                'lighting': lighting_from_environment(rgb, display)}
    (root / 'dist/galaxy-data.js').write_text('// Generated by tools/build-galaxy.py from the original licensed HDRI.\nexport const GALAXY_ENVIRONMENT = ' + json.dumps(metadata, separators=(',', ':')) + ';\n')
    if args.preview:
        from PIL import Image
        Image.fromarray(display).save(args.preview)
    print(json.dumps({'source': source_size, 'runtime': [width, height], 'bytes': len(packed), 'lighting': metadata['lighting']}))


if __name__ == '__main__':
    main()
