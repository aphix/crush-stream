
// Voice layers on top of the wasm generator's three channels: firing-locked body thump, load-driven shaping of exhaust and intake,
// induction whine, off-load pops and the gear-shift thump. Plain classes; nothing allocates after construction.

const TWO_PI = Math.PI * 2;
// The generator's channels swing about this far; the shapers treat it as full scale.
const SHAPER_REF = 2;
// Body thump strength at no load, as a share of full load.
const IDLE_KICK = 0.45;
// A strike's pitch falls back to the body frequency over this long (s).
const PITCH_DROP_S = 0.03;
const POP_TAU_S = 0.014;
const POP_RESONANCE = 0.92;
// The exhaust crack's decay, the sharpness of its resonance, and the level that makes a unit of `barkGain` as loud as a unit of thump.
const BARK_TAU_S = 0.007;
const BARK_RESONANCE = 0.9;
const BARK_MAKEUP = 0.7;
// A lift needs the load to have been above ARM and then fall under FIRE.
const LIFT_ARM = 0.7;
const LIFT_FIRE = 0.45;
const LIFT_WINDOW_S = 1;
const OVERRUN_LOAD = 0.25;
const OVERRUN_REVS = 0.3;
const BLOWOFF_TAU_S = 0.28;
const BLOWOFF_FLUTTER_HZ = 17;
const CLICK_TAU_S = 0.008;
const SHIFT_DROP = 0.6;
const SHIFT_BELOW_S = 0.02;
const SUCK_SMOOTH = 0.12;

function softClip (x) {
   if (x > 3) return 1;
   if (x < -3) return -1;
   let x2 = x*x;
   return x*(27+x2)/(27+9*x2);
}

function decayPerSample (seconds) {
   return Math.exp (-1/(Math.max (seconds, 1e-4)*sampleRate));
}

function clamp01 (x) {
   return x < 0 ? 0 : x > 1 ? 1 : x;
}

class Noise {
   constructor (seed) {
      this.state = seed >>> 0 || 1;
   }

   next () {
      let s = this.state;
      s = (s ^ (s << 13)) >>> 0;
      s = (s ^ (s >>> 17)) >>> 0;
      s = (s ^ (s << 5)) >>> 0;
      this.state = s;
      return s/2147483648 - 1;
   }
}

// Gain, then a drive that grows with load: the louder the pedal, the denser the saturation.
function shape (x, gain, drive) {
   return SHAPER_REF*softClip (drive*gain*x/SHAPER_REF)/Math.sqrt (drive);
}

// A two-pole resonance: noise in, a ringing band out.
class Resonator {
   constructor () {
      this.y1 = 0;
      this.y2 = 0;
   }

   configure (hz, radius) {
      this.a1 = -2*radius*Math.cos (TWO_PI*hz/sampleRate);
      this.a2 = radius*radius;
      this.gain = 1 - radius;
   }

   run (x) {
      let y = this.gain*x - this.a1*this.y1 - this.a2*this.y2;
      this.y2 = this.y1;
      this.y1 = y;
      return y;
   }
}

// One decaying sine, struck at every firing: the block's thump, locked to the firing frequency, its pitch dropping at each strike.
class FiringBody {
   constructor () {
      this.phase = 0;
      this.osc = 0;
      this.lastStrike = 0;
      this.struck = 0;
      this.env = 0;
      this.pitch = 0;
      this.cylinderGain = new Float64Array (16).fill (1);
   }

   configure (c) {
      this.c = c;
      this.decay = decayPerSample (c.bodyTauS);
      this.pitchDecay = decayPerSample (PITCH_DROP_S);
      for (let k = 0; k < 16; k++) this.cylinderGain[k] = 1 - c.lope*0.5*(1 + Math.sin (k*2.399));
   }

   strike (load) {
      this.struck = (this.struck + 1) % Math.max (1, Math.min (16, this.c.cylinders));
      this.lastStrike = this.cylinderGain[this.struck];
      this.env = this.lastStrike*this.c.bodyGain*(IDLE_KICK + (1 - IDLE_KICK)*load);
      this.pitch = 1;
      this.osc = 0;
   }

   tick (firingHz, load) {
      let c = this.c;
      this.lastStrike = 0;
      this.phase += firingHz/sampleRate;
      if (this.phase >= 1) {
         this.phase -= Math.floor (this.phase);
         this.strike (load);
      }
      this.env *= this.decay;
      this.pitch *= this.pitchDecay;
      this.osc += c.bodyHz*(1 + c.bodyDrop*this.pitch)/sampleRate;
      if (this.osc >= 1) this.osc -= 1;
      return this.env*Math.sin (TWO_PI*this.osc);
   }
}

