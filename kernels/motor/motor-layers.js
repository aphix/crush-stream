
// Voice layers on top of the wasm generator's three channels: firing-locked body thump, load-driven shaping of exhaust and intake,
// induction whine, off-load pops and the gear-shift thump. Plain classes; process() allocates nothing (configure() builds a fixed-shape tuning per retune).

// The context's rate, read once: a global lookup per sample is slow in a worklet.
const SR = sampleRate;
// Lexical bindings, not global lookups: the per-sample code calls these millions of times a second.
const m_sin = Math.sin, m_sqrt = Math.sqrt, m_cos = Math.cos, m_exp = Math.exp, m_floor = Math.floor, m_max = Math.max, m_min = Math.min;
const TWO_PI = Math.PI * 2;
// The generator's channels swing about this far; the shapers treat it as full scale.
const SHAPER_REF = 2;
// Body thump strength at no load, as a share of full load.
const IDLE_KICK = 0.45;
// A strike's pitch falls back to the body frequency over this long (s).
const PITCH_DROP_S = 0.03;
// An envelope under this is silence: it is zeroed (no subnormals) and its oscillator is not run.
const SILENT = 1e-6;
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

const softClip = (x) => {
   if (x > 3) return 1;
   if (x < -3) return -1;
   let x2 = x*x;
   return x*(27+x2)/(27+9*x2);
};

const decayPerSample = (seconds) => {
   return m_exp (-1/(m_max (seconds, 1e-4)*SR));
};

const clamp01 = (x) => {
   return x < 0 ? 0 : x > 1 ? 1 : x;
};

class Noise {
   constructor (seed) {
      this.state = seed | 0 || 1;
   }

   // xorshift32 kept in int32 (an unsigned state would be a heap number per call).
   next () {
      let s = this.state;
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      this.state = s;
      return s*4.656612873077393e-10;
   }
}

// The class tuning as a plain object of fixed shape: a message's own object has dozens of properties and reads slowly.
class Tuning {
   constructor (d) {
      this.cylinders = d.cylinders;
      this.idleRpm = d.idleRpm;
      this.redlineRpm = d.redlineRpm;
      this.bodyHz = d.bodyHz;
      this.bodyDrop = d.bodyDrop;
      this.bodyTauS = d.bodyTauS;
      this.bodyGain = d.bodyGain;
      this.blockDrive = d.blockDrive;
      this.blockDriveLoad = d.blockDriveLoad;
      this.lope = d.lope;
      this.exhaustGain = d.exhaustGain;
      this.exhaustGainLoad = d.exhaustGainLoad;
      this.exhaustDrive = d.exhaustDrive;
      this.exhaustDriveLoad = d.exhaustDriveLoad;
      this.intakeGain = d.intakeGain;
      this.intakeGainLoad = d.intakeGainLoad;
      this.intakeDrive = d.intakeDrive;
      this.intakeDriveLoad = d.intakeDriveLoad;
      this.suckGain = d.suckGain;
      this.barkGain = d.barkGain;
      this.barkHz = d.barkHz;
      this.whineHz = d.whineHz;
      this.whineSpan = d.whineSpan;
      this.whineCrank = d.whineCrank;
      this.whineGain = d.whineGain;
      this.boostRiseS = d.boostRiseS;
      this.boostFallS = d.boostFallS;
      this.blowoffGain = d.blowoffGain;
      this.burbleRate = d.burbleRate;
      this.popGain = d.popGain;
      this.popHz = d.popHz;
      this.liftPops = d.liftPops;
      this.shiftHz = d.shiftHz;
      this.shiftTauS = d.shiftTauS;
      this.shiftGain = d.shiftGain;
      this.clickGain = d.clickGain;
   }
}

// out = REF*softClip(k1*x)/sqrt(drive) with k1 = drive*gain/REF and k2 = REF/sqrt(drive): the load's gain and drive, worked out once a block.
const squash = (x, k1, k2) => {
   return k2*softClip (k1*x);
};

