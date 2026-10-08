import { installRuntimeErrors } from './runtime-errors.js';

// This dependency must evaluate before map/rendering modules: static content
// validation can fail before main.js has created any game subsystems.
let stop = () => {};
export const runtimeErrors = installRuntimeErrors(() => stop());
export function setRuntimeStop(callback) { stop = callback; }
