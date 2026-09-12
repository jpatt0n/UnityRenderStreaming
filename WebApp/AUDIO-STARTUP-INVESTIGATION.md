# Incoming audio startup investigation — September 12, 2026

## Confirmed deployment defect

The public hostnames served different versions of `/rs/js/videoplayer.js`.

| Host | Last-Modified (UTC) | Behavior in served code |
| --- | --- | --- |
| renderedsenseless.com | 2026-09-12 21:04:53 | Starts muted; no Enable sound button |
| www.renderedsenseless.com | 2026-09-12 21:57:38 | Recent unmuted-start fix with Enable sound button |

Both responses were Cloudflare cache HITs with `Cache-Control: public, max-age=604800`.
The apex response had an Age around 5,675 seconds. This means the recent fix had
not reliably reached clients. Cloudflare's dashboard showed no active Cache Rules
or Cache Response Rules; the browser-cache setting was four hours, while the
actual asset response advertised seven days.

An instrumented local receiver running the old apex player reproduced the reported
combination: moving video, increasing outgoing microphone packets, and a muted
player for approximately 83 seconds. Clicking the video immediately unmuted it
and incoming decoded audio energy increased. This is a strong explanation for the
symptom, not proof of which script Bird's historical browser loaded.

An exact-URL Cloudflare purge was performed for `/access`, the player module,
receiver main module, and receiver stylesheet on both hostnames. Subsequent HTTP
responses were cache MISSs and both player modules contained the recent fix
(21:57:38). This purge does not clear existing browser-local caches.

## Playback ownership and changes

The runtime path was traced through Lawgiven's AppRoot, LGHostRenderStreamingHandler,
LGVoiceMixer, the RenderStreaming AudioStreamSender/peer negotiation, and the browser
receiver. Unity creates an API-only audio sender per player. LGVoiceMixer sends
game audio plus other players' microphones, excluding the recipient's own mic.
Ingress and output playback are separate paths; a working mic does not prove that
the browser's incoming media element is audible.

The existing VideoPlayer now owns one video-only muted element and one audio-only
element. Both playback requests start under Join without awaiting one another.
The existing Enable sound action handles browser autoplay denial. Track replacement
selects one track of each kind, and disconnect releases both elements without
stopping peer-owned tracks. Old playback promises cannot mute a later session.

A separate native-browser failure was reproduced by withholding the first video
frame for eight seconds: the old combined media element also withheld sound.
The new audio element played at 492 ms while the video remained unready until
about 8.58 seconds. This is an additional improvement; Bird's moving-video report
rules out first-video-frame waiting as the explanation for that specific incident.

Assigning a populated MediaStream on track arrival matters: mutating the initially
empty audio stream left Chromium's audio element at HAVE_NOTHING in a native test.
The player now assigns a fresh stream on first/replacement track arrival.

Stats now distinguishes track/packet arrival, browser mute/pause, playback readiness,
decoded signal, and interval audio buffer delay. Decoded energy is not evidence
of speaker output; a muted browser can receive packets without decoding audio.
Late asynchronous stats from a disconnected session are discarded.

No Unity scripts, prefabs, or mixer settings were changed.

## Validation

Local Unity ran with three authorized access-code identities, generated microphone
tones, and a quiet runtime-only Unity program-audio tone. No real microphones were
captured. RNNoise was disabled in the test harness. The production portal build
was served locally with its versioned receiver files and the existing local
signaling server.

| Built client | Join to audio playing | Result |
| --- | --- | --- |
| Hostbot | 608 ms | Unmuted, packets and nonzero decoded energy |
| Josh | 586 ms | Unmuted, packets and nonzero decoded energy |
| Bird | 527 ms | Unmuted, packets and nonzero decoded energy |
| Bird reconnect, others connected | 528 ms | New track, unmuted, nonzero decoded energy |

- `npm run test:audio`: 12 passing tests, including autoplay denial, stale promise
  rejection, separate media streams, replacement, disconnect, and stats.
- `npm run test:audio:browser`: open the printed loopback URL in Chromium and click
  Run tests. Four native media checks passed, including actual audio playback while
  the video has no frames. This test requires neither Unity nor access codes.
- Portal TypeScript/Vite production build and lint of modified TS/TSX passed.
- All 31 emitted release files matched the mirrored sources byte for byte; the
  emitted app bundle referenced the matching content-derived release URL.
- Receiver lint found one existing unused `localAudioStream` variable in main.js,
  also present in HEAD. Player/stats modules had no lint errors. Diff checks passed.
- Unity's console contained Libretro errors, serialization/animator warnings, and
  early ICE-candidate rejection warnings. The measured sessions nevertheless
  connected promptly. This was not a clean-console claim or a WAN/ICE stress test.

## Release boundary and laptop check

The playback cleanup, diagnostics, and versioned assets were subsequently deployed
by rs-portal commit `9807c67` through the existing GitHub FTPS workflow. Run
`34724439927` completed successfully at 23:05 UTC. Both public hostnames were
verified to serve `/rs/releases/48e3bb193ff6afd6`, the updated audio player and
receiver entrypoint (HTTP 200), and HTML with `no-store, must-revalidate, no-cache`
and Cloudflare status DYNAMIC. Changed unversioned resources and HTML on both
hostnames were purged after deployment.

For future releases, follow rs-portal/DEPLOYMENT.md. The updated GitHub workflow
uploads the complete receiver release before the new page and retains earlier
release directories. It also uploads .htaccess. Purge cached HTML on both hosts
if an existing cache entry prevents the no-cache headers from reaching clients.
Versioning the complete import tree prevents an updated entrypoint from importing
an old cached player/worklet. A query on main.js alone would not do this.

After deployment, test both public hostnames from the other laptop, including a
fresh join and reconnect while another client remains connected. Confirm incoming
game audio and another client's mic begin promptly. If sound is missing, record
the Stats Sound status, packets received, and Decoded audio line before clicking
Enable sound. Real-device autoplay policy, RNNoise, WAN/TURN, and physical speaker
output still need that test; local successful playback does not establish them.
