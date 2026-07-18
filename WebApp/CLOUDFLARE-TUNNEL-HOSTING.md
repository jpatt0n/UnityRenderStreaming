# Rendered Senseless public RenderStreaming host

`https://stream.renderedsenseless.com` is a stable Cloudflare Tunnel hostname.
The active machine runs both Unity and this WebApp on port `55055`; Cloudflare
forwards the public hostname to `http://localhost:55055` on that machine.

The tunnel is named `rendered-senseless-signaling`. Its credential is installed
in the Windows `Cloudflared` service on both the local workstation and the
Azure VM. Do not put the tunnel token in this repository.

## Important: only one active host

The signaling server keeps session state in memory. Never run the
`Cloudflared` service on the local workstation and Azure at the same time.
Multiple active connectors would make Cloudflare distribute requests between
two unrelated signaling servers and split Unity/browser peers.

Both Windows services use `Manual` startup to make host ownership explicit.

## Start hosting on a machine

1. Stop the `Cloudflared` service on the other machine.
2. Start Unity on the intended host.
3. In this directory, run `run.bat` and approve its Windows elevation prompt.
   The launcher builds the WebApp, waits for port `55055`, and starts
   `Cloudflared` automatically.
4. Verify:

   ```powershell
   Invoke-RestMethod https://stream.renderedsenseless.com/config
   ```

   The result should report `useWebSocket` as `true`.

## Stop or switch hosts

Close the `run.bat` host window or press Ctrl+C. The launcher stops both the
WebApp and `Cloudflared`. A separate watchdog also stops `Cloudflared` if the
WebApp process crashes or its port disappears.

After Cloudflare shows the tunnel as disconnected, start the WebApp and
connector on the other machine by running its `run.bat`. No portal, Unity
signaling URL, or public DNS change is required.

## Current endpoints

- Portal: `https://renderedsenseless.com/access`
- Public signaling: `https://stream.renderedsenseless.com`
- Host-local Unity/WebApp signaling: `ws://localhost:55055`
- Tunnel origin: `http://localhost:55055`

## Cutover-only local DNS override

During the 2026-07-18 nameserver cutover, the local router retained the former
Azure address. A temporary Windows NRPT rule was added for
`stream.renderedsenseless.com` so this workstation could test against
Cloudflare immediately. Remove it after the former four-hour DNS TTL has
expired:

```powershell
Get-DnsClientNrptRule |
  Where-Object Comment -eq "Rendered Senseless Cloudflare cutover" |
  Remove-DnsClientNrptRule -Force
Clear-DnsClientCache
```
