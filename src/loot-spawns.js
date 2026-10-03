// Authored walkable ground locations. Pairs provide access from both team ends;
// weapon assignments vary per round, but these positions never move.
const locations = {
  courtyard: {
    gun: [[-2, 12], [2, -12], [2, 12], [-2, -12], [-12, 0], [12, 0], [-3, 5], [3, -5]],
    knife: [[-3, 0], [3, 0]],
    frag: [[-6, 12], [6, -12]], smoke: [[-6, -12], [6, 12]], flash: [[-2, 10], [2, -10]],
  },
  'dust-town': {
    gun: [[-3, 15], [3, -15], [3, 15], [-3, -15], [-12, 1], [12, -1], [-2, 6], [2, -6]],
    knife: [[-2, 0], [2, 0]],
    frag: [[-6, 7], [6, -7]], smoke: [[-6, -7], [6, 7]], flash: [[-14, -3], [14, 3]],
  },
  'neon-city': {
    gun: [[-3, 14], [3, -14], [3, 14], [-3, -14], [-11, 0], [11, 0], [-3, -5], [3, 5]],
    knife: [[-3, 0], [3, 0]],
    frag: [[-4, 9], [4, -9]], smoke: [[-4, -9], [4, 9]], flash: [[-18, 5], [18, -5]],
  },
  'snow-base': {
    gun: [[-8, 12], [8, -12], [8, 12], [-8, -12], [-9, 4], [9, -4], [-9, -4], [9, 4]],
    knife: [[-8, 0], [8, 0]],
    frag: [[-4, 8], [4, -8]], smoke: [[-4, -8], [4, 8]], flash: [[-19, 0], [19, 0]],
  },
  'jungle-ruins': {
    gun: [[-6, 15], [6, -15], [6, 15], [-6, -15], [-12, -3], [12, 3], [-4, 6], [4, -6]],
    knife: [[-4, 1], [4, -1]],
    frag: [[-10, 12], [10, -12]], smoke: [[-3, -6], [3, 6]], flash: [[-12, 0], [12, 0]],
  },
  harbor: {
    gun: [[-6, 14], [6, -14], [-12, 14], [12, -14], [-6, -3], [6, 3], [-14, -3], [14, 3]],
    knife: [[-2, 0], [2, 0]],
    frag: [[-2, 10], [2, -10]], smoke: [[-8, 0], [8, 0]], flash: [[-18, -8], [18, 8]],
  },
  'desert-fort': {
    gun: [[-6, 14], [6, -14], [6, 14], [-6, -14], [-12, 5], [12, -5], [-12, -5], [12, 5]],
    knife: [[-2, 0], [2, 0]],
    frag: [[-3, 8], [3, -8]], smoke: [[-3, -8], [3, 8]], flash: [[-17, 4], [17, -4]],
  },
  'space-station': {
    gun: [[-4, 15], [4, -15], [4, 15], [-4, -15], [-12, 4], [12, -4], [-12, -4], [12, 4]],
    knife: [[-5, 0], [5, 0]],
    frag: [[-4, 6], [4, -6]], smoke: [[-4, -6], [4, 6]], flash: [[-19, 11], [19, -11]],
  },
};

export const LOOT_SPAWNS = Object.freeze(Object.fromEntries(Object.entries(locations).map(([mapId, groups]) => [
  mapId,
  Object.freeze(Object.entries(groups).flatMap(([type, points]) => points.map(([x, z], index) => Object.freeze({
    id: `map:${mapId}:${type}:${index + 1}`, x, z,
    kind: ['gun', 'knife'].includes(type) ? type : 'grenade',
    ...(['gun', 'knife'].includes(type) ? {} : { grenadeType: type }),
  })))),
])));
