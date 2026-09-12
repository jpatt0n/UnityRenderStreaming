/**
 * create display string array from RTCStatsReport
 * @param {RTCStatsReport} report - current RTCStatsReport
 * @param {RTCStatsReport} lastReport - latest RTCStatsReport
 * @param {HTMLAudioElement} audioElement - current incoming audio player, if available
 * @return {Array<string>} - display string Array
 */
export function createDisplayStringArray(report, lastReport, audioElement) {
  let array = new Array();

  if (audioElement) {
    const track = audioElement.srcObject?.getAudioTracks()[0];
    const inbound = Array.from(report.values()).find(stat =>
      stat.type === 'inbound-rtp' && stat.kind === 'audio' &&
      (stat.trackIdentifier == null || stat.trackIdentifier === track?.id));
    const playback = !track ? 'waiting for audio track'
      : track.readyState === 'ended' ? 'audio track ended'
      : !inbound?.packetsReceived ? 'waiting for audio packets'
      : audioElement.muted ? 'blocked — click Enable sound'
      : audioElement.paused ? 'paused — click Enable sound'
      : audioElement.readyState < 2 ? 'waiting for playback data'
      : 'playing';
    array.push(`Sound: ${playback}`);
  }

  report.forEach(stat => {
    if (stat.type === 'inbound-rtp') {
      array.push(`${stat.kind} receiving stream stats`);

      if (stat.kind === 'audio') {
        array.push(`Packets received: ${stat.packetsReceived ?? 0}; lost: ${stat.packetsLost ?? 0}`);
        const previous = lastReport?.get(stat.id);
        if (previous && stat.totalAudioEnergy != null && previous.totalAudioEnergy != null) {
          const signal = stat.packetsReceived === previous.packetsReceived ? 'no new packets'
            : stat.totalAudioEnergy > previous.totalAudioEnergy ? 'signal present' : 'silence';
          array.push(`Decoded audio: ${signal}`);
        }
        const emitted = stat.jitterBufferEmittedCount - (previous?.jitterBufferEmittedCount ?? 0);
        const delay = stat.jitterBufferDelay - (previous?.jitterBufferDelay ?? 0);
        if (emitted > 0) array.push(`Audio buffer delay: ${(1000 * delay / emitted).toFixed(0)} ms`);
      }

      if (stat.codecId != undefined) {
        const codec = report.get(stat.codecId);
        array.push(`Codec: ${codec.mimeType}`);

        if (codec.sdpFmtpLine) {
          codec.sdpFmtpLine.split(";").forEach(fmtp => {
            array.push(` - ${fmtp}`);
          });
        }

        if (codec.payloadType) {
          array.push(` - payloadType=${codec.payloadType}`);
        }

        if (codec.clockRate) {
          array.push(` - clockRate=${codec.clockRate}`);
        }

        if (codec.channels) {
          array.push(` - channels=${codec.channels}`);
        }
      }

      if (stat.kind == "video") {
        array.push(`Decoder: ${stat.decoderImplementation}`);
        array.push(`Resolution: ${stat.frameWidth}x${stat.frameHeight}`);
        array.push(`Framerate: ${stat.framesPerSecond}`);
      }

      if (lastReport && lastReport.has(stat.id)) {
        const lastStats = lastReport.get(stat.id);
        const duration = (stat.timestamp - lastStats.timestamp) / 1000;
        const bitrate = (8 * (stat.bytesReceived - lastStats.bytesReceived) / duration) / 1000;
        array.push(`Bitrate: ${bitrate.toFixed(2)} kbit/sec`);
      }
    } else if (stat.type === 'outbound-rtp') {
      array.push(`${stat.kind} sending stream stats`);

      if (stat.codecId != undefined) {
        const codec = report.get(stat.codecId);
        array.push(`Codec: ${codec.mimeType}`);

        if (codec.sdpFmtpLine) {
          codec.sdpFmtpLine.split(";").forEach(fmtp => {
            array.push(` - ${fmtp}`);
          });
        }

        if (codec.payloadType) {
          array.push(` - payloadType=${codec.payloadType}`);
        }

        if (codec.clockRate) {
          array.push(` - clockRate=${codec.clockRate}`);
        }

        if (codec.channels) {
          array.push(` - channels=${codec.channels}`);
        }
      }

      if (stat.kind == "video") {
        array.push(`Encoder: ${stat.encoderImplementation}`);
        array.push(`Resolution: ${stat.frameWidth}x${stat.frameHeight}`);
        array.push(`Framerate: ${stat.framesPerSecond}`);
      }

      if (lastReport && lastReport.has(stat.id)) {
        const lastStats = lastReport.get(stat.id);
        const duration = (stat.timestamp - lastStats.timestamp) / 1000;
        const bitrate = (8 * (stat.bytesSent - lastStats.bytesSent) / duration) / 1000;
        array.push(`Bitrate: ${bitrate.toFixed(2)} kbit/sec`);
      }
    }
  });

  return array;
}
