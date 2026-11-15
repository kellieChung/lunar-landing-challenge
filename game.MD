# Moon Base — game spec (v3: ice runs, judged by what really happens)

Audience: elementary and middle schoolers. Built on the app's real 2027 sky, the LOLA horizon masks and the 9 curated south-pole sites.

v3 keeps v2's direction: short separate runs, **decide by looking**, and the **ice chain** at the heart. It fixes the places where v2 broke against its own numbers or contradicted itself (§0). All numbers marked `TUNE` live in `web/src/game/constants.ts` next to the sourced constants. Sourced numbers are never changed to make the game easier.

---

## 0. What changed from v2, and why

| v2 said | What actually happened | v3 |
| --- | --- | --- |
| One run = one lunar day (708 h) | With the cited numbers (19 kg H₂ + 114 kg O₂ → ~170 kg water → tonnes of icy dirt, VIPER-speed rovers that only drive while Earth is up), even ideal play needs **23–74 days**, and 80–285 days without building. | A run lasts **until launch, with a deadline of 3 Sun circuits** (~89 days). The clock runs at **1 day per second**, slows down around sunsets and Earthsets, and pauses at every choice. A run still takes about 4–5 minutes. |
| Ice only in 0%-sunlit cells | 3 of 9 sites had no mission at all, with no explanation. | **Cold-trap tiers** (§6): rich, trace, none. 7 of 9 sites host ice runs. The other two say why, from the real sunlight: Malapert Massif has no cold trap at all, and Cabeus B Peak's floors all see a little Sun, so they hold only traces, too little to fuel the capsule in time. |
| Sky Sense: best of 3 by the Site Score formula | The landing spots were *designed* as trade-offs with no right answer, and then graded as if one were right. | **Sky Sense is judged by outcomes.** After each choice, an autopilot replays the run from the same hour for every option, using the real sky. The reveal shows "projected launch: day 31 / day 27 / missed". The data decides, not a weighting. |
| ★ = the capsule launched | The capsule also launched "when the cycle ends", so the star was free. | ★ = **launched before the deadline with full tanks.** |
| Build pads, get rovers | Pad → rover → pad → rover won at every site. The shelter, road and tower never mattered. | A pad delivery is a choice between **rover / solar tower / battery pack**. The road is cut. A balance test checks that no single build order is best at most sites. |
| The ridge flash comes in polish | The "why" is the lesson. Without it, the reveal only says "the Sun spot won on Sun". | The **ridge flash is part of the core reveal.** |
| Decisions #8 (bank or spend) and #10 (launch now or wait) | Neither had a real trade-off: there is nothing to bank, and launch needs full tanks. | Both are cut. A **Prepare beat** before the longest night takes their place (§4). |

---

## 1. Direction

Short, separate runs. Each run is a fresh draw: site, start date, the 3 landing spots, the 3 craters. You make a handful of choices by looking at the real sky, then watch them play out. The fun is "one more try, I'll read the sky better this time."

**Ice is the reason to be there.** Water ice survives only on crater floors that never see the Sun. Those same dark places have no sunlight for power and often no view of Earth. Every run is the tension between *where the ice is* and *where you can live*.

The pull to replay comes from a fast restart, the **near-miss reveal** ("your spot launches on day 34; the east-rim spot would have made it by day 26"), 1-to-3-star patches per site, and site unlocks. There are no streaks, timers or loot.

---

## 2. Promise and core loop

> "I can look at a mountain scene and the sky and tell where a base will thrive."

```
Pick site → LOOK & compare 3 landing spots → Land → REVEAL (+ ridge flash)
  → time runs (1 day/s; slows for sunsets and Earthsets)
  → LOOK & compare 3 craters → REVEAL (cold-trap rule)
  → rovers dig icy dirt, the plant makes H₂ + O₂ on sunlight, dry dirt piles up
  → build: pad (Earth sends rover / solar tower / battery), shelter
  → Prepare beat before the longest night
  → tanks full → countdown → launch → REPORT (stars, near-miss, patch) → Another mission
```

Three layers, in order: **look and decide** (the skill), **watch it play out** (the consequence), **grow the base** (the reward).

---

## 3. Run structure

