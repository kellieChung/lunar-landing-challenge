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
  regolith: 'Lunar regolith is the Moon\'s version of dirt. It contains minerals with metals like iron and aluminum that could one day be used to build machinery. Here, the dry dirt left after baking out the ice builds landing pads and upgrades for the base: a dirt cover, packed roads and an insulated oven.',
  /** Game: rover battery meter. Rovers here only leave with enough charge for the round trip. */
  battery: 'Machines on the Moon use solar panels to charge their batteries, so they can keep working when the Sun is hidden. But if a rover ran out of battery while exploring a dark crater, it would be stranded. This meter shows how much charge each rover has. A rover only leaves once it has enough for the whole round trip.',
} as const;

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
  regolith: 'Regolith is Moon dirt. Our leftover dry dirt builds landing pads and base upgrades.',
  battery: 'Rovers run on batteries. They only leave with enough charge to get back home.',
  earthLink: 'People on Earth drive our rovers by radio. When a hill blocks Earth, the rovers must stop and wait.',
  sunOnly: 'Sun but no Earth: the rovers wait, but sunshine powers the fuel plant.',
  forecast: 'These boxes are the sky forecast for your base. Green (Sun + Earth) is the best time to dig.',
} as const;

/** Tips for the look-and-decide game (round 4). */
export const SHORT_GAME = {
  look: 'Look around! Are hills hiding the Sun? Is Earth in view? Is the ice close? The timeline below shows the whole year, and green is best.',
  crater: 'Floors that never see the Sun keep the most ice. The more Sun a floor gets, the less ice it keeps. Closer craters mean shorter trips.',
  dirt: 'The leftover dry dirt piles up by the plant (see Dirt in the dock). Spend it on a landing pad or an upgrade with Build whenever you like.',
  pad: 'Landing pad ready. Earth can now land a crate near the base without sandblasting it.',
  shelter: 'Dirt cover done. Moon dirt holds heat, so the base needs less power at night.',
  roads: 'Roads packed. The rovers roll faster and spend less charge on each trip.',
  oven: 'Oven wrapped in dirt. Baking ice out now takes less power.',
} as const;

/** The story: a leaking tank forces an emergency landing; ice makes the fuel home. */
export const STORY = {
  crash: [
    'Mayday, mayday! Your fuel tank is leaking. There is not enough left to fly home!',
    'Put it down now, astronaut! Brace for landing!',
    'Once you\'re down, we\'ll dig ice out of a dark crater and turn it into rocket fuel. Fill the tank and you\'re going home.',
  ],
  landed: 'Phew, you made it! There\'s just enough fuel for one short hop, so let\'s choose a spot for the base. There are three nearby.',
  resume: (day: number, site: string) => `Welcome back, astronaut. It\'s day ${day} at ${site}, and the tank still needs fuel to get you home.`,
} as const;

/**
 * The Moon Base tutorial (first run only; game/ui/coach.ts). It says what to
 * look for, never which option is best: the reveal is where the data decides.
 * The four landing things are the four rows of the landing reveal.
 */
export const TUTORIAL = {
  /** Astrofrog, before the first landing choice. */
  intro: [
    'So what makes a good base spot? There are four things to check.',
    'One: sunlight. The fuel plant runs on it, so more Sun means fuel sooner.',
    'Two: Earth. We drive the rovers by radio from down here, so they can only move while Earth is in view.',
    'Three: short nights. When the Sun is hidden, the base runs on its battery, and a long night can drain it and put the base to sleep.',
    'Four: nearby ice. The rovers haul icy dirt from a dark crater, and a shorter drive means more trips.',
    'No spot wins at everything. Visit all three, weigh them up, then choose. I\'ll point out what to look at along the way.',
  ],
  firstLook: 'Start here. "Go look" takes you to a spot so you can see its sky for yourself. You can visit every spot before choosing.',
  compass: 'This strip shows which way you\'re facing, with markers for the Sun and Earth. Drag the view to turn toward them. If a ridge sits right under the Sun, this spot goes dark whenever the Sun dips.',
  timeline: 'This bar shows the whole year at this spot. Gold means the Sun is up, blue means Earth is in view, and green means both. Long stretches without gold are long nights.',
  map: 'The map shows where you are and the ice craters nearby. The closer the ice, the shorter each rover trip.',
  compare: 'Now visit the other spots and compare their skies and timelines. When you\'re ready, land on the one you think is best.',
  revealRows: 'Here are the real numbers behind what you just saw. A tick marks the winner of each row, and often no spot wins them all.',
  revealProj: 'This is the row that counts. The game replayed the run from each spot under the real 2027 sky to see which one fills your tank first.',
  revealWhy: 'Here\'s what left your spot in the dark at its worst moment. The view has turned to show it.',
  crater: 'Now pick where to dig. A floor the Sun never reaches is a cold trap, and it holds the most ice. The more Sun a floor gets, the less ice it keeps, so each load brings home less water. Still, a close sunlit floor can win on drive time.',
  craterTimeline: 'At a crater, the timeline shows its floor. Gold means Sun on the floor, and the more gold, the less ice.',
  craterMap: 'The dashed gold line on the map is the rovers\' route. A longer route means fewer loads before the deadline, so weigh dark against close.',
  craterReveal: 'The most ice sits on floors that got 0% Sun all year. That\'s the cold-trap rule: more Sun, less ice. Ice and drive time together decide the launch day.',
  done: 'That\'s the end of the tutorial. From here on, every choice is yours. You can replay it anytime from Menu → Guide & facts.',
} as const;

/** The menu's "Picking a good spot" checklist (How to play). */
export const SPOT_CHECKLIST = [
  'Sun: the timeline has lots of gold. Sunlight makes the fuel.',
  'Earth: lots of blue. Rovers only drive while Earth is in view.',
  'Short nights: no long gaps without gold, so the battery lasts.',
  'Ice close by: a short drive to a crater means more trips.',
  'Crater: a floor with no gold at all on its timeline has rich ice.',
] as const;
