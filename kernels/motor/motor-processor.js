
/*
 * Copyright (c) 2021-2022 Antonio-R1
 * License: https://github.com/Antonio-R1/engine-sound-generator/blob/main/LICENSE | MIT
 * Modified for crash-deformer-test: no per-block allocation, lazy init, silent fast path.
 */

var SoundGeneratorWasm = Module;

class AllocatedArray {
   constructor (ptr = null, length = 0) {
      this.ptr = ptr;
      this.length = length;
   }
}

class EngineSoundGenerator extends AudioWorkletProcessor {

   constructor (options) {
      super ();

      this.throttleArray = new AllocatedArray();
      this.rpmArray = new AllocatedArray();

      this.channelIntakeArray = new AllocatedArray();
      this.channelEngineBlockVibrationsArray = new AllocatedArray();
      this.channelOutletArray = new AllocatedArray();

      // processorOptions is the voice's first tuning. The lengths of the waveguides are specified in samples.
      // The generator is built in process(): embind registers the class only after the async wasm init.
      this.processorOptions = options.processorOptions;
      this.pendingMessage = null;
      // Upstream's C++ never frees a waveguide (DelayLine and Muffler have empty destructors), so every construct or
      // updateParameters call strands 10-25 KB of the fixed 16 MB heap that every voice shares (~730 re-tunes abort it).
      // A tuning is built once per voice and kept (message JSON -> generator); a re-tune swaps one in.
      // The tunings are a closed set (class x damage tone = 15), so about 1.5 MB for six voices.
      this.generators = new Map ();
      this.soundGenerator = null;
      this.layers = new VoiceLayers ();

      this.port.onmessage = (event) => {
         if (this.soundGenerator === null) {
            this.pendingMessage = event.data;
         } else {
            this.applyMessage (event.data);
         }
      };
   }

   construct () {
      let o = this.processorOptions;

      // Same keys, same order as a tone message (motor-tone.ts): the options' tuning is the cached one when the same message arrives.
      // A pending message is the tuning the voice wants now; building the options' one first would only strand a generator.
      this.applyMessage (this.pendingMessage || {
         "cylinder_count": o.cylinders,
         "intake_waveguide_length": o.intakeWaveguideLength, "exhaust_waveguide_length": o.exhaustWaveguideLength,
         "extractor_waveguide_length": o.extractorWaveguideLength,
         "intake_open_reflection_factor": o.intakeOpenReflectionFactor, "intake_closed_reflection_factor": o.intakeClosedReflectionFactor,
         "exhaust_open_reflection_factor": o.exhaustOpenReflectionFactor, "exhaust_closed_reflection_factor": o.exhaustClosedReflectionFactor,
         "ignition_time": o.ignitionTime,
         "straight_pipe_waveguide_length": o.straightPipeWaveguideLength, "straight_pipe_reflection_factor": o.straightPipeReflectionFactor,
         "muffler_elements_length": o.mufflerElementsLength, "action": o.action,
         "outlet_waveguide_length": o.outletWaveguideLength, "outlet_reflection_factor": o.outletReflectionFactor,
         "dsp": o.dsp
      });
      this.pendingMessage = null;
   }

   applyMessage (parameters) {
      let key = JSON.stringify (parameters);
      let generator = this.generators.get (key);
      if (generator === undefined) {
         let mufflerElementsLength = parameters["muffler_elements_length"] || [10, 15, 20, 25];
         let ptr = SoundGeneratorWasm._malloc (mufflerElementsLength.length*4);
         SoundGeneratorWasm.HEAPU32.set (mufflerElementsLength, ptr/4);

         generator = new SoundGeneratorWasm.EngineSoundGenerator (sampleRate,
                     parameters["cylinder_count"],

                     parameters["intake_waveguide_length"], parameters["exhaust_waveguide_length"],
                     parameters["extractor_waveguide_length"],

                     parameters["intake_open_reflection_factor"], parameters["intake_closed_reflection_factor"],

                     parameters["exhaust_open_reflection_factor"], parameters["exhaust_closed_reflection_factor"], parameters["ignition_time"],

                     parameters["straight_pipe_waveguide_length"], parameters["straight_pipe_reflection_factor"],

                     ptr, mufflerElementsLength.length, parameters["action"],

                     parameters["outlet_waveguide_length"], parameters["outlet_reflection_factor"]);
         SoundGeneratorWasm._free (ptr); // the C++ copies the lengths, it keeps no pointer
         this.generators.set (key, generator);
      }
      this.soundGenerator = generator;
      this.layers.configure (parameters["dsp"]);
   }

