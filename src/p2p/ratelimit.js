/**
 * Checks if the WebRTC data channel's write buffer is getting congested.
 * Returns true if the buffered amount exceeds 16KB (16384 bytes).
 * 
 * @param {RTCDataChannel} dataChannel - The active WebRTC RTCDataChannel.
 * @returns {boolean} True if write operations should be throttled, false otherwise.
 */
export function shouldThrottle(dataChannel) {
  return dataChannel && dataChannel.bufferedAmount > 16384;
}

/**
 * Returns a Promise that resolves after a specified backpressure delay (default 50ms).
 * Used to wait for the WebRTC data channel buffer to drain before resuming writes.
 * 
 * @param {RTCDataChannel} dataChannel - The WebRTC data channel (reference for potential future event callbacks).
 * @param {number} [ms=50] - Number of milliseconds to delay.
 * @returns {Promise<void>} Resolves after ms.
 */
export function waitForDrain(dataChannel, ms = 50) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
