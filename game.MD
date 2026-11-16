# Moon Base: game design

Audience: elementary and middle schoolers (ages ~9–13). The game is built on the app's real 2027 sky, the LOLA horizon masks and the 9 curated south-pole sites. Every number about the Moon comes from the Navigator's physics (`web/src/physics/`, `sites.json`); every other number lives in `web/src/game/constants.ts` with its source. Design values (marked `TUNE` there) are never changed to make the game easier by bending a sourced number.

---

## 1. Direction

**Story:** your lander's fuel tank is leaking, so there isn't enough left to fly home. You crash-land near the south pole, and the only way back is to make rocket fuel from Moon ice.

**Ice is the reason to be there.** Water ice survives only on crater floors the Sun never or barely reaches. Those same dark places have no sunlight for power and often no view of Earth. Every run is the tension between *where the ice is* and *where you can live*.

Short, separate runs. Each run is a fresh draw: the start date, the 3 landing spots, the 3 craters. You make a handful of choices by **looking** at the real sky and terrain, then watch them play out. The pull to replay is a fast restart, the **near-miss reveal** ("your spot launches on day 34; the east-rim spot would have made it by day 26"), a patch for every completed site, and site unlocks. There are no streaks or loot.

---

## 2. Core loop

```
Pick site → brief → crash landing
  → LOOK & compare 3 landing spots → land → REVEAL (+ ridge flash)
  → time runs (1 or 3 days/s; slows for sunsets and Earthsets)
  → LOOK & compare 3 craters → REVEAL (cold-trap rule)
  → rovers dig icy dirt, the plant makes H₂ + O₂ on sunlight, dry dirt piles up
  → build: landing pads (Earth sends a rover / solar tower / battery pack) and base upgrades
  → Prepare beat before each long night
  → tank full → go for launch → liftoff → REPORT → Another mission
```

Three layers, in order: **look and decide** (the skill), **watch it play out** (the consequence), **grow the base** (the reward).

---

## 3. Run structure

| Phase | What happens |
| --- | --- |
| Site | Pick a site on the globe. Each card shows the site's patch if completed, the lock, or why the site has no ice run. |
| Brief | The goal and the deadline, **How to play**, optional **Make it harder** modifiers, then **Start mission**. A saved run offers **Continue (day N)** or **Start a new run instead**. |
| Crash | The leaking lander comes down in 3D while mission control talks. The first time ever, Astrofrog introduces itself. |
| Land | 3 landing spots. Each card shows only a name and a ground label (flat / rough / steep). **Go look** at each one in 3D and on the year timeline, then **Land here**. |
| Reveal 1 | The REAL metrics for all three (% sunlit, % Earth, longest night, drive to ice), each one's projected launch day, a tick on the winner of each row, and the **ridge flash**. |
| Craters | 3 craters, each labelled with its distance and how much of 2027 its floor was sunlit. Go look at the floor, the route and Earth along the way, then **Dig here**. |
| Reveal 2 | Floor sunlit % (REAL), ice tier (RULE), ice in the dirt (MADE UP), projected launch day. |
| Running | Rovers haul by themselves; the dock says why they wait. |
| Builds | When dry dirt pays for something, the clock pauses for the choice; **Build** in the dock works any time. |
| Prepare | ~24 h before a dark stretch of 48 h or more at the base, mission control warns about the coming night. |
| Launch | Mission control calls out 50% and 75% with an ETA, banners mark 90% and 99%, then **Go for launch**, countdown and liftoff in 3D. |
| Report | The result, Sky Sense, the near-miss line, unlocks, then **Another mission**, **Same start again** or **Moon map**. |

**Deadline:** 3 Sun circuits from landing (2,124 h, 89 days). If it passes, the run ends with a report that shows the biggest drag and offers the same start again.

**Run variation (all from real data):**
- Site: 8 of the 9 sites host ice runs. A site hosts runs only if some start can launch in time (checked by `par.test.ts`, which also orders the unlocks). Malapert Massif has no floor dark enough nearby; the game and the site card say so, from the real sunlight.
- Start: seeded, at the midnight before a sunrise or sunset at the site center, early enough in 2027 that the deadline fits.
- The 3 landing spots and the 3 craters are drawn from the 11 × 11 grid (§5).
- **Daily mission:** the site and seed come from the date, so everyone gets the same run that day. There is no server and no penalty for skipping.

**Soft failure.** An empty battery puts the base to sleep: rovers park and the plant stops. It wakes again at 10% charge. Nothing ends a run early except the deadline.

---

## 4. The choices in a run

