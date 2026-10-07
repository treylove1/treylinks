export function attachVoice({ button, status, instruction, Recognition, now = () => Date.now(), schedule = setTimeout, cancel = clearTimeout }) {
  if (!Recognition) {
    button.disabled = true;
    status.textContent = "Voice input is not supported by this browser. Typing still works.";
    return { stop() {} };
  }

  const LIMIT = 10 * 60 * 1000;
  let active = false, finishing = false, generation = 0, started = 0, confirmed = "", recognition = null;
  let restartTimer = null, limitTimer = null;
  const joinWords = (...parts) => parts.map((part) => part.trim()).filter(Boolean).join(" ");
  const render = (interim = "") => { instruction.value = joinWords(confirmed, interim); };
  const normalized = (word) => word.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  function cleanRecognized(transcript) {
    const words = String(transcript || "").trim().split(/\s+/).filter(Boolean);
    return words.filter((word, index) => index === 0 || !normalized(word) || normalized(word) !== normalized(words[index - 1])).join(" ");
  }
  // Mobile speech services can replay words across final/interim segments and
  // across recognition restarts. Keep a single copy at those segment edges.
  function mergeOverlap(base, incoming, minimum = 1) {
    const previous = base.trim().split(/\s+/).filter(Boolean);
    const next = incoming.trim().split(/\s+/).filter(Boolean);
    let overlap = 0;
    for (let count = Math.min(previous.length, next.length); count >= minimum; count--) {
      if (previous.slice(-count).every((word, index) => normalized(word) === normalized(next[index]))) {
        overlap = count;
        break;
      }
    }
    return joinWords(base, next.slice(overlap).join(" "));
  }

  function stop(message = "Voice instruction captured. Review it, then press Start Work.", preserveEdit = false, acceptLateFinal = true) {
    if (!active) return;
    active = false;
    finishing = !preserveEdit && acceptLateFinal;
    if (!finishing) generation++;
    cancel(restartTimer);
    cancel(limitTimer);
    if (!preserveEdit) render();
    try { recognition?.stop(); } catch {}
    button.classList.remove("listening");
    button.textContent = "MIC";
    status.textContent = message;
  }

  function listen(restarted = false) {
    if (!active) return;
    if (now() - started >= LIMIT) return stop("Ten-minute voice limit reached. Your words were saved.", false, false);
    const current = ++generation;
    const base = confirmed;
    const engine = new Recognition();
    recognition = engine;
    engine.lang = "en-US";
    engine.interimResults = true;
    engine.continuous = true;
    engine.onstart = () => {
      if (active && current === generation) {
        button.classList.add("listening");
        button.textContent = "STOP";
        status.textContent = `Listening… up to 10 minutes. Tap STOP when finished.`;
      }
    };
    engine.onresult = (event) => {
      if ((!active && !finishing) || current !== generation) return;
      let final = "", interim = "";
      // SpeechRecognition resends earlier results. Reconstruct this run rather than appending each event.
      for (const result of event.results) {
        const words = cleanRecognized(result[0].transcript);
        if (result.isFinal) final = mergeOverlap(final, words);
        else interim = mergeOverlap(interim, words);
      }
      confirmed = restarted ? mergeOverlap(base, final, 1) : joinWords(base, final);
      instruction.value = mergeOverlap(confirmed, interim);
    };
    engine.onerror = (event) => {
      if (current !== generation) return;
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error))
        stop("Microphone is unavailable or permission was denied. Your confirmed words were saved.", false, false);
      else if (active) status.textContent = "Microphone paused; reconnecting while your confirmed words remain saved.";
    };
    engine.onend = () => {
      if (current !== generation) return;
      if (finishing) {
        finishing = false;
        generation++;
        render();
        return;
      }
      if (!active) return;
      render(); // Discard unconfirmed interim text on browser restart.
      if (now() - started >= LIMIT) return stop("Ten-minute voice limit reached. Your words were saved.", false, false);
      restartTimer = schedule(() => listen(true), 150);
    };
    try { engine.start(); } catch {
      stop("Microphone could not start. Your confirmed words were saved.", false, false);
    }
  }

  button.addEventListener("click", () => {
    if (active) return stop();
    finishing = false;
    active = true;
    confirmed = instruction.value.trim();
    started = now();
    limitTimer = schedule(() => stop("Ten-minute voice limit reached. Your words were saved.", false, false), LIMIT);
    listen();
  });
  instruction.addEventListener("input", () => {
    if (active) stop("Voice stopped so you can edit the instruction. Tap MIC to continue.", true);
  });
  return { stop };
}
