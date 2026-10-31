# Multiplayer configuration

The public site works with PeerJS's free signaling service without an account or API key. The game uses the PeerServer wire protocol and native WebRTC data channels; no third-party browser SDK is downloaded. GitHub Pages serves the website and maps. Each host browser coordinates a private room of up to four players.

Movement is sent up to 20 times a second on a channel that can discard stale packets. Joining and ping requests use a separate reliable channel. Guests send their own state to the host, which distributes the room snapshot. Ping is the measured round-trip time over that player-to-host connection. Characters interpolate recent positions and snap when a portal or reset changes position sharply. Character geometry is excluded from collisions.

Room times are casual, client-reported times. Global top-five leaderboards use separate server-verified solo runs. Custom room maps cannot submit global records.

## Custom maps

Choose **Upload custom map** before hosting, then select Source 1 BSP 19/20 (`.bsp` or `.zip`) or a playable map `.json`. The map is prepared and selected in the room menu. Guests receive it automatically before joining the active room. No shared upload host, account or manual copy is needed.

Only validated playable geometry, spawns, checkpoints, signs and movement triggers are shared. The parser retains teleport destinations (including `info_target` and landmarks), teleport offsets and momentum, enable/disable filters, boosts and harmful `trigger_hurt` volumes. Arbitrary entity commands and embedded scripts are ignored. Explicit reset zones remain active; the fallback kill plane is 2,000 units below the lowest geometry object.

The source upload limit is 180 MB. The prepared map is limited to 16 MB, 20,000 geometry objects and bounded trigger counts. Reliable WebRTC control packets carry 8 KiB chunks, with sequence and size checks, backpressure and a SHA-256 digest. A guest installs geometry only after the complete payload passes its checksum and map validation. Transfer activity is bounded by the room connection deadline; leaving releases partial downloads. The signaling service only exchanges connection information.

## Optional Metered signaling and TURN relay

Direct WebRTC connections can fail on restrictive networks. To supply a TURN relay using Metered's free allowance:

1. Create a free account at <https://dashboard.metered.ca/>.
2. Open **Realtime Messaging → Keys → Create key → Publishable**.
3. Enable `subscribe`, `publish`, `presence`, and `send` for the key. `send` is needed to exchange offers and ICE candidates.
4. Set the channel pattern to `movement-lab/*`, or use your account's allowed application prefix.
5. Edit `dist/multiplayer-config.js`: put the **publishable** `pk_live_…` key into `meteredPublishableKey`, and set `meteredChannelPrefix` to match the allowed pattern without the final `/*`. For `app_example/rooms/*`, use `app_example/rooms`.
6. Run `python3 build-standalone.py`, commit the source and generated files, and deploy. All players should refresh after changing providers.

The key is meant for browsers. Keep secret keys and TURN REST API keys out of this public repository. Server-provided ICE credentials from Metered's welcome message configure the relay automatically. Gameplay continues over WebRTC; movement snapshots never consume the signaling message allowance.

The default public service and free allowances are third-party services, with their own availability and usage limits. No paid service is enabled by this configuration.

## Protocol references

- PeerJS free signaling and TURN requirements: <https://peerjs.com/client/faq>
- PeerServer WebSocket implementation: <https://github.com/peers/peerjs-server/tree/master/src/services/webSocketServer>
- PeerServer message forwarding: <https://github.com/peers/peerjs-server/tree/master/src/messageHandler/handlers/transmission>
- Metered wire format: <https://www.metered.ca/docs/realtime-messaging/protocol/wire-format/>
- Metered publishable key permissions: <https://www.metered.ca/docs/realtime-messaging/protocol/authentication/>
