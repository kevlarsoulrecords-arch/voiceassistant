// ---------- Embedded-preview warning (no mic in the lab mini-browser) ----------
(function () {
    const inIframe = (function () {
      try { return window.self !== window.top; } catch { return true; }
    })();
    if (inIframe) {
      const banner = document.createElement('div');
      banner.style.cssText =
        "position:fixed;top:0;left:0;right:0;background:#fff3cd;color:#664d03;border-bottom:1px solid #ffeeba;padding:8px 12px;font:14px system-ui,sans-serif;z-index:9999;";
      banner.textContent =
        "Microphone is disabled in the embedded preview. Click the external-link icon to open in a new tab, then allow mic.";
      document.body.appendChild(banner);
      // nudge content down a bit so the banner doesn't overlap
      document.body.style.marginTop = "44px";
    }
  })();
  
  // ---------- Mic permission helpers ----------
  async function getMicPermissionStatus() {
    if (!navigator.permissions) return null; // not supported everywhere
    try {
      const res = await navigator.permissions.query({ name: "microphone" });
      return res.state; // "granted" | "denied" | "prompt"
    } catch {
      return null;
    }
  }
  
  async function startRecordingSafely() {
    const state = await getMicPermissionStatus();
    if (state === "denied") {
      alert(
        "Microphone permission is blocked for this site.\n" +
        "Click the lock icon → Site settings → Microphone: Allow, then reload."
      );
      return;
    }
    try {
      // Proactively prompt/verify then stop the temp stream immediately
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
  
      await toggleRecording(); // uses its own stream internally
      $(".fa-microphone").css("color", "#f44336");
      console.log("start recording");
      // toggleRecording sets 'recording = true'
    } catch (e) {
      alert("Could not access microphone: " + e.message);
    }
  }
  
  // ---------- NEW: load voices into the dropdown ----------
  async function loadVoices() {
    try {
      const res = await fetch(window.location.origin + "/voices");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const voices = await res.json(); // [{name, label, language}, ...]
      const sel = document.getElementById("voice-options");
      if (!sel) return;
  
      // Keep existing default option (if present), then append each voice
      voices.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v.name; // e.g., "en-US_MichaelV3Voice"
        opt.textContent = `${v.label} (${v.language})`;
        sel.appendChild(opt);
      });
    } catch (e) {
      console.warn("Failed to load voices:", e);
    }
  }
  
  // ---------- Existing app code ----------
  let lightMode = true;
  let recorder = null;
  let recording = false;
  let voiceOption = "default";
  const responses = [];
  const botRepeatButtonIDToIndexMap = {};
  const userRepeatButtonIDToRecordingMap = {};
  const baseUrl = window.location.origin;
  
  async function showBotLoadingAnimation() {
    await sleep(500);
    if ($(".loading-animation")[1]) {
      $(".loading-animation")[1].style.display = "inline-block";
    }
  }
  
  function hideBotLoadingAnimation() {
    if ($(".loading-animation")[1]) {
      $(".loading-animation")[1].style.display = "none";
    }
  }
  
  async function showUserLoadingAnimation() {
    await sleep(100);
    if ($(".loading-animation")[0]) {
      $(".loading-animation")[0].style.display = "flex";
    }
  }
  
  function hideUserLoadingAnimation() {
    if ($(".loading-animation")[0]) {
      $(".loading-animation")[0].style.display = "none";
    }
  }
  
  const getSpeechToText = async (userRecording) => {
    let response = await fetch(baseUrl + "/speech-to-text", {
      method: "POST",
      body: userRecording.audioBlob,
    });
    console.log(response);
    response = await response.json();
    console.log(response);
    return response.text;
  };
  
  const processUserMessage = async (userMessage) => {
    let response = await fetch(baseUrl + "/process-message", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ userMessage: userMessage, voice: voiceOption }),
    });
    response = await response.json();
    console.log(response);
    return response;
  };
  
  const cleanTextInput = (value) => {
    return value
      .trim() // remove starting and ending spaces
      .replace(/[\n\t]/g, "") // remove newlines and tabs
      .replace(/<[^>]*>/g, "") // remove HTML tags
      .replace(/[<>&;]/g, ""); // sanitize inputs
  };
  
  const recordAudio = () => {
    return new Promise(async (resolve) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks = [];
  
      mediaRecorder.addEventListener("dataavailable", (event) => {
        audioChunks.push(event.data);
      });
  
      const start = () => mediaRecorder.start();
  
      const stop = () =>
        new Promise((resolve) => {
          mediaRecorder.addEventListener("stop", () => {
            const audioBlob = new Blob(audioChunks, { type: "audio/mpeg" });
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            const play = () => audio.play();
            resolve({ audioBlob, audioUrl, play });
          });
  
          mediaRecorder.stop();
        });
  
      resolve({ start, stop });
    });
  };
  
  const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));
  
  const toggleRecording = async () => {
    if (!recording) {
      recorder = await recordAudio();
      recording = true;
      recorder.start();
    } else {
      const audio = await recorder.stop();
      sleep(1000);
      return audio;
    }
  };
  
  const playResponseAudio = (function () {
    const df = document.createDocumentFragment();
    return function Sound(src) {
      const snd = new Audio(src);
      df.appendChild(snd); // keep in fragment until finished playing
      snd.addEventListener("ended", function () {
        df.removeChild(snd);
      });
      snd.play();
      return snd;
    };
  })();
  
  const getRandomID = () => {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  };
  
  const scrollToBottom = () => {
    // Scroll the chat window to the bottom
    $("#chat-window").animate({
      scrollTop: $("#chat-window")[0].scrollHeight,
    });
  };
  
  const populateUserMessage = (userMessage, userRecording) => {
    // Clear the input field
    $("#message-input").val("");
  
    // Append the user's message to the message list
    if (userRecording) {
      const userRepeatButtonID = getRandomID();
      userRepeatButtonIDToRecordingMap[userRepeatButtonID] = userRecording;
      hideUserLoadingAnimation();
      $("#message-list").append(
        `<div class='message-line my-text'><div class='message-box my-text${
          !lightMode ? " dark" : ""
        }'><div class='me'>${userMessage}</div></div>
              <button id='${userRepeatButtonID}' class='btn volume repeat-button' onclick='userRepeatButtonIDToRecordingMap[this.id].play()'><i class="fa fa-volume-up"></i></button>
              </div>`
      );
    } else {
      $("#message-list").append(
        `<div class='message-line my-text'><div class='message-box my-text${
          !lightMode ? " dark" : ""
        }'><div class='me'>${userMessage}</div></div></div>`
      );
    }
  
    scrollToBottom();
  };
  
  const populateBotResponse = async (userMessage) => {
    await showBotLoadingAnimation();
    const response = await processUserMessage(userMessage);
    responses.push(response);
  
    const repeatButtonID = getRandomID();
    botRepeatButtonIDToIndexMap[repeatButtonID] = responses.length - 1;
    hideBotLoadingAnimation();
    // Append the random message to the message list
    $("#message-list").append(
      `<div class='message-line'><div class='message-box${
        !lightMode ? " dark" : ""
      }'>${
        response.openaiResponseText
      }</div><button id='${repeatButtonID}' class='btn volume repeat-button' onclick='playResponseAudio("data:audio/wav;base64," + responses[botRepeatButtonIDToIndexMap[this.id]].openaiResponseSpeech);console.log(this.id)'><i class="fa fa-volume-up"></i></button></div>`
    );
  
    playResponseAudio("data:audio/wav;base64," + response.openaiResponseSpeech);
  
    scrollToBottom();
  };
  
  $(document).ready(function () {
    // Populate voice dropdown on load
    loadVoices();
  
    // Listen for the "Enter" key being pressed in the input field
    $("#message-input").keyup(function (event) {
      let inputVal = cleanTextInput($("#message-input").val());
  
      if (event.keyCode === 13 && inputVal != "") {
        const message = inputVal;
  
        populateUserMessage(message, null);
        populateBotResponse(message);
      }
  
      inputVal = $("#message-input").val();
  
      if (inputVal == "" || inputVal == null) {
        $("#send-button")
          .removeClass("send")
          .addClass("microphone")
          .html("<i class='fa fa-microphone'></i>");
      } else {
        $("#send-button")
          .removeClass("microphone")
          .addClass("send")
          .html("<i class='fa fa-paper-plane'></i>");
      }
    });
  
    // When the user clicks the "Send" button"
    $("#send-button").click(async function () {
      if ($("#send-button").hasClass("microphone") && !recording) {
        // Safer mic handling
        await startRecordingSafely();
      } else if (recording) {
        toggleRecording().then(async (userRecording) => {
          console.log("stop recording");
          await showUserLoadingAnimation();
          const userMessage = await getSpeechToText(userRecording);
          populateUserMessage(userMessage, userRecording);
          populateBotResponse(userMessage);
        });
        $(".fa-microphone").css("color", "#125ee5");
        recording = false;
      } else {
        // Get the message the user typed in
        const message = cleanTextInput($("#message-input").val());
  
        populateUserMessage(message, null);
        populateBotResponse(message);
  
        $("#send-button")
          .removeClass("send")
          .addClass("microphone")
          .html("<i class='fa fa-microphone'></i>");
      }
    });
  
    // handle the event of switching light-dark mode
    $("#light-dark-mode-switch").change(function () {
      $("body").toggleClass("dark-mode");
      $(".message-box").toggleClass("dark");
      $(".loading-dots").toggleClass("dark");
      $(".dot").toggleClass("dark-dot");
      lightMode = !lightMode;
    });
  
    $("#voice-options").change(function () {
      voiceOption = $(this).val();
      console.log("Selected voice:", voiceOption);
    });
  });
  