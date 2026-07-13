# Artifacts MMO Bot

Personal TypeScript bot for managing my 5-character crew in Artifacts MMO.

**Characters:** Cartman, Stan, Kyle, Kenny, Butters. There are no fixed roles —
every character runs the same small set of `Task` types (`farm`, `hunt`,
`craftAndEquip`, `craftAndEquipThenHunt`, `autoHunt`, `autoFarm`), assigned per-character
in `tasks.json` (not committed - see `tasks.example.json` and Configuration
below). What each one is currently doing has changed several times already
(farming → gearing up → hunting) as the crew's needs evolved; reassigning
someone just means editing that file - the running bot picks up the change
on its own within a few seconds, no restart needed.

## Status

🟢 **Working** — the bot runs real gather/combat/craft loops end-to-end
against the live API. Iterating incrementally: small feature, tested (unit
tests + live smoke checks), then the next one.

## Tech Stack

- **Runtime:** Node.js 24.17.0
- **Language:** TypeScript 7, compiled/type-checked in strict mode
- **API:** [Artifacts MMO](https://docs.artifactsmmo.com/), typed via `openapi-fetch` against a generated `schema.d.ts` (see `pnpm generate:api-types`)
- **Errors:** [`neverthrow`](https://github.com/supermacro/neverthrow) — every client/strategy call returns a `Result`/`ResultAsync`, never throws, so failure paths can't be forgotten
- **Package Manager:** pnpm 11.9.0 (enforced via `packageManager`/`devEngines` in `package.json`)
- **Validation:** Valibot (env vars)
- **Dates:** date-fns (Temporal isn't natively available yet on Node 24 without `--experimental-temporal` or a polyfill)
- **Logging:** pino (pretty-printed in development)
- **Testing:** Vitest + MSW (for HTTP-contract tests against the client)
- **Linting/Formatting:** oxlint + oxfmt

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your Artifacts token

# Set up task assignments
cp tasks.example.json tasks.json
# Edit tasks.json to match your characters and what they should be doing

# Run the bot
pnpm dev
```

## Project Structure

```
.
├── src/
│   ├── bot/                # Main bot logic
│   │   ├── characters/     # characterAgent.ts: cooldown/position-aware agent
│   │   │                   # factory, shared by all 5 characters (not one
│   │   │                   # file per character)
│   │   ├── strategies/     # farming.ts, hunting.ts, equipment.ts, banking.ts:
│   │   │                   # gathering, combat, craft+equip, and bank-deposit
│   │   │                   # pipelines
│   │   ├── tasks/          # task.ts: the Task type (farm / hunt / autoHunt /
│   │   │                   # autoFarm / craftAndEquip / craftAndEquipThenHunt);
│   │   │                   # runTask.ts: dispatcher; taskRunners.ts: one
│   │   │                   # runner per task type; runForever.ts: shared
│   │   │                   # retry-forever loop
│   │   ├── combat.ts        # fightSafely: rests when HP is low, fights once,
│   │   │                    # logs a loss; averageDamagePerTurn/isSafeToFight:
│   │   │                    # the damage model shared with gear.ts
│   │   ├── gear.ts          # Task-appropriate equipment: findBestGatheringTool
│   │   │                    # (best tool for a gathering skill) and
│   │   │                    # findBestCombatWeapon (best weapon vs a monster)
│   │   ├── inventory.ts     # Pure helpers over a character's inventory
│   │   │                    # (held quantity, full-capacity checks, ...)
│   │   ├── progression.ts   # Automated decision layer (in progress): what
│   │   │                    # to hunt/farm/craft next, e.g. findNextSafeMonster
│   │   ├── xpRates.ts       # observedMonsterXpRates: XP/second per monster,
│   │   │                    # derived from GET /my/logs/{name} - no guessed
│   │   │                    # game formula, only data the API has revealed
│   │   ├── taskSupervisor.ts # runTaskSupervisor/reconcileTasks: re-reads
│   │   │                     # tasks.json on an interval and starts/stops/
│   │   │                     # restarts characters per AbortController
│   │   │                     # (see task.ts's tasksEqual for the diffing)
│   │   └── world.ts         # Resolves resource/monster/workshop codes to
│   │                        # map positions
│   ├── client/              # Typed, Result-based Artifacts MMO API wrapper,
│   │                         # incl. a paced rate limiter (see below)
│   │                         # (schema.d.ts is generated from the OpenAPI spec,
│   │                         # see 'pnpm generate:api-types')
│   ├── utils/                # Config, logging, cooldown helpers,
│   │                          # taskAssignments.ts (parses tasks.json)
│   └── index.ts               # Entry point: wires bot + loadTaskAssignments
│                               # into runTaskSupervisor
├── scripts/                    # One-off dev scripts (e.g. OpenAPI codegen)
├── tests/
├── .env.example
├── tasks.example.json          # Template for tasks.json (not committed)
└── package.json
```

## Configuration

### Environment Variables

```bash
# .env
ARTIFACTS_TOKEN=your_jwt_token_here
LOG_LEVEL=info
NODE_ENV=development

# Reserved for future use - validated but not wired to anything yet
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
ENABLE_NOTIFICATIONS=true
```

### Task Assignments

`tasks.json` maps each character name to a `Task` (see `src/bot/tasks/task.ts`
for the full list of task types and their fields); it's parsed and validated
by `loadTaskAssignments` (`src/utils/taskAssignments.ts`) with the same
valibot + "throw a readable summary of every issue" pattern as env vars, and
re-read every 10 seconds while the bot runs - editing it takes effect without
a restart (see `src/bot/taskSupervisor.ts`, and the Roadmap section below for
exactly when a change applies). Not committed (see `tasks.example.json` for
the template) since it's runtime config for this account's characters, not
project source - same treatment as `.env`.

```json
// tasks.json
{
  "Cartman": { "type": "autoHunt" },
  "Stan": { "type": "autoFarm", "skill": "mining" },
  "Kyle": { "type": "hunt", "monster": "chicken" },
  "Kenny": { "type": "craftAndEquip", "items": ["copper_ring", "copper_boots"] },
  "Butters": {
    "type": "craftAndEquipThenHunt",
    "items": ["wooden_staff"],
    "monster": "yellow_slime"
  }
}
```

## What's implemented

- **`ArtifactsClient`** (`src/client/index.ts`) — every method (`getCharacter`,
  `getMaps`, `getItem`, `getResources`, `getMonsters`, `getBankItems`,
  `moveCharacter`, `rest`, `gather`, `fight`, `craft`, `equip`, `unequip`,
  `giveItems`, bank deposit/withdraw, gold) returns a `ResultAsync`, never
  throws.
- **Rate limiting** — a sliding-window limiter per bucket (`action`, `data`),
  with a safety margin under the server's documented limits and _paced_
  requests (never releases a backlog of queued requests all at once - see
  `src/client/rateLimiter.ts`'s doc comment for why that mattered in
  practice). The limiter is in-memory, per process - it forgets what it's
  already sent across a restart, while the server's own hourly window
  doesn't (a real contributor to a live 429 during heavy `tsx watch`
  restart cycles - see "Known Limitations").
- **Static-catalog caching** (`src/client/memoize.ts`) — `getItems`,
  `getItem`, `getMonsters`, `getMonster`, `getResources`, `getResource`,
  and `getMaps` are memoized for the process's lifetime: this game content
  never changes while the bot runs, so re-fetching the exact same query
  every task cycle (across all 5 characters, many times an hour with the
  `autoHunt`/gear-check paths added recently) only ate into the account's
  hourly GET rate limit for no benefit - confirmed live via real 429s
  against the server's own "2000 per 1 hour" bucket. `getCharacter`,
  `getCharacterLogs`, and `getBankItems` are deliberately left uncached -
  their data is genuinely dynamic. Only successful results are cached; a
  failed attempt is evicted immediately so the next call retries for real.
- **`CharacterAgent`** (`src/bot/characters/characterAgent.ts`) — wraps the
  client for one character: waits out cooldowns automatically, tracks
  position/inventory/HP from every action's response (including `fight`,
  which needed special handling — see git history for why).
- **World resolution** (`src/bot/world.ts`) — maps a resource/monster/workshop
  code to a map position, and finds which resource node or monster drops a
  given item code (item codes and resource/monster codes are distinct).
- **Farming** (`src/bot/strategies/farming.ts`) — move to a resource, gather
  until the inventory is full, bank everything.
- **Hunting** (`src/bot/strategies/hunting.ts` + `src/bot/combat.ts`) — move
  to a monster, fight repeatedly (resting below 50% HP, logging losses
  without stopping), bank everything looted.
- **Craft & equip** (`src/bot/strategies/equipment.ts`) — recursively resolves
  and gathers/crafts whatever materials are missing, checking in order: held
  inventory, the bank, whatever's currently equipped (e.g. the starter
  `wooden_stick` gets unequipped to use as a material for `wooden_staff`),
  then falls back to gathering, or hunting when a material is a monster drop
  rather than a gatherable resource. Equipping is idempotent (skips if the
  exact target item is already in that slot) and replaces whatever else is
  equipped there otherwise (unequip, then equip) — so the same item list can
  be handed to every character and it'll upgrade past their starter gear
  instead of treating it as "already equipped".
- **Inventory-full handling** — farming and hunting bank everything once
  full; mid-craft material gathering deposits everything _except_ the item
  being accumulated so progress isn't lost; a bank withdrawal that wouldn't
  fit deposits everything else first (all react to the same 497 "inventory
  full" the game returns).
- **Tasks** (`src/bot/tasks/runTask.ts`) — `farm` and `hunt` loop forever;
  `craftAndEquip` works through a list of items once;
  `craftAndEquipThenHunt` does both (gear up, then hunt forever - the
  craft/equip part is a no-op for characters that already have the item).
  `src/index.ts` assigns one task per character.
- **Tests** — 60+ Vitest tests (dependency-injected fakes/neverthrow, no real
  network except `tests/client.test.ts`, which uses MSW for HTTP-contract
  tests).

## Scripts

```bash
# Development
pnpm dev               # Run the bot with hot reload (tsx watch)
pnpm build             # Compile TypeScript (tsconfig.build.json)
pnpm start             # Run the compiled build
pnpm type-check        # Type checking only, no emit

# Quality
pnpm test              # Run all tests once
pnpm test:watch        # Watch mode
pnpm test:coverage     # Coverage report
pnpm lint              # oxlint
pnpm lint:fix          # oxlint --fix
pnpm format            # oxfmt
pnpm format:check      # oxfmt --check

# Codegen
pnpm generate:api-types  # Regenerate src/client/schema.d.ts from the live OpenAPI spec
```

## Known Limitations

- **Single-character combat only** — `fight` supports up to 2 additional
  `participants` for boss monsters (per the API), but nothing in the bot
  builds multi-character boss fights or raids yet.
- **No trading** — Grand Exchange buy/sell and NPC trading aren't
  implemented.
- **Discord notifications** — `DISCORD_WEBHOOK_URL`/`ENABLE_NOTIFICATIONS`
  are validated as env vars but nothing sends notifications yet.
- **No automatic "go level up that profession" follow-up when a craft's
  skill level isn't met yet** — `ensureHeldItem` (`strategies/equipment.ts`)
  now checks the character's actual crafting-skill level
  (`weaponcrafting_level`, `gearcrafting_level`, `jewelrycrafting_level`,
  ..., via `craftSkillLevel` in `progression.ts`) against `item.craft.level`
  *before* gathering a single material, failing fast with a dedicated
  `InsufficientCraftingLevelError` instead of wasting a real `craft` API
  call that was always going to fail. What's still missing is the
  follow-up: the eventual answer isn't just "skip this upgrade", it's
  "go level up that profession first" - which needs the cross-character
  orchestrator (see "Cross-character orchestration" below) to be able to
  temporarily send a character into a farming/crafting-practice loop for
  the right skill, then come back to the upgrade once it's unlocked.
  Deliberately left as a known gap until that orchestration foundation
  exists.
- **No cost/risk weighing for a "known" material source, only
  exists/doesn't** — `materialsNeededFor`'s `source` classification (see
  "Automated progression decisions" below) only ever says a raw material
  is gatherable, huntable, or unknown - never *how* risky or expensive
  going to get it actually is. `UnsafeMonsterError` (a monster drop that
  isn't safe to fight, added after a live incident - see "Automated
  progression decisions" point 7) and `InsufficientCraftingLevelError`
  (above) both cover a *binary* safety/eligibility check, not a
  cost/value judgment - a known-safe, known-eligible source can still
  take an arbitrarily long time to fetch (no quantity cap either, see
  point 7), and nothing here weighs that against how good the upgrade
  actually is.
- **Rate limiter forgets history across a process restart** — the
  sliding-window limiter (`src/client/rateLimiter.ts`) only tracks
  requests sent by the current process; the server's own hourly window
  doesn't reset on our restart. In dev, `tsx watch` restarting on every
  file save means a burst of restarts within the same real hour can
  cumulatively exceed the server's limit even though no single process
  lifetime ever saw more than its own local cap - confirmed live. Static-
  catalog caching (`src/client/memoize.ts`, see "What's implemented")
  removes most of the *demand* that led to this, but doesn't fix the
  underlying blind spot; persisting the limiter's state across restarts
  (ties into the SQLite idea already noted for other reasons) would.
- **`observedMonsterXpRates` re-fetches 100 log entries every `autoHunt`
  cycle, per character** — this data is genuinely dynamic (unlike the now-
  cached catalogs above), so it can't just be memoized forever, but
  re-fetching a large page on every single cycle - rather than on some
  looser cadence, since XP/s only meaningfully changes after an actual
  fight resolves - is still a real, not-yet-addressed contributor to GET
  volume. Noted here, not fixed yet.

## Roadmap

This tracks the bot's own capabilities, not what any character happens to be
doing right now (that's just runtime config in `tasks.json`).

Recently delivered (see git log for details):

- ✅ Typed API client with `Result`-based error handling, no thrown exceptions
- ✅ Rate limiting tuned against real 429s (paced requests + safety margin)
- ✅ Cooldown/position/HP-aware character agent
- ✅ Farming loop with automatic bank deposits
- ✅ Craft-and-equip pipeline with recursive material resolution, idempotent
  re-runs, and inventory-full handling mid-gather
- ✅ Combat: safe hunting loop (auto-rest, loss-tolerant) and a monster-drop
  fallback for crafting materials that aren't gatherable resources
- ✅ Bank-aware material sourcing (checks the bank before re-gathering/hunting)
- ✅ Equip upgrades replace whatever's already in a slot (unequip + equip)
  instead of treating starter gear as a permanent placeholder
- ✅ Equipped items get reclaimed as crafting materials when needed (e.g. the
  starter `wooden_stick` weapon is exactly what `wooden_staff` needs)
- ✅ Bank withdrawals that wouldn't fit in the inventory deposit everything
  else first, instead of hitting the game's 497 "inventory full" error
- ✅ Character-to-character item transfers (`giveItems`) — not wired into any
  `Task` yet (it needs both characters on the same tile, which the current
  one-character-per-task model doesn't coordinate), but available and used
  for one-off moves like consolidating a spare weapon onto one character
- ✅ `autoHunt` task: picks the best monster that's still safe to fight,
  re-evaluated every cycle instead of a fixed monster code — all 5
  characters run it now (see "Automated progression decisions" below)
- ✅ `autoFarm` task: same idea for gathering — picks the highest-level
  resource the character's level in a given skill (mining/woodcutting/
  fishing/alchemy) allows, re-evaluated every cycle (see "Automated
  progression decisions" below)
- ✅ Task-appropriate equipment: `farm` equips the best gathering tool for
  the resource's skill before gathering, and `hunt`/`autoHunt` equip the
  best weapon against the specific monster being fought, both via the
  existing bank-aware `craftAndEquip` (see "Automated progression
  decisions" below)
- ✅ Target selection now prefers whichever safe monster has the best
  _observed_ XP/second rate from the character's own fight history (`GET
/my/logs/{name}`), falling back to the highest-level heuristic for
  monsters it hasn't fought recently (see "Automated progression
  decisions" below)
- ✅ Task assignments moved out of `src/index.ts` and into `tasks.json`
  (`src/utils/taskAssignments.ts`, validated with valibot, same
  fail-fast-with-a-readable-summary pattern as env vars) - reassigning a
  character no longer needs a code change, just an edit to that file
- ✅ `tasks.json` reloads without restarting the process
  (`src/bot/taskSupervisor.ts`): re-read every 10s, diffed per character
  (`tasksEqual`), and only characters whose task actually changed get
  restarted - everyone else keeps running untouched. A restart means an
  `AbortController` per character is aborted and its (forever-looping)
  task is awaited before the new one starts, so a reassignment applies
  cleanly between cycles, never mid-action - see `runForever`'s doc
  comment for exactly when that check happens (can take up to one full
  cycle). A JSON typo mid-edit is logged and skipped, not fatal - the bot
  keeps running the last-known-good assignments.
- ✅ Combat gear selection generalized from weapon-only to every combat
  slot (`findBestCombatGear`, `src/bot/gear.ts`), and `autoHunt` now
  re-checks all of them right after a character levels up, not just the
  weapon (see "Automated progression decisions" below)
- ✅ Dry-run material-cost query (`materialsNeededFor`,
  `src/bot/materialPlan.ts`) - read-only version of `ensureHeldItem` that
  reports what's missing to craft/hold an item without acting on it (see
  "Automated progression decisions" below)
- ✅ Read-only "does any combat slot have an available upgrade" query
  (`findCombatGearUpgrades`, `src/bot/gear.ts`) - detect-only counterpart
  to `findBestCombatGear`, scanning every supported slot in parallel (see
  "Automated progression decisions" below)
- ✅ Cost gate (`equipIfFree`) on the 3 existing auto-equip call sites,
  using `materialsNeededFor` - only equip an upgrade found automatically
  when it's completely free right now (see "Automated progression
  decisions" below)
- ✅ The level-up 8-slot gear scan now goes to fetch missing materials
  for a worthwhile-but-not-free upgrade (`equipWorthwhileUpgrade`),
  instead of just logging it - as long as every missing material has a
  known source (see "Automated progression decisions" below)
- ✅ Read-only "what could I craft right now from bank surplus" query
  (`findCraftableFromBankSurplus`, `src/bot/materialPlan.ts`) - the
  mirror image of `materialsNeededFor`, checking a crafting-skill level
  (`craftSkillLevel`, `src/bot/progression.ts`) rather than just the
  character's overall level (see "Automated progression decisions" and
  "Known Limitations" below)
- 🐛 Fixed live: the level-up 8-slot gear scan now also runs on an
  `autoHunt` task's very first cycle, not only after a level transition -
  a character already at their current level when the task started (a
  process restart, a reassignment) could otherwise never trigger a
  "level increased" comparison, leaving a fully free upgrade unequipped
  indefinitely (found live: a free `copper_legs_armor` sitting unequipped
  on two level-8 characters).
- 🐛 Fixed live: hunting a monster to obtain a raw craft material
  (`ensureHeldItem`'s fallback in `strategies/equipment.ts`) now checks
  `isSafeToFight` first and refuses (a new `UnsafeMonsterError`) instead
  of fighting an unsafe monster anyway - unlike the main `autoHunt` loop
  (`findNextSafeMonster`), this fallback had no safety check at all
  before this fix, since `huntUntilHave`/`fightSafely` were built for a
  caller that already picked a safe target. Found live, right after
  shipping `equipWorthwhileUpgrade`: it made this fallback fire far more
  often (any known-source material, not just ones a human explicitly
  listed in a `craftAndEquip` task), which exposed the gap - two
  characters were repeatedly losing fights against monsters well above
  what their gear could handle, chasing amulet/armor materials.
- ✅ `ensureHeldItem` (`strategies/equipment.ts`) now checks the
  character's crafting-skill level against a recipe's `craft.level`
  requirement (`craftSkillLevel`, `src/bot/progression.ts`) before
  gathering a single material for it, failing fast with a new
  `InsufficientCraftingLevelError` instead of wasting a `craft` API call
  that was always going to fail - added proactively right after the
  `UnsafeMonsterError` fix above, once the same "known source, but not
  actually usable yet" shape was spotted (see "Known Limitations" for
  what's still open: this only skips the upgrade, it doesn't yet go
  level up the profession).

Up next (not yet started, roughly in order of likely value - see point 7
under "Automated progression decisions" for the full staged plan):

- [ ] Wire `findCraftableFromBankSurplus` into an actual task (craft for
  profession XP, not just combat gear)
- [ ] Grand Exchange trading
- [ ] Multi-character boss fights
- [ ] Discord notifications for notable events (rare drops, task failures)
- [ ] Longer-term: listen for game events (raid spawns, server
  announcements, ...) instead of only polling - see the closing note under
  "Automated progression decisions" below

### Automated progression decisions (in design)

Even with `tasks.json` (no-restart reassignment) and the `auto*` task
variants below, *which* task type each character runs is still a human
decision, picked and adjusted by hand every time a character levels up or
finishes a gear upgrade (this happened repeatedly while building the bot so
far). The goal is a decision layer that picks the best next thing to do on
its own. Planned in small, independently-testable pieces:

1. ✅ **`isSafeToFight(character, monster)`** (`src/bot/combat.ts`) — a pure
   heuristic deciding whether a fight is worth attempting, before
   committing to it.
   - Per-element damage: attack stat boosted by the attacker's `dmg`/
     `dmg_<element>` % bonuses (characters only — monsters don't have
     these), then mitigated by the defender's resistance to that element,
     summed across all four elements, computed both ways (character →
     monster and monster → character).
   - Critical strikes included on both sides (average damage multiplier
     `1 + 0.5 × crit% / 100`), since gear can swing crit chance a lot (e.g.
     `copper_dagger` = 35% vs `wooden_stick`'s 5%).
   - Converted to "turns to kill" vs "turns to die"; safe only if
     `turns_to_kill ≤ turns_to_die / 2` — a 2x margin, in the same spirit as
     `restIfLow`'s 50%-HP threshold, to absorb the variance this simplified
     model doesn't capture (crit streaks, roll luck, ...).
   - Turn order/initiative is deliberately ignored (documented
     simplification, not an oversight) — revisit only if real fights diverge
     too much from the prediction.
2. ✅ **`findNextSafeMonster(client, character)`** (`src/bot/progression.ts`)
   — queries monsters up to the character's level and picks the best one
   `isSafeToFight` still allows, using the observed XP/second rate from
   point 4 where available and the highest-level heuristic as a fallback
   otherwise. Returns `undefined` when nothing qualifies, which callers
   should treat as "go upgrade gear instead" (point 3). Wired in as the new
   `autoHunt` `Task` (`src/bot/tasks/runTask.ts`), which re-picks the
   target every cycle instead of using a fixed monster code — all 5
   characters run it now.
3. ✅ **Task-appropriate equipment ("build per task")** (`src/bot/gear.ts`)
   — equip whatever fits the activity at hand, not just the highest raw
   combat stats.
   - `findBestGatheringTool(client, skill, maxLevel)` — Artifacts MMO models
     gathering tools as weapons with an effect whose code matches the
     gathering skill and a negative value (e.g. `copper_pickaxe` has
     `{code: "mining", value: -10}`, a 10% cooldown reduction). Picks the
     largest reduction among weapons at or below `maxLevel`. Wired into
     `runFarmTask`, once before its forever loop (the resource, and so the
     needed skill, never changes mid-task).
   - `findBestCombatGear(client, character, monster, slot, maxLevel)` —
     generalizes what used to be weapon-only selection to every equipment
     slot in `SUPPORTED_COMBAT_SLOTS` (weapon, shield, helmet, body_armor,
     leg_armor, boots, ring1, amulet — `bag`'s `inventory_space` and
     `rune`/artifacts/utilities need a different criterion, or aren't
     handled at all, see `EQUIP_SLOT_BY_ITEM_TYPE`). Removes the
     currently-equipped item's own contribution from the character's
     stats, adds each candidate's contribution back in, and picks
     whichever yields the highest `combatMargin` (`combat.ts` — the same
     continuous "safety margin" score `isSafeToFight` checks against a
     fixed threshold, now exported so armor's hp/resistances and weapons'
     attack/dmg/crit are ranked on one consistent scale instead of
     per-slot ad hoc weights).
   - `runAutoHuntTask` re-checks the weapon slot every cycle (tied to the
     current target, which can change every cycle) but only re-checks the
     other 7 slots right after the character actually levels up - their
     "best" choice changes far less often, so checking all of them every
     cycle would mean several extra `getItems`/`getItem` calls for very
     little benefit most of the time. `runHuntTask` (fixed monster) still
     only checks the weapon slot, once, at task start.
   - All reuse `craftAndEquip` as-is (bank-aware, idempotent, can reclaim
     items from other slots) — no new low-level capability was needed, just
     the selection logic. Failures are logged and non-fatal: the character
     just keeps whatever's currently equipped.
   - Still open: `findNextSafeMonster` returning `undefined` doesn't yet
     trigger "try upgrading gear first" — it just retries later. `farm`/
     `autoFarm` don't get a level-up armor check at all (only their
     gathering tool) - combat gear only matters once a character is
     actually fighting.
4. ✅ **Target selection by XP/loot rate** (`src/bot/xpRates.ts`) — replaces
   `findNextSafeMonster`'s "highest level that's safe" stand-in with a real
   estimate, without guessing at a game formula: the API never reveals a
   monster's XP ahead of time, only after a fight actually happens (in the
   fight response, and in `GET /my/logs/{name}`'s history of past ones).
   - `observedMonsterXpRates(client, characterName)` fetches the
     character's last 100 log entries, sums XP and cooldown seconds per
     opponent across every fight found (win _or_ loss — a loss's 0 XP is
     real data, not something to discard), and returns XP/second per
     monster code. A monster this character hasn't fought recently is
     simply absent from the result, not zero - `findNextSafeMonster` only
     compares monsters it actually has a rate for.
   - `findNextSafeMonster` now picks whichever safe monster has the best
     observed rate, falling back to the old highest-level heuristic when
     none of the safe candidates have been fought recently enough to have
     one yet (e.g. right after leveling into a new bracket).
   - `observedMonsterXpRatesOrEmpty` degrades a log-fetch failure to an
     empty map instead of blocking target selection - same non-blocking
     spirit as the equipment failures in point 3.
   - Because the rates come from the account's own server-side log
     history (`/my/logs/{name}`, last ~5000 actions), this survives
     process restarts for free - no separate persistence needed for this
     piece.
5. ✅ **`findNextFarmableResource(client, character, skill)`**
   (`src/bot/progression.ts`) - the gathering equivalent of point 2: picks
   the highest-level resource node at or below the character's level in
   `skill`. Simpler than hunting - there's no "safety" concept for
   gathering (a gather action can't be lost the way a fight can), so this
   is just the highest-level match, no XP-rate tracking needed either
   (gathering always succeeds and takes a fairly consistent amount of
   time regardless of resource, unlike combat's win/loss variance). Wired
   in as the new `autoFarm` `Task`, re-picking the resource every cycle -
   same shape as `autoHunt`, but per-skill: a character has 4 independent
   gathering skill levels (mining/woodcutting/fishing/alchemy), unlike
   the single combat level `autoHunt` reads from, so `autoFarm` still
   needs `skill` specified in `tasks.json` rather than being fully
   automatic.

These pieces make each individual activity (a fixed hunt, a fixed farm)
auto-improve its own target/gear as a character levels up or gears up,
without a human editing `tasks.json`. What's still fully manual is
_choosing the activity itself_ - whether a character should be hunting,
farming (and which skill), or crafting right now, based on what it
actually needs next (a gear upgrade? a skill level? overall XP?) - that's
the bigger, still-open piece of "automated progression decisions".

6. **Planned - closing the gap to a `decideActivity()` policy.** Two
   framings were considered for how `tasks.json` should eventually work:
   (a) a new `{"type": "auto"}` task where the bot itself decides what a
   character should be doing, vs (b) keep `tasks.json` as an explicit,
   human-chosen intent and keep polishing the sub-decisions inside each
   task type (points 1-5 above). Conclusion: **(b) is not a fork from
   (a), it's prerequisite infrastructure for it.** Every "auto" task
   would need to consult exactly the sensing functions points 1-5 already
   built (`findNextSafeMonster`, `findNextFarmableResource`,
   `findBestCombatGear`, `findBestGatheringTool`, the observed XP-rate
   table) - none of that work is wasted regardless of which framing wins.
   The piece that's genuinely missing isn't an extension of any existing
   module, it's the decision **policy** itself - the logic that weighs
   heterogeneous signals (combat XP/s vs a pending gear upgrade vs a
   crafting recipe) against each other. Two gaps were identified as the
   natural next steps to make that policy possible without guesswork:
   - ✅ **Gap A (smaller): a read-only "any combat slot upgrade
     available" query.** `findCombatGearUpgrades` (`src/bot/gear.ts`)
     scans all 8 `SUPPORTED_COMBAT_SLOTS` in parallel (`ResultAsync.
     combine` - safe here since it's read-only, unlike the action
     pipeline which mutates the character step by step) and reports only
     the slots where `findBestCombatGear` picks something genuinely
     different from what's already equipped there. Deliberately kept
     separate from `taskRunners.ts`'s `equipAllCombatGearIfAvailable`
     rather than reused by it: that pipeline recomputes each slot
     immediately before acting on it on purpose (equipping one slot, e.g.
     a helmet's hp, changes the character's stats and so the ideal pick
     for slots checked after it), so a batch computed once upfront would
     go stale mid-loop - the same "separate, parallel, read-only function
     instead of refactoring the working pipeline" call made for Gap B.
   - ✅ **Gap B (the real missing piece): a dry-run material-cost query.**
     `materialsNeededFor` (`src/bot/materialPlan.ts`) mirrors
     `ensureHeldItem`'s exact recursion (`strategies/equipment.ts`:
     inventory -> bank -> craft materials recursively -> else classify
     the raw material as gatherable/huntable/unknown), but as a pure,
     side-effect-free query: it takes a character snapshot and returns
     `readonly MissingMaterial[]` (`{itemCode, missingQuantity, source}`,
     `source` being `{type: "gather"|"hunt", ...code}` or `{type:
     "unknown"}`) instead of moving/withdrawing/gathering/crafting
     anything. A decision policy can now tell "this upgrade is free right
     now" from "this upgrade needs an hour of mining first" without
     acting on it. Known simplifications (documented in the module):
     doesn't account for an item already equipped elsewhere the way
     `reclaimEquippedIfAvailable` does, and each recursive branch checks
     the bank independently, so a material shared by two craft branches
     is counted as available to both rather than split between them -
     fine for a rough "how much is missing" estimate, not for acting on
     several such estimates at once.
   - Building Gap A and Gap B closes the remaining distance between (b)
     and (a): once both exist, a `decideActivity()` policy becomes a
     matter of combining outputs that already exist as data, rather than
     inventing new sensing from scratch.
   - Longer term, and out of scope for now: all of the above is
     poll-based (the bot only reacts when it next checks). Artifacts MMO
     exposes server events (e.g. raid spawns, announcements) that could
     eventually be consumed via a webhook/push mechanism instead of
     polling, letting the decision layer react immediately to a rare
     spawn rather than discovering it on the next cycle. Noted here as a
     future direction, not a near-term piece.

7. **Design review: from Gap A/B to `decideActivity()`, staged.** With
   both gaps done, a dedicated design session settled the shape of the
   remaining work, deliberately staged from immediate to long-term
   rather than building the full policy in one pass:
   - ✅ **Immediate - a cost gate on the 3 existing auto-equip call
     sites.** `equipBestCombatGearIfAvailable` (weapon, every cycle),
     `equipAllCombatGearIfAvailable` (8 slots, on level-up), and
     `equipGatheringToolIfAvailable` (gathering tool, at farm/autoFarm
     start) all called `craftAndEquip` for *any* upgrade they found, with
     no limit on how much gathering/hunting that committed the character
     to - this was live behavior, not hypothetical. All three now gate on
     `materialsNeededFor` returning `[]` (the upgrade is completely free
     right now, counting inventory and bank) via a new `equipIfFree`
     helper before calling `craftAndEquip`; otherwise the upgrade and its
     cost are logged for visibility, and whatever's currently equipped is
     kept. Strictly more conservative than the previous behavior - a free
     upgrade is still equipped immediately, a costly one is deferred
     instead of committed to blindly.
   - ✅ **Near-term - go fetch materials for a worthwhile-but-not-free
     upgrade, instead of just logging it.** Originally planned as a new
     `{"type": "auto"}` `Task`, but implemented as a smaller, equivalent
     extension once it turned out the actual need only ever fires at one
     already-infrequent checkpoint: right after a level-up, the full
     8-slot gear scan (`equipAllCombatGearIfAvailable` in
     `runAutoHuntTask`) now uses a new `equipWorthwhileUpgrade` gate
     instead of the strict free-only one - it commits to `craftAndEquip`
     as long as every missing material has a *known* source (a
     gatherable resource or a monster, per `materialsNeededFor`'s
     `source` field), skipping only when something can't be traced to
     either at all. `craftAndEquip`/`ensureHeldItem` already cross
     farm/hunt/bank for a single bounded material need - this is
     deterministic plumbing, not a value judgment - so no interruption/
     resume machinery was needed: the existing sequential `await` chain
     already pauses the hunting loop for exactly as long as fetching
     takes, then continues on its own. The every-cycle weapon check
     (`equipBestCombatGearIfAvailable`) deliberately keeps the strict
     free-only gate (`equipIfFree`) - paying a gathering/hunting detour
     that often would be too disruptive; only the rare, once-per-level
     checkpoint affords a costlier commitment. Known v1 simplification:
     no cap on *how much* is missing before committing (no quantity
     threshold yet) - see the self-tuned-thresholds item below for why a
     static number wasn't invented here.
     Two real bugs surfaced live once this shipped, both fixed (see
     "Recently delivered" above for the full write-up): the "once after a
     level-up" trigger was edge-based, not absolute, so a character
     already at their current level when the task started never got its
     first scan; and the fallback that hunts a monster for a raw material
     had no `isSafeToFight` check at all, unlike the main `autoHunt` loop,
     so a known-but-dangerous source was fought anyway instead of skipped.
     Both are a direct consequence of committing to a *known* source
     without weighing *how risky or costly* it actually is - the
     `craftAndEquip`/`ensureHeldItem` fallback still has no notion of
     "this source exists but isn't worth (or safe) pursuing", only
     "exists" vs "unknown"; `UnsafeMonsterError` covers the safety half of
     that gap for now, not the cost half. The same pipeline also now
     checks the character's crafting-skill level against `item.craft.level`
     before gathering a single material for it (`InsufficientCraftingLevelError`),
     failing fast instead of wasting a `craft` call that was always going
     to fail - added proactively once the same "known source, but not
     actually usable yet" shape was spotted, right after the safety fix.
     See "Known Limitations" for what's still missing here: the check
     stops at "skip it", it doesn't yet go level up the profession first.
   - ✅ **Near-term - sensing for craft-as-a-profession (detection only,
     not wired into any task yet).** `findCraftableFromBankSurplus`
     (`src/bot/materialPlan.ts`) is the mirror image of
     `materialsNeededFor`: given the bank's contents, it finds items the
     character could craft *right now* without gathering or hunting
     anything more, and - unlike every other gear-upgrade path in this
     codebase (see "Known Limitations") - it actually checks the
     character's crafting-skill level (`weaponcrafting_level`,
     `gearcrafting_level`, ...) against the recipe's `craft.level`
     requirement, since that check is the whole point of this function.
     For each material code found in the bank, it looks up which items
     consume it (`getItems`'s `craft_material` filter - the mirror of
     `findResourceForDrop`'s `drop` filter), deduplicates candidates
     surfaced by more than one surplus material, and reports how many
     units of each are craftable from what's already held or banked.
     Read-only, like `materialsNeededFor` and `findCombatGearUpgrades` -
     wiring it into an actual task (crafting for profession XP, not just
     combat gear) is the next piece.
   - 🎯 **Target, longer-term - noted but no infrastructure yet:**
     - Real cross-family arbitration (hunt vs farm *as an ongoing choice*,
       not just a one-off material fetch) - blocked on not having a
       gathering XP/second rate comparable to `observedMonsterXpRates`.
     - Self-tuned thresholds instead of static ones, once there's enough
       observed data to tune against (extends the "observed data over a
       guessed formula" principle `xpRates.ts` already applies to combat).
     - Richer persistence (SQLite?) if the bot ever needs to track more
       than what `GET /my/logs/{name}` already exposes for free.
     - Consuming game events (raid spawns, announcements) via a
       webhook/push mechanism instead of polling (same item as above,
       restated here as part of the staged plan).

### Cross-character orchestration (target architecture, not started)

Everything above is about a single character deciding its own next move.
But some decisions only make sense with visibility across all 5
characters at once: who should farm a resource because a *different*
character needs it to craft, who should switch to processing a bank
surplus, or several characters teaming up for a fight the game models as
a group encounter (see "Known Limitations" - multi-character boss fights
aren't supported at all yet). A design review sketched the target shape
for this, deliberately staged behind the still-in-progress per-character
work above rather than built now:

1. A read-only, shared snapshot of all 5 characters (level, inventory,
   equipped gear, position, skills) plus bank contents - the
   prerequisite visibility any cross-character decision needs, mirroring
   the "sensing before policy" split already applied above (Gap A/B).
   Computed on demand directly from the API (`getCharacter` x5 +
   `getBankItems`) for now, not persisted anywhere - the same "observed
   API data instead of a duplicated store" principle `xpRates.ts`
   already applies to combat rates. Revisit with something like SQLite
   once there's a real need for history/aggregation the API doesn't
   already give for free, not before.
2. The orchestrator itself becomes another producer of `TaskAssignment[]`,
   feeding the exact `reconcileTasks`/`taskSupervisor.ts` mechanism that
   already exists (today fed by a human editing `tasks.json`) - not a new
   execution model. Each character keeps running its own
   `runTask`/`runForever` loop, oblivious to the orchestrator; it just
   receives a different task from time to time, exactly like a human
   editing `tasks.json` does today.
3. Once proven, the orchestrator is expected to become the sole source of
   assignments - `tasks.json` (the human-edited one) fades out as the
   bot's autonomy grows. One exception planned: a one-shot, explicit
   human override request that takes precedence over the orchestrator
   temporarily for a specific character, then hands control back once it
   completes - the closest thing to a manual command channel once the
   bot is mostly running itself.

Deliberately left open, to avoid speculative design ahead of a real
need: exactly which cross-character decisions get built first (material
sourcing for someone else's craft? bank surplus processing? group
fights?), and how the orchestrator's own decision policy is structured
internally. These wait until the per-character `decideActivity()` pieces
above are far enough along to inform them with real signals - the same
"build the sensing, then the policy" order applied throughout this
document.

## Debugging

### Enable Verbose Logging

```bash
LOG_LEVEL=debug pnpm dev
```

### One-off live checks

For read-only or low-risk API checks during development, drop a scratch
script under `scripts/` (prefixed `_`, e.g. `scripts/_checkRates.ts`), run it
with `pnpm exec tsx --env-file=.env scripts/_checkRates.ts`, then delete it —
these aren't meant to be committed.

## Resources

- 📖 [Artifacts MMO Docs](https://docs.artifactsmmo.com/)
- 🔗 [OpenAPI Spec](https://api.artifactsmmo.com/openapi.json)
- 🎮 [Game Website](https://artifactsmmo.com/)

## Notes

- This is a **personal project** for learning TypeScript, async patterns, and API automation
- Not affiliated with Artifacts MMO team
- Please respect the game's ToS when using automation
- Ban risk is assumed by the user
