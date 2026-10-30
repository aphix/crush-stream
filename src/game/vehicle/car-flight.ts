import { HIT_SIZE } from "../world/surfaces.ts";

/** Where a `DeformableCar.flight` block holds each part: spin (3), pitch, yaw, roll (3), orientation quaternion (4), velocity (3), position (3), contact-end clocks (2), reach, squeeze flag, drift, the weight borne on it by cars that stepped after it (6: `CarSurfaces.borneState`), what its wheels touch (`FLIGHT_CONTACT`: each wheel's contact, the wheels down, airborne, hard touch, yielding), a wreck's hub rise (`hubRise`, 5), its yaw inverse inertia (`invYaw`), its rest timer (`restS`: at `WRECK_REST_S` it sleeps), the handbrake's grip and whether the boost was on (`drive.ebrakeK`, `drive.boostK`), the driven wheels' spin (`drive.spinSpeed`), where a sleeping wreck fell asleep (`sleepX`, `sleepZ`), and each drawn wheel's turn and rate about its axle (`wheelSpin`, `wheelRate`, 4 each). */
export const FLIGHT_EULER = 3;
export const FLIGHT_QUATERNION = 6;
export const FLIGHT_VELOCITY = 10;
export const FLIGHT_POSITION = 13;
export const FLIGHT_END_AGO = 16;
export const FLIGHT_END_REACH = 18;
export const FLIGHT_END_SQUEEZE = 19;
export const FLIGHT_DRIFT = 20;
export const FLIGHT_BORNE = 21;
export const FLIGHT_CONTACT = 27;
export const FLIGHT_DOWN = FLIGHT_CONTACT + 4 * HIT_SIZE;
export const FLIGHT_INV_YAW = FLIGHT_DOWN + 4;
export const FLIGHT_REST = FLIGHT_INV_YAW + 1;
export const FLIGHT_RAMPS = FLIGHT_REST + 1;
/** The driven wheels' spin (`drive.spinSpeed`, m/s): state a spin builds and fades over, so a replay restores it with the ramps. */
export const FLIGHT_SPIN = FLIGHT_RAMPS + 2;
/** Where a sleeper fell asleep (`sleepX`, `sleepZ`): what `stirNear` asks about; a steer turning the sleeper about its masses' centre (`applyDrive`) moves its body off it. */
export const FLIGHT_SLEEP = FLIGHT_SPIN + 1;
/** Each drawn wheel's turn about its axle (`wheelSpin`, 4), then its rate (`wheelRate`, 4): a popped wheel leaves at its drawn turn (`dropWheel`). */
export const FLIGHT_WHEEL_SPIN = FLIGHT_SLEEP + 2;
export const FLIGHT_WHEEL_RATE = FLIGHT_WHEEL_SPIN + 4;
export const FLIGHT = FLIGHT_WHEEL_RATE + 4;