| Phase | What happens | Time |
| --- | --- | --- |
| Site | Pick a site on the globe. Each site shows its patch (0–3 stars) or a lock. | 10 s |
| Brief | One screen: the goal, the deadline, optional modifiers. **Start mission**. | 10 s |
| Land | 3 landing spots. Each card shows only a name and a ground label (flat / rough / steep). **Go look** each one in 3D, on the year timeline and in the forecast, then **Land here**. | 60–90 s |
| Reveal 1 | REAL metrics for all three, the projected launch day for each, a tick on the winner of each row, and the **ridge flash**. | 15–20 s |
| Craters | Once the first rover is charged: 3 craters, labelled only "about N km". Look at the floor, the route, and Earth on the route. **Mine here**. | 30–45 s |
| Reveal 2 | Floor sunlit % (REAL), ice tier (rule), ice amount (HYPOTHETICAL), projected launch day. | 15 s |
| Running | 1 day/s. Rovers haul by themselves; the HUD says why they wait. | 1–3 min total |
| Builds | When dirt pays for something, the clock pauses for the choice. | 15–30 s each |
| Prepare | ~24 h before the longest dark stretch at the base, the clock slows. Mission control explains the coming night; if a delivery is waiting, choose it now. | 10 s |
| Launch | Tanks full → countdown → liftoff in 3D. | 5 s |
| Report | Stars, near-miss line, patch, **Another mission** (the biggest button). | 20 s |

**Deadline:** 3 Sun circuits from landing (2,124 h, `TUNE`). If it passes, the run ends with "the capsule didn't fill in time" and a report. That is still a soft ending: it shows the biggest drag and offers one-tap retry of the **same** run.

**Run variation (all from real data):**
- Site (7 with an ice run; a site hosts runs only if some start can launch in time, checked by `par.test.ts`).
- Start hour: seeded, within 24 h of a sunrise or sunset at the site center, and early enough in 2027 that the deadline fits.
- The 3 landing spots and the 3 craters are drawn from the 11×11 grid (§5).
- **Daily Mission:** the seed comes from the date. Everyone gets the same site and hour that day. There is no server, no streak and no loss for skipping.

**Soft failure.** An empty battery puts the base to sleep: lights dim, rovers park and the plant stops. It wakes again at 10% charge. Nothing ends a run early except the deadline.

---

## 4. The choices in a run

