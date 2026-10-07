import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { attachVoice } from "./voice.js";

function element(value = "") {
  const handlers = new Map();
  const classes = new Set();
  return {
    value,
    textContent: "",
    disabled: false,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    addEventListener: (type, callback) => handlers.set(type, callback),
    trigger: (type) => handlers.get(type)?.(),
  };
}

function fixture() {
  let clock = 0;
  let id = 0;
  const timers = new Map();
  const instances = [];
  class Recognition {
    constructor() { instances.push(this); }
    start() { this.onstart?.(); }
    stop() {}
    result(...parts) {
      this.onresult?.({ results: parts.map(([transcript, isFinal]) => ({ 0: { transcript }, isFinal })) });
    }
    end() { this.onend?.(); }
  }
  const button = element();
  const status = element();
  const instruction = element("");
  attachVoice({
    button,
    status,
    instruction,
    Recognition,
    now: () => clock,
    schedule: (callback, delay) => {
      const key = ++id;
      timers.set(key, { callback, at: clock + delay });
      return key;
    },
    cancel: (key) => timers.delete(key),
  });
  const advance = (ms) => {
    const target = clock + ms;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      clock = due[1].at;
      timers.delete(due[0]);
      due[1].callback();
    }
    clock = target;
  };
  return { button, instruction, instances, advance };
}

test("live dictation does not duplicate interim/final words", () => {
  const f = fixture();
  f.button.trigger("click");
  f.instances[0].result(["okay", true], ["okay tell", false]);
  assert.equal(f.instruction.value, "okay tell");
  f.instances[0].result(["okay", true], ["tell", true], ["tell doubling up", false]);
  assert.equal(f.instruction.value, "okay tell doubling up");
  f.instances[0].result(["okay", true], ["tell", true], ["doubling up", true]);
  assert.equal(f.instruction.value, "okay tell doubling up");
});

test("live dictation does not duplicate speech after mobile recognition restart", () => {
  const f = fixture();
  f.button.trigger("click");
  f.instances[0].result(["create a website about dogs", true]);
  f.instances[0].end();
  f.advance(150);
  f.instances[1].result(["create a website about dogs with pictures", false]);
  assert.equal(f.instruction.value, "create a website about dogs with pictures");
  f.instances[1].result(["create a website about dogs with pictures", true]);
  assert.equal(f.instruction.value, "create a website about dogs with pictures");
});

test("live page uses the tested voice module and not the old append loop", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /import \{ attachVoice \} from "\.\/voice\.js"/);
  assert.doesNotMatch(html, /let\s+finalText\s*=/);
  assert.doesNotMatch(html, /stopDictate/);
});
