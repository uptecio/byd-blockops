// Keep the observing peer alive until the owned app has left its room.
// Cleanup errors must not replace the failure that brought us here.
export async function cleanupOwnedOnlineSession({ stopApp, verifyDeparture, closePeers, closeCdp, removeForward, originalError, onCleanupError = error => console.warn(error.message) }) {
  const failures = [];
  for (const operation of [stopApp, verifyDeparture, closePeers, closeCdp, removeForward]) {
    try { await operation?.(); }
    catch (error) { failures.push(error); }
  }
  if (failures.length && !originalError) throw new AggregateError(failures, 'Native online cleanup failed');
  for (const error of failures) onCleanupError(error);
}
