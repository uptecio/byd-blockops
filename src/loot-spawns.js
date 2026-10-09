// Authored walkable ground locations. Guns cover both ends, outer flanks and
// central approaches with >=12.5 units between them. Rotated pairs balance
// access from both team ends; assignments vary, but positions never move.
const locations = {
  courtyard: {
    gun: [[-10, 18], [10, -18], [10, 18], [-10, -18], [-18, -4], [18, 4], [-2, 6], [2, -6]],
    knife: [[-3, 0], [3, 0]],
    frag: [[-6, 12], [6, -12]], smoke: [[-6, -12], [6, 12]], flash: [[-2, 10], [2, -10]],
    health: [[-5, 17], [5, -17]], armour: [[5, 17], [-5, -17]],
  },
  'dust-town': {
    gun: [[-10, 18], [10, -18], [10, 18], [-10, -18], [-18, -4], [18, 4], [-2, 6], [2, -6]],
    knife: [[-2, 0], [2, 0]],
    frag: [[-4.5, 7], [4.5, -7]], smoke: [[-6, -7], [6, 7]], flash: [[-14, -3], [14, 3]],
    health: [[-5, 17], [5, -17]], armour: [[5, 17], [-5, -17]],
  },
  'neon-city': {
    gun: [[-10, 18], [10, -18], [10, 18], [-10, -18], [-18, -4], [18, 4], [-2, 6], [2, -6]],
    knife: [[-3, 0], [3, 0]],
    frag: [[-4, 9], [4, -9]], smoke: [[-4, -9], [4, 9]], flash: [[-18, 5], [18, -5]],
    health: [[-5, 17], [5, -17]], armour: [[5, 17], [-5, -17]],
  },
  'snow-base': {
    gun: [[-10, 18], [10, -18], [10, 18], [-10, -18], [-20, -4], [20, 4], [-2, 8], [2, -8]],
    knife: [[-9.5, 0], [9.5, 0]],
    frag: [[-4, 8], [4, -8]], smoke: [[-4, -8], [4, 8]], flash: [[-20.5, 0], [20.5, 0]],
    health: [[-5, 17], [5, -17]], armour: [[5, 17], [-5, -17]],
  },
  'jungle-ruins': {
    gun: [[-10, 18], [10, -18], [10, 18], [-10, -18], [-18, -4], [18, 4], [-2, 6], [2, -6]],
    knife: [[-4, 1], [4, -1]],
    frag: [[-10, 12], [10, -12]], smoke: [[-3, -6], [3, 6]], flash: [[-13, 0], [13, 0]],
    health: [[-5, 17], [5, -17]], armour: [[5, 17], [-5, -17]],
  },
  harbor: {
    gun: [[-10, 18], [10, -18], [10, 18], [-10, -18], [-18, -4], [18, 4], [-2, 6], [2, -6]],
    knife: [[-2, 0], [2, 0]],
    frag: [[-2, 10], [2, -10]], smoke: [[-8, 0], [8, 0]], flash: [[-18, -8], [18, 8]],
    health: [[-5, 17], [5, -17]], armour: [[5, 17], [-5, -17]],
  },
  'desert-fort': {
    gun: [[-10, 18], [10, -18], [10, 18], [-10, -18], [-18, -4], [18, 4], [-2, 6], [2, -6]],
    knife: [[-2, 0], [2, 0]],
    frag: [[-3, 8], [3, -8]], smoke: [[-3, -8], [3, 8]], flash: [[-17, 4], [17, -4]],
    health: [[-5, 17], [5, -17]], armour: [[5, 17], [-5, -17]],
  },
  'space-station': {
    gun: [[-10, 18], [10, -18], [10, 18], [-10, -18], [-18, -2], [18, 4], [-2, 6], [2, -6]],
    knife: [[-5, 0], [5, 0]],
    frag: [[-4, 6], [4, -6]], smoke: [[-4, -6], [4, 6]], flash: [[-19, 11], [19, -11]],
    health: [[-3.5, 17], [3.5, -17]], armour: [[3.5, 17], [-3.5, -17]],
  },
};

export const LOOT_SPAWNS = Object.freeze(Object.fromEntries(Object.entries(locations).map(([mapId, groups]) => [
  mapId,
  Object.freeze(Object.entries(groups).flatMap(([type, points]) => points.map(([x, z], index) => Object.freeze({
    id: `map:${mapId}:${type}:${index + 1}`, x, z,
    kind: ['gun', 'knife'].includes(type) ? type : ['health', 'armour'].includes(type) ? 'supply' : 'grenade',
    ...(['gun', 'knife'].includes(type) ? {} : ['health', 'armour'].includes(type) ? { supplyType: type } : { grenadeType: type }),
  })))),
])));