// The exhaust's crack at every firing: a short burst of noise through a resonance, harder on the pedal, locked to the firing like the thump.
class ExhaustBark {
   constructor () {
      this.env = 0;
      this.ring = new Resonator ();
   }

   configure (c) {
      this.c = c;
      this.decay = decayPerSample (BARK_TAU_S);
      this.ring.configure (c.barkHz, BARK_RESONANCE);
   }

   // `strike` is the firing's strength (0 between firings).
   tick (strike, load, noise) {
      if (strike > 0) this.env = this.c.barkGain*strike*load*Math.sqrt (load);
      this.env *= this.decay;
      return this.env*BARK_MAKEUP*this.ring.run (noise);
   }
}

// Turbo or supercharger: a whine that follows boost (load times revs, with lag), and a blow-off hiss when the pedal lifts.
class Induction {
   constructor () {
      this.boost = 0;
      this.whinePhase = 0;
      this.flutter = 0;
      this.blowoff = 0;
      this.previous = 0;
   }

   configure (c) {
      this.c = c;
      this.rise = 1 - decayPerSample (c.boostRiseS);
      this.fall = 1 - decayPerSample (c.boostFallS);
      this.blowoffDecay = decayPerSample (BLOWOFF_TAU_S);
   }

   lift () {
      if (this.boost > 0.35) this.blowoff = this.boost;
   }

   tick (rpm, revs, load, hiss) {
      let c = this.c;
      let target = load*(0.25 + 0.75*revs);
      this.boost += (target - this.boost)*(target > this.boost ? this.rise : this.fall);
      let hz = c.whineHz + c.whineSpan*this.boost + c.whineCrank*rpm/60;
      this.whinePhase += Math.min (hz, sampleRate*0.45)/sampleRate;
      if (this.whinePhase >= 1) this.whinePhase -= 1;
      let tone = Math.sin (TWO_PI*this.whinePhase) + 0.25*Math.sin (2*TWO_PI*this.whinePhase);
      let whine = c.whineGain*this.boost*Math.sqrt (this.boost)*tone;
      this.blowoff *= this.blowoffDecay;
      this.flutter += BLOWOFF_FLUTTER_HZ/sampleRate;
      if (this.flutter >= 1) this.flutter -= 1;
      let burst = (hiss - this.previous)*this.blowoff*c.blowoffGain*(0.6 + 0.4*Math.sin (TWO_PI*this.flutter));
      this.previous = hiss;
      return whine + burst;
   }
}

// Overrun: pops and burbles in the exhaust while the engine is driven by the wheels, more of them in the second after a lift.
class OffLoad {
   constructor () {
      this.env = 0;
      this.phase = 0;
      this.ring = new Resonator ();
      this.followUps = 0;
      this.wait = 0;
      this.hz = 0;
   }

   configure (c) {
      this.c = c;
      this.decay = decayPerSample (POP_TAU_S);
      this.ring.configure (c.popHz, POP_RESONANCE);
   }

   pop (random) {
      this.env = this.c.popGain*(0.5 + 0.5*random);
      this.hz = this.c.popHz*(0.7 + 0.6*random);
      this.phase = 0;
      if (random > 0.4 && this.followUps < 3) {
         this.followUps++;
         this.wait = (0.04 + 0.06*random)*sampleRate;
      }
   }

   spawn (overrun, lift, random) {
      if (overrun <= 0) {
         this.followUps = 0;
         return;
      }
      if (this.followUps > 0 && --this.wait <= 0) return this.pop (0.5 + 0.5*random);
      let rate = this.c.burbleRate*overrun*(1 + this.c.liftPops*lift);
      if (random*0.5 + 0.5 < rate/sampleRate) this.pop (random*0.5 + 0.5);
   }

   tick (overrun, lift, noise, random) {
      this.spawn (overrun, lift, random);
      this.env *= this.decay;
      let y = 3*this.ring.run (noise);
      this.phase += this.hz*(0.6 + 0.4*this.env/Math.max (this.c.popGain, 1e-6))/sampleRate;
      if (this.phase >= 1) this.phase -= 1;
      return this.env*(y + 0.8*Math.sin (TWO_PI*this.phase));
   }
}

