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
config. Opening the link validates the invite and displays that username in a
locked field without entering the green room. Pressing the button exchanges the
invite for a short-lived signaling session and connects straight away.

## The green room

A guest session connects them to the green room, not to the show. The waiting
happens inside the episode rather than outside the signaling server:

- Unity puts every connection whose profile is `guest` into
  `PlayerRuntimeConfig.GreenRoom` on arrival: watching the program feed,
  unembodied, with no client UI and no input.
- The guest's page opens a `green-room` data channel. Unity publishes
  `{type:"state", admitted, username}` on it, and sends the current state as
  soon as the channel opens.
- Until `admitted` is true the page never calls `getUserMedia` for the
  microphone and never attaches a webcam track, so a waiting guest is neither
  heard nor seen. Unity refuses to start a webcam session for an off-air player
  for the same reason, and the episode declines to cast them.
- A cast member presses the guest's button in the green room panel. Unity
  applies `PlayerRuntimeConfig.Normal`, which flips `OnAir` and pushes the new
  state down the channel; the page then opens the devices the guest asked for.

The waiting list is drawn from live guest connections that are still off air, so
a guest who closes the tab leaves it immediately. Admission does not survive the
connection that carried it: a guest who reconnects arrives back in the green
room, on both sides.

This replaced a pending-guest list held by the admission service, which issued
the session only on approval. Two things drove the change: a waiting guest could
neither see nor hear what they were about to walk into, and the list described
people who were connected to nothing, so nothing could keep it honest.

One consequence is worth stating plainly. A valid guest link now buys a
signaling session and a connection to the show without anyone approving it. The
invite key was always the secret, and what approval gates is being seen and
heard rather than being connected - but guest invites should carry `expiresAt`
accordingly.

## Username versus profile

These are intentionally different identities:

- The **username** is the editable session/display name. Unity uses it as the
  `LGPlayerRepository` key, for same-name reconnect preemption, the
  `LGPlayerController.Username`, voice mixer and mic/STT session keys,
  transcript routing, player object/display naming, face-cam presentation, and
  the incoming episode client-character assignment.
- The **profile** comes only from the server-validated pass. Unity uses it to
  choose the host character-sheet template and `PlayerConfig` permissions, and
  to tell a guest from a cast member: the profile `guest`, which the admission
  service stamps on every invite, is what sends a connection to the green room.
  Never configure a cast pass with the profile `guest`.
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
  loopback-only and carries no HTTP routes. It used to expose the green-room
  approval API, which moved into Unity along with the waiting list.

Protecting only the `/access` page is insufficient because a caller could
otherwise connect to signaling directly. The separate authenticated public
path and loopback-only Unity path enforce the access boundary at signaling.
