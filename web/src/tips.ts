// The guided tooltips (team-written text), shared by the Explore tour and the
// Moon Base tutorial. Edited only where needed to stay accurate; see the notes.

export const TIPS = {
  /** Explore step 1, game step 1. */
  power: 'Lunar spacecraft like this one have solar panels to collect energy and function. We also need to be able to contact the lander for as long as possible. So choosing a landing spot where the Sun and Earth aren\'t blocked for too long is important!',
  /**
   * Explore step 2, game step 2. The grid's colors show sunlight only (not
   * Earth), so the text says so; Earth time is in each square's readout.
   */
  grid: 'To choose a landing spot, click one of the colored squares in the region grid. Lighter colors mean more sunlight over the year, and darker colors mean less. Point at a square to see how often Earth is in view too.',
  /**
   * Explore step 3, game (first Earthset). Libration has two causes: the
   * orbit's shape (east-west) and the Moon's tilt (north-south, the one that
   * matters most at the pole); and at the pole Earth does go below the hills.
   */
  earth: 'The Moon always keeps the same side facing Earth, so Earth doesn\'t rise and set in the Moon\'s sky the way the Sun does on Earth. Instead, Earth stays almost in the same place and wobbles a little, because the Moon\'s orbit is not a perfect circle and the Moon is slightly tilted. Near the south pole Earth sits low on the horizon, so this small wobble and the hills can still hide it for days.',
  /** Explore step 4, game step 3. */
  timeline: 'The bar below shows when the Sun and Earth are visible from where you are standing. The Sun can be hidden by the time of the Moon\'s day (one lunar day lasts about 29.5 Earth days) or by a hill in the way, and Earth can be hidden by hills. Plan your time wisely!',
  /** Game: finding ice. Hydrogen and oxygen burn together as rocket fuel. */
  ice: 'Water ice is one of the most valuable resources on the Moon. It can only last in very cold, dark places, like craters the Sun never reaches. You can split it into oxygen, which humans need to breathe, and hydrogen. Burned together, hydrogen and oxygen fuel rockets.',
  /** Game: first dry regolith. Metals are locked inside minerals; using them is future technology. */
  regolith: 'Lunar regolith is the Moon\'s version of dirt. It contains minerals with metals like iron and aluminum that could one day be used to build machinery. Here, the dry dirt left after baking out the ice builds landing pads and a shelter for the base.',
  /** Game: rover battery meter. Rovers here only leave with enough charge for the round trip. */
  battery: 'Machines on the Moon use solar panels to charge their batteries, so they can keep working when the Sun is hidden. But if a rover ran out of battery while exploring a dark crater, it would be stranded. This meter shows how much charge each rover has. A rover only leaves once it has enough for the whole round trip.',
} as const;

export type TipId = keyof typeof TIPS;

/**
 * Short versions for the in-game tooltips and the Explore tour: one or two
 * short sentences each. The full texts above stay in the game's "Moon facts".
 */
export const SHORT = {
  power: 'Solar panels need the Sun, and we need Earth to talk to the lander. Pick a spot where neither stays hidden too long!',
  grid: 'Click a square to choose a spot. Lighter squares get more sunlight.',
  earth: 'Earth barely moves in the Moon\'s sky. Near the south pole it sits low, so hills can hide it for days.',
  timeline: 'This bar shows when the Sun (gold) and Earth (blue) can be seen from here. Green means both!',
  ice: 'Ice hides in dark craters the Sun never reaches. We can split it into oxygen and hydrogen: rocket fuel!',
  regolith: 'Regolith is Moon dirt. Our leftover dry dirt builds landing pads and a shelter.',
  battery: 'Rovers run on batteries. They only leave with enough charge to get back home.',
  earthLink: 'People on Earth drive our rovers by radio. When a hill blocks Earth, the rovers must stop and wait.',
  sunOnly: 'Sun but no Earth: the rovers wait, but sunshine powers the fuel plant.',
  forecast: 'These boxes are the sky forecast for your base. Green (Sun + Earth) is the best time to dig.',
} as const;

/** Tips for the look-and-decide game (round 4). */
export const SHORT_GAME = {
  look: 'Look around! Are hills hiding the Sun? Is Earth in view? The timeline below shows the whole year: green is best.',
  crater: 'Floors that never or barely see the Sun keep their ice. Closer craters mean shorter trips.',
  dirt: 'Leftover dry dirt can be built into a landing pad or a shelter.',
  pad: 'Landing pad ready. Earth can land a crate near the base without sandblasting it.',
  shelter: 'Moon dirt holds heat. Under a dirt shelter, the base needs less power at night.',
} as const;