   static get parameterDescriptors () {
      // throttle is the engine load (0..1); shift is a k-rate trigger the shift thump fires on.
      return [
         { name: 'throttle', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: 'a-rate' },
         { name: 'rpm', defaultValue: 0.0, minValue: 0.0, automationRate: 'a-rate' },
         { name: 'shift', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' }
      ];
   }

   allocateArray (allocatedArray, typedArray) {
      if (allocatedArray.length<typedArray.length) {
         if (allocatedArray.ptr) {
            SoundGeneratorWasm._free(allocatedArray.ptr);
         }
         allocatedArray.ptr = SoundGeneratorWasm._malloc(typedArray.length*typedArray.BYTES_PER_ELEMENT);
         allocatedArray.length = typedArray.length;
      }
   }

   setArray (allocatedArray, typedArray) {
      this.allocateArray (allocatedArray, typedArray);
      SoundGeneratorWasm.HEAPF32.set (typedArray, allocatedArray.ptr/SoundGeneratorWasm.HEAPF32.BYTES_PER_ELEMENT);
   }

   setChannelOutput (channel, allocatedArray) {
      // HEAPF32 is re-read here: a memory growth swaps the view. subarray shares memory, so nothing is allocated but the view.
      let heap = SoundGeneratorWasm.HEAPF32;
      let start = allocatedArray.ptr/heap.BYTES_PER_ELEMENT;
      channel.set(heap.subarray(start, start+allocatedArray.length));
   }

   process (inputList, outputList, parameters) {
      let channelIntake = outputList[0][0];
      let channelEngineBlockVibrations = outputList[1][0];
      let channelOutlet = outputList[2][0];

      if (typeof SoundGeneratorWasm.EngineSoundGenerator !== "function") {
         channelIntake.fill(0);
         channelEngineBlockVibrations.fill(0);
         channelOutlet.fill(0);
         return true;
      }
      if (this.soundGenerator === null) {
         this.construct ();
      }

      let rpm = parameters["rpm"];
      if (rpm[0] < 1 && rpm[rpm.length-1] < 1) {
         channelIntake.fill(0);
         channelEngineBlockVibrations.fill(0);
         channelOutlet.fill(0);
         return true;
      }

      this.setArray (this.throttleArray, parameters["throttle"]);
      this.setArray (this.rpmArray, rpm);
      this.allocateArray (this.channelIntakeArray, channelIntake);
      this.allocateArray (this.channelEngineBlockVibrationsArray, channelEngineBlockVibrations);
      this.allocateArray (this.channelOutletArray, channelOutlet);

      this.soundGenerator.generateSound (currentFrame, sampleRate,
                   this.rpmArray.ptr, rpm.length,
                   this.throttleArray.ptr, parameters["throttle"].length,
                   this.channelIntakeArray.ptr, this.channelIntakeArray.length,
                   this.channelEngineBlockVibrationsArray.ptr, this.channelEngineBlockVibrationsArray.length,
                   this.channelOutletArray.ptr, this.channelOutletArray.length);

      this.setChannelOutput (channelIntake, this.channelIntakeArray);
      this.setChannelOutput (channelEngineBlockVibrations, this.channelEngineBlockVibrationsArray);
      this.setChannelOutput (channelOutlet, this.channelOutletArray);
      this.layers.process (channelIntake, channelEngineBlockVibrations, channelOutlet, rpm, parameters["throttle"], parameters["shift"][0]);

      return true;
   }

}

registerProcessor("engine-sound-processor", EngineSoundGenerator)
