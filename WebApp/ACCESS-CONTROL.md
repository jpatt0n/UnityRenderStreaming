# Rendered Senseless access control

## Local configuration

The signaling host reads `access.local.json` from this directory by default.
That file and `access-links.local.txt` are gitignored because they contain the
real link keys. `access.example.json` documents the editable shape, and
`create-access-config.ps1` creates initial Hostbot, Josh, Bird, Angelhair, and
Zerbz passes.

Cast links use `#cast=<key>`. The fragment keeps the long-lived key out of
ordinary HTTP request logs. The browser exchanges it for a short-lived
signaling session. Cast passes define:

- `defaultUsername`: the name prefilled in the browser.
- `profile`: the stable authorization/persona profile.
- `allowUsernameOverride`: whether the cast member can change the session name
  for testing.

Guest links use `#guest=<key>`. A guest invite supplies its username in the
config. The guest enters the green room, waits for approval, and receives a
short-lived signaling session only after a cast member presses their green
approval button.

## Username versus profile

These are intentionally different identities:

- The **username** is the editable session/display name. Unity uses it as the
  `LGPlayerRepository` key, for same-name reconnect preemption, the
  `LGPlayerController.Username`, voice mixer and mic/STT session keys,
  transcript routing, player object/display naming, face-cam presentation, and
  the incoming episode client-character assignment.
- The **profile** comes only from the server-validated pass. Unity uses it to
  choose the host character-sheet template and `PlayerConfig` permissions.
  Changing the username never changes the permission profile.

For example, Josh can join with the display name `bird` to test Bird's episode
client-character assignment while retaining Josh's permissions. A guest cannot
rename themselves into a cast profile.

The authenticated connection id is `username~profile~nonce`. The public
signaling server validates that it matches the short-lived admission session
before forwarding the offer to Unity. Unity parses the username and profile
separately in `LGHostRenderStreamingHandler`.

## Signaling boundaries

- Public browser HTTP/WebSocket signaling: port `55055`; browser WebSockets
  require an admission session.
- Unity host HTTP/WebSocket signaling: `127.0.0.1:55056`; this listener is
  loopback-only and also exposes the green-room approval API.

Protecting only the `/access` page is insufficient because a caller could
otherwise connect to signaling directly. The separate authenticated public
path and loopback-only Unity path enforce the access boundary at signaling.
