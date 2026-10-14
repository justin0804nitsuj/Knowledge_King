module.exports = {
  getDatabase: jest.fn(() => ({})),
  ref: jest.fn((db, path) => ({ db, path })),
  get: jest.fn(async () => ({ exists: () => false, val: () => null })),
  set: jest.fn(async () => {}),
  runTransaction: jest.fn(async (ref, updateFn) => {
    const current = null;
    const next = updateFn ? updateFn(current) : null;
    return { committed: true, snapshot: { val: () => next } };
  }),
  serverTimestamp: jest.fn(() => Date.now()),
  onValue: jest.fn(),
  off: jest.fn()
};
