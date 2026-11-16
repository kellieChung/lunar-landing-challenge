// "Did you know?" cards. Each one says how sure we are (tag) and where it
// comes from. TODO(astronomer): check every card and source before submission.

import { fuelTarget, H2_PER_KG_WATER, O2_PER_KG_WATER } from './chemistry';
import {
  ELECTROLYSIS_KWH_PER_KG_H2, ELECTROLYSIS_MIN_KWH_PER_KG_H2, ICE_WT_PCT_MEAN, ICE_WT_PCT_SIGMA,
  ISP_S, MAX_SLOPE_DEG, MIXTURE_RATIO, RETURN_DELTA_V_MS, ROCKET_DRY_KG, ROVER_PAYLOAD_KG, ROVER_SPEED_KMH,
  SOLAR_TOWER_KW, type Tag,
} from './constants';

export interface Fact {
  id: string;
  title: string;
  text: string;
  tag: Tag;
  source: string;
}

const T = fuelTarget();
const kg = (v: number) => `${Math.round(v)} kg`;

export const FACTS: Record<string, Fact> = {
  welcome: {
    id: 'welcome',
    title: 'Your mission',
    text: `A leak drained your lander's tank, so you're stuck on the Moon. To fly home, it needs ${kg(T.h2Kg)} of hydrogen and ${kg(T.o2Kg)} of oxygen, and you'll make both from ice. The sunlight, the view of Earth and the hills in this game are the real ones for 2027.`,
    tag: 'REAL',
    source: `Rocket equation: fuel = empty mass × (e^(Δv / (Isp × g)) − 1), with Δv ≈ ${RETURN_DELTA_V_MS / 1000} km/s and Isp ≈ ${ISP_S} s. The lander itself is a made-up design, only ${ROCKET_DRY_KG} kg empty, far lighter than a real crewed lander.`,
  },
  dark: {
    id: 'dark',
    title: 'Why look in the dark?',
    text: 'Near the Moon\'s poles the Sun stays very low, so some crater floors never get sunlight. They are among the coldest places in the Solar System, cold enough to keep ice for a very long time, maybe billions of years. The blue spots on your map got zero sunlight in all of 2027 in our own calculation. Scientists\' official maps of "permanently shadowed regions" use many years, so ours is only a first guess.',
    tag: 'REAL',
    source: 'Darkness: this app\'s horizon physics (LOLA elevation + JPL ephemeris, 3 m mast). Published maps: Mazarico et al. 2011, Icarus 211.',
  },
  landed: {
    id: 'landed',
    title: 'Sunlight is your power plant',
    text: `Your solar tower makes up to ${SOLAR_TOWER_KW} kW, but only while the real Sun is above the real hills at its spot. When the Sun hides, the battery keeps the heaters and radio alive. While you stand on your base square, the time bar shows its sunlight in gold (and green when Earth is up too).`,
    tag: 'ESTIMATE',
    source: `${SOLAR_TOWER_KW} kW is the class of NASA's Vertical Solar Array Technology (VSAT) towers. Sunlight comes from this app's physics.`,
  },
  rover: {
    id: 'rover',
    title: 'Slow and careful',
    text: `Your rover drives at ${ROVER_SPEED_KMH} km/h, slower than you walk, and cannot climb slopes steeper than ${MAX_SLOPE_DEG}°. Those are the numbers of NASA's VIPER, a rover built to hunt for ice at the south pole. Routes use the real ground heights, checked every 1 km. Each trip it carries 30 kg of soil, about what small digging robots like NASA's RASSOR are designed for.`,
    tag: 'ESTIMATE',
    source: `NASA VIPER rover specifications (speed, slope). ${ROVER_PAYLOAD_KG} kg per trip is a made-up value; a NASA RASSOR study assumed 20 kg per trip.`,
  },
  comms: {
    id: 'comms',
    title: 'No Earth, no orders',
    text: 'Radio waves travel in straight lines. When a mountain hides Earth from your base, new orders cannot get through. Your rovers keep doing their last job by themselves until Earth rises again.',
    tag: 'REAL',
    source: 'Earth visibility: this app\'s horizon physics. Rovers working alone is a simplification.',
  },
  prospected: {
    id: 'prospected',
    title: 'Is there really ice?',
    text: `Nobody knows yet! No one has ever drilled in these dark spots. In 2009 NASA's LCROSS mission crashed a rocket stage into Cabeus crater and measured about ${ICE_WT_PCT_MEAN}% water (give or take ${ICE_WT_PCT_SIGMA}%) in the dust that flew up. This game gives each dark spot a made-up amount in that range. That is why real missions must prospect first.`,
    tag: 'HYPOTHETICAL',
    source: 'Colaprete et al. 2010, Science 330, 463 (LCROSS). The amount at each spot here is invented.',
  },
  water: {
    id: 'water',
    title: 'Splitting water',
    text: `Water is H₂O: two hydrogen atoms and one oxygen atom. Electricity can pull them apart. Every kilogram of water becomes ${(1000 * H2_PER_KG_WATER).toFixed(0)} g of hydrogen and ${(1000 * O2_PER_KG_WATER).toFixed(0)} g of oxygen. Oxygen atoms are 16 times heavier than hydrogen atoms, so most of the weight is oxygen.`,
    tag: 'REAL',
    source: `Atomic weights (IUPAC). Energy: at least ${ELECTROLYSIS_MIN_KWH_PER_KG_H2} kWh per kg of hydrogen in theory; the game uses ${ELECTROLYSIS_KWH_PER_KG_H2}, typical of real electrolyzers.`,
  },
  sleep: {
    id: 'sleep',
    title: 'Good night, base',
    text: 'The battery ran out during a long dark stretch, so your base went to sleep. It will wake up when the Sun returns and the battery has charged a little. Real Moon robots do this too: some rovers have slept through dozens of two-week lunar nights.',
    tag: 'REAL',
    source: 'Dark stretches: this app\'s physics. Tip: a dirt cover, or a solar tower on a spot that is sunny at other times, helps.',
  },
  shelter: {
    id: 'shelter',
    title: 'Dirt keeps things warm',
    text: 'Moon dirt soaks up heat in the sunshine and gives it back slowly in the dark. Researchers have proposed "thermal wadis": machines parked under heat-holding regolith so they survive the long, freezing lunar night with less power.',
    tag: 'ESTIMATE',
    source: 'Thermal wadi concept (NASA Innovative Advanced Concepts). How much power the game\'s dirt cover saves is a made-up number.',
  },
  oxygen: {
    id: 'oxygen',
    title: 'Oxygen to spare',
    text: `Water splits into 8 kg of oxygen for every 1 kg of hydrogen, but the rocket engine burns only about ${MIXTURE_RATIO} to 1. So you end up with about ${kg(T.spareO2Kg)} of extra oxygen. On a crewed base, that is air to breathe.`,
    tag: 'ESTIMATE',
    source: 'Hydrogen-oxygen upper-stage engines such as the RL10 run hydrogen-rich, near 6 : 1.',
  },
  berm: {
    id: 'berm',
    title: 'Rocket exhaust is a sandblaster',
    text: 'With no air to slow it down, dust kicked up by a rocket flies fast and far. Apollo 12 landed less than 200 m from the old Surveyor 3 probe and its exhaust sandblasted it. That is why researchers want landing pads made from packed Moon dirt, with a dirt wall around them, before landing more hardware near a base.',
    tag: 'ESTIMATE',
    source: 'Apollo 12 / Surveyor 3 (NASA); landing-pad studies by Metzger et al. and NASA. The pad costs in the game are made up.',
  },
  rare: {
    id: 'rare',
    title: 'Why no rare metals?',
    text: 'Some games let you mine rare-earth metals anywhere on the Moon. In reality they are concentrated in a region called the Procellarum KREEP Terrane, on the side of the Moon facing Earth, far from the south pole. The highlands here are mostly a pale rock called anorthosite. It is more than 40% oxygen by weight, locked inside minerals.',
    tag: 'REAL',
    source: 'Jolliff et al. 2000, J. Geophys. Res. 105 (lunar terranes); Lunar Prospector thorium maps.',
  },
};

export const NOT_MODELLED =
  'Left out to keep the game simple: keeping hydrogen cold enough to stay liquid, the temperature of the machines, dust, masts taller than 3 m, and slopes between the 1 km map spots.';
