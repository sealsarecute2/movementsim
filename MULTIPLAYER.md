# Multiplayer configuration

The public site works with PeerJS's free signaling service without an account or API key. The game uses the PeerServer wire protocol and native WebRTC data channels; no third-party browser SDK is downloaded. GitHub Pages serves the website and maps. Each host browser coordinates a private room of up to four players.

Movement is sent up to 20 times a second on a channel that can discard stale packets. Joining and ping requests use a separate reliable channel. Guests send their own state to the host, which distributes the room snapshot. Ping is the measured round-trip time over that player-to-host connection. Characters interpolate recent positions and snap when a portal or reset changes position sharply. Character geometry is excluded from collisions.

Room times are casual, client-reported times. Shared leaderboards retain the existing owner-published record process.

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