| # | Choice | Compare by looking at | Revealed after |
| --- | --- | --- | --- |
| 1 | Site | The globe | — |
| 2 | Landing spot | Skyline, year timeline, Sun path | % sunlit, % Earth, longest night, drive to ice (REAL); projected launch day for each (ESTIMATE) |
| 3 | Crater | Crater floor in 3D, the floor's year timeline, the route on the map | Floor sunlit % (REAL), ice tier (RULE), ice amount (MADE UP), projected launch day |
| 4+ | Pad delivery: rover / solar tower / battery pack | Cards: what each fixes (hauling speed / power in the base's dark / power through the night) | — |
| 4a | Tower spot (for a tower) | 3 spots within cable reach; the timeline shows when each is lit | Projected launch day for each |
| 5 | Upgrades: dirt cover, packed roads, dirt-lined oven | Cost vs effect cards | — |

Choices 2, 3 and 4a are real look-and-compare moments; the rest are quick cards.

---

## 5. How the options are drawn (no dominant answer)

**Landing spots:** cells with some sun and at least one icy crater in rover range, offered as three roles: the sunniest spot, the spot with the most Earth, and the spot closest to ice. If one option beats both others on every REAL metric, the dominated role is swapped for the next candidate (`playthrough.test.ts` checks this on the shipped data). The **projection** decides which spot is best, not a formula.

**Craters:** cells whose floor holds ice by the tier rule (§6) within rover range of the base: the darkest floor, a floor that sees a little Sun (a closer one if there is one), and a third whose sunlight differs most from both, so the three span the range. With fewer than 3, the game offers what exists.

**Tower spots:** the cells within cable reach (2 km) that are lit the most while the base is dark.

**Sky Sense** scores each look-and-compare by the rank of your pick's projected launch day: 1st = 100, 2nd = 70, 3rd = 20. Outcomes within 2 days share a rank, and "missed" ranks last. After each choice an autopilot (`game/autopilot.ts`) replays the run from that hour for every option on the real sky.

---

## 6. The base economy

### The ice chain

```
Cold trap (floor never or barely sunlit) → rovers dig icy dirt → haul home → the oven bakes out the water
→ water splits into H₂ + O₂ (needs power) → rocket fuel → launch
                     └→ leftover dry dirt = building material
```

### The cold-trap rule (the one science idea to take away)

| Floor sunlit over 2027 (mean share of the Sun's disk) | Ice tier | Ice in the dirt |
| --- | --- | --- |
| 0% (no part of the Sun in any hour) | **Rich** | 2.7–8.5% by mass (inside the LCROSS range, fixed per cell) |
| above 0% up to 15% (`TUNE`) | **Sunlit** | the cell's value, shrinking linearly to a quarter of it at 15% |
| above 15% | **None** | the ice has sublimated away |

"Floor sunlit %" is **REAL**: the horizon mask plus hourly Sun positions at that cell. The tiers are a **game rule** that follows the cold-trap idea. The amounts are **made up** (there is no ice map in the app), and the reveal says so. It is a one-year test of our own, not the official multi-year maps of permanently shadowed regions.

**Rovers (automatic):** they scout, then haul. They only drive while the base sees Earth (people drive them by radio) and only leave with enough charge for the round trip. The dock shows why they wait.

**The plant needs power.** Baking and splitting run on sunlight left over after the base's keep-alive power, so a long night makes fuel slowly. The landing spot matters twice: a sunny spot makes fuel, and the crater supplies ice.

**Fuel target:** 19 kg H₂ + 114 kg O₂ from the rocket equation (ESTIMATE inputs), which takes ~170 kg of water (REAL chemistry: water is 11% hydrogen by mass).

**Builds (paid in dry dirt):**

| Build | Cost | Effect |
| --- | --- | --- |
| Landing pad | 150, 250, 350 … kg | Earth lands one delivery on it: **rover**, **solar tower** (you choose the spot) or **battery pack** (+48 kWh) |
| Dirt cover | 250 kg | Halves the base's keep-alive power |
| Packed roads | 300 kg | Rovers drive 1.5× faster |
| Dirt-lined oven | 350 kg | Baking the ice out takes 25% less energy |

**Power:** each solar tower makes power by how much of the Sun's disk is up at its cell that hour (REAL), 10 kW in full sun (ESTIMATE, NASA VSAT class). Two towers at cells with different shadows cover each other's nights. That's the lesson.

All values and their sources: `docs/METHODS.md`, "Moon Base mode".

---

## 7. UI

**The 3D view is the star.** Choices take the whole screen; otherwise the instruments sit at the edges:
- **Top:** a compass strip with Sun and Earth markers (arrows when they're off-screen), the **Explore** button (leave the game at any time) and the spot map.
- **Bottom dock:** Menu, fuel, dry dirt and **Build**, power and Earth contact, the day of the run, Play / Pause and the speed (1 or 3 days/s).
- **Timeline:** the whole year with the current month below it; gold = Sun, blue = Earth, green = both.
- **Mission control (Astrofrog)** speaks in a bubble and waits for **Next** (click, Space or Enter). Every line is kept in the menu's Radio log.
- **Menu:** how to play, the Radio log, Moon facts, "What's real" (every number's tag), credits and a sound toggle.
- **First run:** a short tutorial points at what to look at, never at which option is best. It can be skipped.

**Visual language:** the Sprout Lands packs by Cup Nooble, recoloured to space grey with blue and purple accents. The pixel font is used for titles and names, and a plain sans for dialogue and explanations. Glyphs are sprites, with short words as a fallback when the packs aren't installed. Big moments near launch get a banner and pixel confetti; otherwise feedback stays in place (meters fill, the mascot's mood changes).

**Tags:** REAL / ESTIMATE / RULE / MADE UP as small labels next to numbers. Tapping one explains it in one sentence.

**Accessibility:** Space pauses at any time, there is no twitch input, every state has a glyph and a word (never colour alone), and motion is reduced under `prefers-reduced-motion`.

---

## 8. Progression

**Winning:** fill the tank and launch before the deadline. That completes the site and keeps the earliest launch day. Sky Sense is shown on the report as feedback only.

**Near-miss line (always shown):** the single biggest gap between your choice and the best option's projection, with real numbers.

**Between runs** (`localStorage` only, no names or accounts):
1. **Patches:** a gold chest for each completed site.
2. **Unlocks:** the 3 most forgiving sites (by autopilot launch day) start open. Each completed site opens the next one, in order of difficulty.
3. **Sky Rank** from sites completed (0 / 2 / 5 / 8): Cadet → Navigator → Pathfinder → Pole Pilot.
4. **Modifiers** (opt-in, in the brief): **True scale** (no vertical stretch, so ridges are harder to read), **No timeline** (read the 3D sky only), **Small battery** (half capacity).
5. **Daily mission** (§3).

Unlocks add things to *look at*, never raw power that skips the skill.

---

## 9. Science tie-ins

| What the player sees | The science |
| --- | --- |
| The Sun circles the horizon and never climbs | The Moon's axis is nearly upright, so at the pole the Sun skims the horizon |
| A ridge blocks the Sun at one spot but not 1 km away | Terrain, not time of day, decides power and radio here |
| Earth barely moves and wobbles a few degrees | Libration: Earth is almost fixed in the Moon's sky |
| Rich ice only where the floor never sees the Sun | Cold traps |
| Water becomes hydrogen + oxygen, which is rocket fuel | Electrolysis; why lunar ice matters |
| Rovers stop when Earth is hidden | Remote driving needs radio line of sight |
| A second tower fills the first one's night | Place panels where the shadows differ |
| The ridge flash | Horizon masks and shadow geometry |

**Rule: numbers come from the horizon math, not the 3D render.** If the picture and the numbers disagree, the numbers win.

---

## 10. What's REAL, ESTIMATE, RULE and MADE UP

| Item | Tag |
| --- | --- |
| Sun and Earth positions, 2027 hourly (SPICE) | REAL |
| Terrain and horizon masks (LOLA) | REAL |
| % sunlit, % Earth, longest night, floor sunlit % | REAL |
| Water → H₂ + O₂ split | REAL |
| Fuel target inputs; tower power; rover speed and slope limit (VIPER) | ESTIMATE |
| Projected launch day (autopilot replay of the real sky with the game rules) | ESTIMATE |
| Cold-trap tiers and the 15% cut-off; base sleep at an empty battery | RULE |
| Ice amount per cell (inside the LCROSS range) | MADE UP |
| Pads, deliveries, upgrades, battery packs, rover payload and battery | MADE UP |

The menu's "What's real" page uses the same wording.

---

## 11. What to avoid

- No timers that punish slow looking: time is paused during every choice.
- No streak guilt, ads, loot boxes or leaderboards with names.
- No wall of text: the dock shows glyphs and short words; facts live in the menu.
- No invented science: anything uncertain gets a tag or gets cut.
- Don't let the base take over the terrain: if the 3D view isn't the star, the HUD is too big.