| # | Choice | Compare by looking at | Revealed after |
| --- | --- | --- | --- |
| 1 | Site | The globe | — |
| 2 | Landing spot | Skyline, year timeline, Sun path, Now/Next forecast | % sunlit, % Earth, longest night (REAL); projected launch day for each option (ESTIMATE) |
| 3 | Crater | Crater floor in 3D, the year timeline at the floor, the route on the map | Floor sunlit % (REAL), ice tier and amount (rule / HYPOTHETICAL), projected launch day |
| 4–6 | Pad deliveries: rover / solar tower / battery pack | Cards: what each fixes (haul speed / power in the base's dark / power through the night) | — |
| 5a | Tower spot (if a tower) | 3 spots within cable reach; the timeline shows when each is lit | Hours of base darkness each one covers (REAL) |
| 7 | Thermal shelter (once) | Cost vs effect card | — |
| 8 | Prepare beat | The forecast: how long the coming night is | What the night cost (battery hours at zero) |

Three choices are real look-and-compare moments (2, 3, 5a). The rest are quick cards.

---

## 5. How the options are drawn (no dominant answer)

**Landing spots:** only cells that have some sun and at least one crater in rover range. The roles:
- A **Sun spot:** highest % sunlit.
- B **Earth spot:** highest % Earth visible.
- C **Balanced spot:** best (% sunlit + % Earth) among the rest, with a short longest night.

If one option beats both others on all three REAL metrics (% sunlit, % Earth, shorter longest night), swap the dominated role for the next candidate. The **projection** decides which spot is best, not a formula. Sometimes the balanced spot wins, sometimes the Earth spot does, depending on the craters and the date.

**Craters:** cells with ice (rich or trace) in rover range of the base. Offer the darkest, then a near-dark, then the closest. With fewer than 3, offer what exists.

**Tower spots:** the 3 cells within cable reach (2 km) that are lit for the most hours while the base is dark, from now until the deadline.

---

## 6. The base economy (kept small)

### The ice chain

```
Cold trap (floor never or barely sunlit) → rovers dig icy dirt → haul home → plant bakes out the water
→ water splits into H₂ + O₂ (needs sunlight power) → capsule fuel → launch
                     └→ leftover dry dirt = currency for builds
```

### The cold-trap rule (the one science idea kids must get)

| Floor sunlit over 2027 (mean share of the Sun's disk) | Ice tier | Ice in the dirt |
| --- | --- | --- |
| 0% (no part of the Sun in any hour) | **Rich** | 2.7–8.5% (inside the LCROSS range, fixed per cell) |
| above 0% up to 5% (`TUNE`) | **Trace** | at most the lowest rich amount (2.7%), shrinking linearly to 0 at 5%: always less than any rich floor |
| above 5% | **None** | ice sublimates away |

"Floor sunlit %" is **REAL**: the horizon mask plus hourly Sun positions at that cell. The tiers are a **game rule** that follows the cold-trap idea. The amounts are **HYPOTHETICAL** (there's no ice map in the app), and the reveal says so. Where a site's darkest floor is only a trace, the game calls it "the darkest floor nearby", never "permanently shadowed".

**Rovers (automatic):** they scout, then haul. They only drive while the base sees Earth (people drive them by radio) and only leave with enough charge for the round trip. The HUD shows why they wait: "waiting for Earth", "charging".

**The plant needs power.** Baking and splitting run on sunlight left over after the base's keep-alive power. A long night makes fuel slowly. So the landing spot matters twice: a sunny spot makes fuel, and the crater supplies ice.

**Capsule target:** 19 kg H₂ + 114 kg O₂ from the rocket equation (ESTIMATE), which takes ~170 kg of water (REAL chemistry: water is 11% hydrogen by mass).

**Builds (paid in dry dirt):**

| Build | Cost (`TUNE`) | Effect | Tag |
| --- | --- | --- | --- |
| Landing pad | 150, 250, 350 … kg | Earth lands one delivery on it: **rover**, **solar tower** (you place it) or **battery pack** (+48 kWh) | HYPOTHETICAL (research concept) |
| Thermal shelter | 250 kg | Halves the base's keep-alive power | ESTIMATE (regolith shelters are real proposals) |

**Power:** each solar tower makes power by how much of the Sun's disk is up at its cell that hour (REAL), 10 kW in full sun (ESTIMATE, VSAT class). Two towers at cells with different shadows cover each other's nights. That's the lesson.

---

## 7. UI

**The 3D view is the star.** The HUD sits at the screen edges like instruments. Choices take the whole screen.

```
┌ compass strip (Sun / Earth markers, arrows when off-screen) ───────────────────────┐
│ [Menu] Fuel ▮▮▯▯▯ 18%  ☼ ▮▮▮▮ sun · sets in 19 h  ◍ Earth · 10 d  Rovers 2 at work │
│        Dirt 72 kg [Build]                 Day 6/89  [Pause] [1 day/s]  [Map]       │  ← ONE bar
│                                                                                    │
│                         [ 3D first-person view: the star ]                         │
│                                                                                    │
│ (mission control: portrait + one line, only while it is talking)                   │
├────────────────────────────────────────────────────────────────────────────────────┤
│ this month's timeline (the whole year comes back while choosing)                  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- **One status bar, nothing else on the view.** Every reading is a glyph, a short meter or a number and at most three words: when the Sun and Earth next change replaces separate forecast cards; rovers are one summary ("2 · at work"), with each rover's state in the tooltip. Build and Map open small pop-overs only when asked.
- **Mission control appears only while it talks** and fades out a few seconds later; every line is kept in the menu's Radio log.

**Visual language: the Sprout Lands packs (Cup Nooble), recoloured to space grey with blue and purple accents.**
- **No emoji in the game UI.** Every glyph is a sprite: sun, moon, rock, pickaxe and ice from the pack's icon sheets; weather icons for the forecast; chests for crates and patches. Without the pack, glyphs fall back to short words.
- **No confetti, overshoot pops, floating "+N" numbers or centered celebration banners.** Feedback happens in place: a meter fills segment by segment, the mascot's face changes, and one line goes into the comms log.
- **No rounded drop-shadow cards, gradients or glass blur.** Frames are 9-sliced sprites at one integer scale (2×). Text is the pack's pixel font at 16 px. Motion is stepped sprite frames only, and is off under reduced motion.
- **Mascot:** the pack's character (Teemo) in the dialog frame, with the click-to-continue indicator. Its emotes follow the state of the base (sunrise → happy, Earth lost → sad, base asleep → sleepy). Only 3 messages block play (the first look, the first reveal, the first night). The rest go into a log that can be scrolled back.
- **Tags:** REAL / ESTIMATE / HYPOTHETICAL as small labels next to numbers. Tapping one explains it in one sentence.
- **Never colour only:** every state has a glyph and a word.
- **Accessibility:** pause any time (space), no twitch input, large targets, keyboard works, reduced motion respected.
- **Sound:** the pack's own short sounds (click, build, delivery, Earth back, base asleep, sunrise, launch), with a mute toggle.

---

## 8. Scoring and progression

**Sky Sense, per look-and-compare:** your option's rank by projected launch day. 1st = 100, 2nd = 60, 3rd = 20 (`TUNE`). Ties share the higher rank. "Missed" ranks last.

**Stars:**
- ★ **Launch:** tanks full before the deadline.
- ★★ **Lights on:** the base slept for 48 h (2 days) or less in total (`TUNE`).
- ★★★ **Sky Sense:** an average of 80 or more.

Each star needs the one before it, so the order is the order of difficulty.

**Near-miss line (always shown):** the single biggest gap between your choice and the best option's projection, with real numbers: "Your spot has a 62 h longest night; the Earth spot's is 38 h. It would have launched 8 days sooner."

**Between runs** (`localStorage` only, no names or accounts):
1. **Patches:** one per site, best stars kept. The patch is a pine / silver / gold chest for 1 / 2 / 3 stars.
2. **Unlocks:** the 3 most forgiving sites (by autopilot launch day) start open. Every 3 stars opens the next one, in order of difficulty.
3. **Sky Rank** from total stars: Cadet → Navigator → Pathfinder → Pole Pilot.
4. **Modifiers** (opt-in, chosen in the brief): **True scale** (no vertical stretch, so ridges are harder to read); **No timeline** (read the 3D sky only); **Small battery** (half capacity).
5. **Daily Mission** (§3).

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

## 10. What's REAL, ESTIMATE and HYPOTHETICAL

| Item | Tag |
| --- | --- |
| Sun and Earth positions, 2027 hourly (SPICE) | REAL |
| Terrain and horizon masks (LOLA) | REAL |
| % sunlit, % Earth, longest night, floor sunlit % | REAL |
| Water → H₂ + O₂ split | REAL |
| 19 kg H₂ / 114 kg O₂ capsule; tower power; rover speed (VIPER) | ESTIMATE |
| Projected launch day (autopilot replay of the real sky with the game rules) | ESTIMATE |
| Cold-trap tiers and the 5% trace cut-off | game rule |
| Ice amount per cell (inside the LCROSS range) | HYPOTHETICAL |
| Pads, deliveries, shelter, battery packs, rover payload and battery | HYPOTHETICAL |
| Base sleep at an empty battery | game rule |

The menu has a "What's real" page with the same wording, and a **Credits** page: *Assets from Sprout Lands by Cup Nooble* (cupnooble.itch.io). The packs aren't redistributed: `npm run skin` builds the sprites and sounds from your own download, and without them the game runs with plain frames and text.

---

## 11. Build order

1. Spec (this file).
2. Asset pipeline: crops, recolours and sounds from all three packs; sprite registry with text fallbacks.
3. Rules: cold-trap tiers, option drawing, autopilot, run state machine, scoring, seeds, progress. All headless and tested.
4. Presentation: HUD, chooser, comms, reveal with ridge flash, report, menu.
5. Builds and balance: pause-on-build, three delivery kinds, tower compare, a strategy-sweep test.
6. Progression on the globe: patches, locks, Daily Mission, modifiers.

**Playtest checklist:** after one run, can they say what the green stretch of the timeline means? Did they press Another mission without being asked? Did anyone say "I picked wrong because…"?

---

## 12. What to avoid

- No timers that punish slow looking: time is paused during every choice.
- No streak guilt, ads, loot boxes or leaderboards with names.
- No wall of text: the HUD shows glyphs and short words; facts live in the menu.
- No invented science: anything uncertain gets a tag or gets cut.
- Don't let the base take over the terrain: if the 3D view isn't the star, the HUD is too big.
