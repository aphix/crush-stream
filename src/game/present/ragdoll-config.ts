/** What `RagdollSystem` and its collaborators (`CarProxies`, `RideAlong`) share: the slot count, the step and the collision groups. */

/** Live dummies at once; a fifth throw recycles the oldest. */
export const SLOTS = 4;
/**
 * Rapier's step (sim s) while a dummy is out, the same at any display rate: `update` takes whole steps out of an accumulator and the draw
 * blends the last two (it once stepped per frame, and Rapier warm-starts with the last step's impulse: landings 25.6–58.1 m).
 * 1/480 (owner, 2026-10-06: half the steps of 1/960, each twice as long, the draw still blending every frame): 65 ms of slow-mo
 * wall time a step, 2.1 sim ms behind the cars. 1/120 was 273 ms of wall time, 3.7 poses a real second drawn as chords.
 */
export const STEP = 1 / 480;
/** Most sim seconds one frame steps: a longer hitch drops the rest instead of spiralling (the cars drop beyond 0.05 too). */
export const MAX_ACC = 0.05;

/**
 * Collision groups (membership << 16 | filter), 16 bits: the world; each dummy slot; each car (its lower box, bumper
 * to bonnet line, fitted to its crushed length, and its cabin's slabs), in 10 buckets of car index; the props. Out of
 * the car a dummy hits everything but its own jointed neighbours (`setContactsEnabled(false)`) and the purses. For
 * `GRACE` s after the throw it ignores its own car (it starts inside it) and the dummies thrown from that car still in
 * theirs (a passenger starts beside his driver); every other car and dummy it hits from the first frame.
 */
const G_STATIC = 1;
const dollBit = (s: number) => 2 << s;
const G_DOLLS = 0x1e;
/** Car i's bit; a dummy with no car of his own (`place`, car -1) has none, so he hits every car from the first frame. */
const carBit = (i: number) => (i < 0 ? 0 : 0x40 << i % 10);
const G_CARS = 0xffc0;
const G_PROPS = 0x20;
export const dollGroups = (s: number) => (dollBit(s) << 16) | G_STATIC | G_DOLLS | G_CARS | G_PROPS;
/** What a dummy just thrown from car `car` collides with: everything but that car (until `GRACE` s). */
export const thrownGroups = (s: number, car: number) => (dollBit(s) << 16) | G_STATIC | G_DOLLS | G_PROPS | (G_CARS & ~carBit(car));
/** A woman's purse and what falls out of it hit the world, the barrier and every car (not their own for `GRACE` s), never a dummy. */
export const propGroups = (car: number) => (G_PROPS << 16) | G_STATIC | (car < 0 ? G_CARS : G_CARS & ~carBit(car));
/** A knocked prop (`PropBodies`) hits the world, the dummies, every car (not the one that knocked it for `GRACE` s, nor one squeezing it while its box covers it) and the other knocked props; a purse lets it by. */
export const knockedGroups = (car: number) => (G_PROPS << 16) | G_STATIC | G_DOLLS | G_PROPS | (car < 0 ? G_CARS : G_CARS & ~carBit(car));
export const FIXED_GROUPS = (G_STATIC << 16) | G_DOLLS | G_PROPS;
/** The ground's two copies (`groundColliders`): the one only the dummies stand on, with their grip, and the one everything else does, as it always was. */
export const DOLL_FLOOR_GROUPS = (G_STATIC << 16) | G_DOLLS;
export const PROP_FLOOR_GROUPS = (G_STATIC << 16) | G_PROPS;
/** Car i's leaves (`ProxyFitter`) and standing panes; a gone pane's slab collides with nothing (Rapier kept a disabled slab on a moving kinematic body in contact). */
export const carGroups = (i: number) => (carBit(i) << 16) | G_DOLLS | G_PROPS;