// A two-pole resonance: noise in, a ringing band out.
class Resonator {
   constructor () {
      this.y1 = 0;
      this.y2 = 0;
   }

   configure (hz, radius) {
      this.a1 = -2*radius*m_cos (TWO_PI*hz/SR);
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
      for (let k = 0; k < 16; k++) this.cylinderGain[k] = 1 - c.lope*0.5*(1 + m_sin (k*2.399));
   }

   strike (load) {
      this.struck = (this.struck + 1) % m_max (1, m_min (16, this.c.cylinders));
      this.lastStrike = this.cylinderGain[this.struck];
      this.env = this.lastStrike*this.c.bodyGain*(IDLE_KICK + (1 - IDLE_KICK)*load);
      this.pitch = 1;
      this.osc = 0;
   }

   tick (firingHz, load) {
      let c = this.c;
      this.lastStrike = 0;
      this.phase += firingHz/SR;
      if (this.phase >= 1) {
         this.phase -= m_floor (this.phase);
         this.strike (load);
      }
      this.env *= this.decay;
      if (this.env < SILENT) {
         this.env = 0;
         return 0;
      }
      this.pitch *= this.pitchDecay;
      this.osc += c.bodyHz*(1 + c.bodyDrop*this.pitch)/SR;
      if (this.osc >= 1) this.osc -= 1;
      return this.env*m_sin (TWO_PI*this.osc);
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
      if (strike > 0) this.env = this.c.barkGain*strike*load*m_sqrt (load);
      this.env *= this.decay;
      if (this.env < SILENT) {
         this.env = 0;
         return 0;
      }
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
      let target = load*(0.25 + 0.75*revs);
      this.boost += (target - this.boost)*(target > this.boost ? this.rise : this.fall);
      if (this.boost < SILENT) this.boost = 0;
      return this.whine (rpm) + this.burst (hiss);
   }

   whine (rpm) {
      let c = this.c;
      if (c.whineGain <= 0 || this.boost === 0) return 0;
      let hz = c.whineHz + c.whineSpan*this.boost + c.whineCrank*rpm/60;
      this.whinePhase += m_min (hz, SR*0.45)/SR;
      if (this.whinePhase >= 1) this.whinePhase -= 1;
      let tone = m_sin (TWO_PI*this.whinePhase) + 0.25*m_sin (2*TWO_PI*this.whinePhase);
      return c.whineGain*this.boost*m_sqrt (this.boost)*tone;
   }

   burst (hiss) {
      this.blowoff *= this.blowoffDecay;
      if (this.blowoff < SILENT) {
         this.blowoff = 0;
         return 0;
      }
      this.flutter += BLOWOFF_FLUTTER_HZ/SR;
      if (this.flutter >= 1) this.flutter -= 1;
      let burst = (hiss - this.previous)*this.blowoff*this.c.blowoffGain*(0.6 + 0.4*m_sin (TWO_PI*this.flutter));
      this.previous = hiss;
      return burst;
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
         this.wait = (0.04 + 0.06*random)*SR;
      }
   }

   spawn (overrun, lift, random) {
      if (overrun <= 0) {
         this.followUps = 0;
         return;
      }
      if (this.followUps > 0 && --this.wait <= 0) return this.pop (0.5 + 0.5*random);
      let rate = this.c.burbleRate*overrun*(1 + this.c.liftPops*lift);
      if (random*0.5 + 0.5 < rate/SR) this.pop (random*0.5 + 0.5);
   }

   tick (overrun, lift, noise, random) {
      this.spawn (overrun, lift, random);
      this.env *= this.decay;
      if (this.env < SILENT) {
         this.env = 0;
         return 0;
      }
      let y = 3*this.ring.run (noise);
      this.phase += this.hz*(0.6 + 0.4*this.env/m_max (this.c.popGain, 1e-6))/SR;
      if (this.phase >= 1) this.phase -= 1;
      return this.env*(y + 0.8*m_sin (TWO_PI*this.phase));
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
      this.click *= this.clickDecay;
      if (this.env < SILENT && this.click < SILENT) {
         this.env = 0;
         this.click = 0;
         return 0;
      }
      this.pitch *= this.pitchDecay;
      this.phase += this.c.shiftHz*(1 + SHIFT_DROP*this.pitch)/SR;
      if (this.phase >= 1) this.phase -= 1;
      return this.env*m_sin (TWO_PI*this.phase) + this.click*noise;
   }
}

