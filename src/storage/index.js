/**
 * Local Persistence Abstraction
 * Currently using in-memory mock until AsyncStorage/SQLite is fully integrated.
 */

const storage = {
  profile: {
    username: 'Guest',
    points: 0,
  }
};

export const getProfile = async () => {
  return storage.profile;
};

export const updateProfile = async (updates) => {
  storage.profile = { ...storage.profile, ...updates };
  return storage.profile;
};
