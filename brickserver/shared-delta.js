// Re-export from shared lib for backward compatibility
const { createDeltaState, applyDiff } = require('../src/lib/delta-core.js');

module.exports = { createDeltaState, applyDiff };