// The gearbox: a low thump dropping in pitch and a short click, struck by the shift trigger.
class ShiftThump {
   constructor () {
      this.env = 0;
      this.pitch = 0;
      this.phase = 0;
      this.click = 0;
      this.armed = true;
   }

   configure (c) {
      this.c = c;
      this.decay = decayPerSample (c.shiftTauS);
      this.pitchDecay = decayPerSample (c.shiftTauS*0.4);
      this.clickDecay = decayPerSample (CLICK_TAU_S);
   }

   trigger (value) {
      let edge = value > SHIFT_BELOW_S;
      if (edge && this.armed) {
         this.env = value*this.c.shiftGain;
         this.click = value*this.c.clickGain;
         this.pitch = 1;
         this.phase = 0;
      }
      this.armed = !edge;
   }

   tick (noise) {
      this.env *= this.decay;
      this.pitch *= this.pitchDecay;
      this.click *= this.clickDecay;
      this.phase += this.c.shiftHz*(1 + SHIFT_DROP*this.pitch)/sampleRate;
      if (this.phase >= 1) this.phase -= 1;
      return this.env*Math.sin (TWO_PI*this.phase) + this.click*noise;
   }
}

// The pedal's lift-off: armed by a hard push, fired by the fall, held as a window the pops lean on.
class LiftDetector {
   constructor () {
      this.armed = false;
      this.window = 0;
   }

   update (load, seconds) {
      this.window = Math.max (0, this.window - seconds/LIFT_WINDOW_S);
      if (load > LIFT_ARM) this.armed = true;
      if (!this.armed || load >= LIFT_FIRE) return false;
      this.armed = false;
      this.window = 1;
      return true;
   }
}

class VoiceLayers {
   constructor () {
      this.c = null;
      this.noise = new Noise (0x9e3779b9);
      this.body = new FiringBody ();
      this.induction = new Induction ();
      this.offLoad = new OffLoad ();
      this.bark = new ExhaustBark ();
      this.shift = new ShiftThump ();
      this.liftDetector = new LiftDetector ();
      this.suck = 0;
   }

   configure (c) {
      this.c = c;
      this.body.configure (c);
      this.induction.configure (c);
      this.offLoad.configure (c);
      this.bark.configure (c);
      this.shift.configure (c);
   }

   // One block: `rpm` and `throttle` are the a-rate params (the load, 0..1), `shiftValue` the k-rate shift trigger.
   process (intake, block, outlet, rpm, throttle, shiftValue) {
      let c = this.c;
      if (c === null) return;
      let n = intake.length;
      this.shift.trigger (shiftValue);
      let lastLoad = clamp01 (throttle[Math.min (n - 1, throttle.length - 1)]);
      if (this.liftDetector.update (lastLoad, n/sampleRate)) this.induction.lift ();
      for (let i = 0; i < n; i++) {
         let revs = clamp01 ((rpm[Math.min (i, rpm.length - 1)] - c.idleRpm)/(c.redlineRpm - c.idleRpm));
         this.sample (intake, block, outlet, i, rpm[Math.min (i, rpm.length - 1)], revs, clamp01 (throttle[Math.min (i, throttle.length - 1)]));
      }
   }

   sample (intake, block, outlet, i, rpm, revs, load) {
      let c = this.c;
      let white = this.noise.next ();
      let overrun = clamp01 ((OVERRUN_LOAD - load)/OVERRUN_LOAD)*clamp01 ((revs - OVERRUN_REVS)/OVERRUN_REVS);
      this.suck += SUCK_SMOOTH*(white - this.suck);
      let breath = c.suckGain*this.suck*load*Math.sqrt (load)*(0.3 + 0.7*revs);
      let hiss = this.noise.next ();
      let intakeShaped = shape (intake[i], c.intakeGain + c.intakeGainLoad*load, c.intakeDrive + c.intakeDriveLoad*load);
      let outletShaped = shape (outlet[i], c.exhaustGain + c.exhaustGainLoad*load, c.exhaustDrive + c.exhaustDriveLoad*load);
      intake[i] = intakeShaped + breath + this.induction.tick (rpm, revs, load, hiss);
      let thump = this.body.tick (rpm/60*c.cylinders/2, load) + this.shift.tick (white);
      block[i] = shape (block[i] + thump, 1, c.blockDrive + c.blockDriveLoad*load);
      let bark = this.bark.tick (this.body.lastStrike, load, this.noise.next ());
      outlet[i] = outletShaped + bark + this.offLoad.tick (overrun, this.liftDetector.window, this.noise.next (), this.noise.next ());
   }
}