// The pedal's lift-off: armed by a hard push, fired by the fall, held as a window the pops lean on.
class LiftDetector {
   constructor () {
      this.armed = false;
      this.window = 0;
   }

   update (load, seconds) {
      this.window = m_max (0, this.window - seconds/LIFT_WINDOW_S);
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
      this.ik1 = this.ik2 = this.ok1 = this.ok2 = this.bk1 = this.bk2 = 0;
      this.breathK = this.overrun = this.load = this.revs = 0;
   }

   configure (d) {
      let c = new Tuning (d);
      this.c = c;
      this.body.configure (c);
      this.induction.configure (c);
      this.offLoad.configure (c);
      this.bark.configure (c);
      this.shift.configure (c);
   }

   // The pedal's load shapes the saturators and the breath: worked out once a block, as the load moves slowly against 128 samples.
   prepare (load, revs) {
      let c = this.c;
      this.load = load;
      this.revs = revs;
      let drive = c.intakeDrive + c.intakeDriveLoad*load;
      this.ik1 = drive*(c.intakeGain + c.intakeGainLoad*load)/SHAPER_REF;
      this.ik2 = SHAPER_REF/m_sqrt (drive);
      drive = c.exhaustDrive + c.exhaustDriveLoad*load;
      this.ok1 = drive*(c.exhaustGain + c.exhaustGainLoad*load)/SHAPER_REF;
      this.ok2 = SHAPER_REF/m_sqrt (drive);
      drive = c.blockDrive + c.blockDriveLoad*load;
      this.bk1 = drive/SHAPER_REF;
      this.bk2 = SHAPER_REF/m_sqrt (drive);
      this.breathK = c.suckGain*load*m_sqrt (load)*(0.3 + 0.7*revs);
      this.overrun = clamp01 ((OVERRUN_LOAD - load)/OVERRUN_LOAD)*clamp01 ((revs - OVERRUN_REVS)/OVERRUN_REVS);
   }

   // One block: `rpm` and `throttle` are the a-rate params (the load, 0..1), `shiftValue` the k-rate shift trigger.
   process (intake, block, outlet, rpm, throttle, shiftValue) {
      let c = this.c;
      if (c === null) return;
      this.shift.trigger (shiftValue);
      let load = clamp01 (throttle[throttle.length - 1]);
      if (this.liftDetector.update (load, intake.length/SR)) this.induction.lift ();
      let last = rpm[rpm.length - 1];
      this.prepare (load, clamp01 ((last - c.idleRpm)/(c.redlineRpm - c.idleRpm)));
      let moving = rpm.length > 1;
      for (let i = 0; i < intake.length; i++) this.sample (intake, block, outlet, i, moving ? rpm[i] : last);
   }

   sample (intake, block, outlet, i, rpm) {
      let c = this.c;
      let white = this.noise.next ();
      let grit = this.noise.next ();
      let breath = 0;
      if (this.breathK !== 0) {
         this.suck += SUCK_SMOOTH*(white - this.suck);
         breath = this.breathK*this.suck;
      }
      intake[i] = squash (intake[i], this.ik1, this.ik2) + breath + this.induction.tick (rpm, this.revs, this.load, grit);
      let thump = this.body.tick (rpm/60*c.cylinders/2, this.load) + this.shift.tick (white);
      block[i] = squash (block[i] + thump, this.bk1, this.bk2);
      outlet[i] = squash (outlet[i], this.ok1, this.ok2) + this.bark.tick (this.body.lastStrike, this.load, grit) + this.offLoad.tick (this.overrun, this.liftDetector.window, grit, this.noise.next ());
   }
}
