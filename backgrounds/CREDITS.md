# Galaxy environment

**Free 8k Space and Galaxies HDRi**, by **Alex Melas / alexandr-melas**.

- [Original listing](https://www.cgtrader.com/free-3d-models/space/other/free-8k-space-and-galaxies-hdri)
- [Creator's original public release and download](https://blenderartists.org/t/free-space-hdri/1517850)
- [CGTrader Royalty Free License (No AI)](https://www.cgtrader.com/pages/terms-and-conditions)

The original `Free Galaxies 8k.hdr` is 7680 × 4320 pixels and is not distributed
in this repository. `galaxies.mlbg` is an optimized, tone-mapped, 2048 × 1024
runtime background in Movement Lab's own game container. It is incorporated
into this game, not offered as a standalone HDRI or texture download. The
artist's license still applies; the sky asset is not relicensed as source code.
Do not redistribute or extract it for a separate asset library or AI training.

The two coloured light directions and ambient fill are sampled from the
original HDR radiance. Source and runtime hashes are recorded in
`galaxy-data.js`. `tools/build-galaxy.py` rebuilds the game data from a separately
obtained original; it never copies the original HDR into the published files.
