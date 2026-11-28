import { describe, expect, it } from "vitest";
import { firstMismatch } from "../../kernel/compare-arrays.test-util.ts";
import { STIMULUS } from "../civilian-gaze.ts";
import { THINK, THOUGHT, Thought, VERDICT, readCall } from "./thought-tools.ts";

/** A completion as Needle writes one: a think line, then the call. */
const said = (call: string): string => `<think>Something is going on.</think><tool_call>${call}`;

describe("given a model's completion", () => {
  it("when it calls a tool that is not a thought, then the call is refused as unknown and the pick is untouched", () => {
    const pick = new Thought();
    pick.tool = THOUGHT.think_about;
    pick.arg = THINK.home;
    expect(readCall(said('{"name":"dance","arguments":{}}'), pick)).toBe(VERDICT.unknownTool);
    expect(firstMismatch([pick.tool, pick.arg], [THOUGHT.think_about, THINK.home]), "the pick").toBeUndefined();
  });

  it("when its argument is not one of the tool's closed values, then the call is refused for its arguments", () => {
    expect(readCall(said('{"name":"look_at","arguments":{"stimulus":"restaurant"}}'), new Thought())).toBe(VERDICT.badArgs);
  });

  it("when it passes an argument beyond the tool's one, or none to a tool that takes one, then the call is refused for its arguments", () => {
    expect(readCall(said('{"name":"look_at","arguments":{"stimulus":"car","time":"now"}}'), new Thought()), "an extra argument").toBe(VERDICT.badArgs);
    expect(readCall(said('{"name":"ignore","arguments":{"stimulus":"car"}}'), new Thought()), "an argument to ignore").toBe(VERDICT.badArgs);
    expect(readCall(said('{"name":"look_at","arguments":{}}'), new Thought()), "no argument").toBe(VERDICT.badArgs);
  });

  it("when its call is not whole JSON, then it is malformed", () => {
    expect(readCall(said('{"name":"look_at","arguments":{"stimulus":"car"'), new Thought())).toBe(VERDICT.malformed);
    expect(readCall("I would look at the car.", new Thought()), "no call at all").toBe(VERDICT.malformed);
  });

  it("when it answers an empty list, then it abstained", () => {
    expect(readCall(said("[]"), new Thought())).toBe(VERDICT.abstained);
  });

  it("when it lists two calls and is cut off inside the second, then the first is taken", () => {
    const pick = new Thought();
    expect(readCall(said('[{"name":"look_at","arguments":{"stimulus":"crash"}}, {"name":"remark_on","arguments":{"ev'), pick)).toBe(VERDICT.taken);
    expect(firstMismatch([pick.tool, pick.arg], [THOUGHT.look_at, STIMULUS.crash]), "the pick").toBeUndefined();
  });
});
