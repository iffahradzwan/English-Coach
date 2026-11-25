// ==========================================
// 1. STATE & DOM ELEMENTS
// ==========================================
let isRecording = false;
let recognition = null;
let finalTranscript = '';
let conversationHistory = [];

const chatContainer = document.getElementById('chat-container');
const statusText = document.getElementById('status');
const micBtn = document.getElementById('mic-btn');
const settingsModal = document.getElementById('settings-modal');
const apiKeyInput = document.getElementById('api-key-input');

// ==========================================
// 2. INITIALIZATION & EVENT LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  if (!getApiKey()) openSettings();
  initSpeechRecognition();

  document.getElementById('mic-btn').addEventListener('click', toggleRecording);
  document.getElementById('clear-btn').addEventListener('click', clearChat);
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('save-key-btn').addEventListener('click', saveApiKey);
  document.getElementById('close-modal-btn').addEventListener('click', closeSettings);
});

// ==========================================
// 3. API KEY & SETTINGS MANAGEMENT
// ==========================================
const voiceSelect = document.getElementById('voice-engine-select');
const edgeUrlGroup = document.getElementById('edge-url-group');
const edgeUrlInput = document.getElementById('edge-url-input');

voiceSelect.addEventListener('change', () => {
  edgeUrlGroup.style.display = voiceSelect.value === 'edge' ? 'block' : 'none';
});

function getApiKey() {
  return (localStorage.getItem('gemini_api_key') || '').replace(/\s+/g, '');
}

function getVoiceEngine() {
  return localStorage.getItem('voice_engine') || 'gemini';
}

function getEdgeUrl() {
  return (localStorage.getItem('edge_worker_url') || '').trim();
}

function openSettings() {
  apiKeyInput.value = getApiKey();
  voiceSelect.value = getVoiceEngine();
  edgeUrlInput.value = getEdgeUrl();
  edgeUrlGroup.style.display = voiceSelect.value === 'edge' ? 'block' : 'none';
  settingsModal.style.display = 'flex';
}

function closeSettings() {
  settingsModal.style.display = 'none';
}

function saveApiKey() {
  const key = apiKeyInput.value.replace(/\s+/g, '');
  if (!key) {
    alert('Please paste a valid Gemini API key.');
    return;
  }
  localStorage.setItem('gemini_api_key', key);
  localStorage.setItem('voice_engine', voiceSelect.value);
  localStorage.setItem('edge_worker_url', edgeUrlInput.value.trim());
  closeSettings();
  statusText.innerText = 'Settings saved! Tap below to speak.';
}


// ==========================================
// 4. SPEECH-TO-TEXT (MICROPHONE)
// ==========================================
let latestTranscript = '';

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) statusText.textContent = 'Speech recognition not supported.';
}

function toggleRecording() {
  if (!getApiKey()) {
    openSettings();
    return;
  }
  if (!isRecording) {
    startRecording();
  } else {
    stopRecording();
  }
}

function startRecording() {
  window.speechSynthesis.cancel();
  if (sharedPlayer) {
    sharedPlayer.pause();
  }

  latestTranscript = '';
  isRecording = true;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let text = '';
    for (let i = 0; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    latestTranscript = text.trim();
    statusText.textContent = latestTranscript ? 'Listening: ' + latestTranscript : 'Listening...';
  };

  recognition.onend = () => {
    if (isRecording) {
      isRecording = false;
      resetMicUI();
      if (latestTranscript) {
        processUserMessage(latestTranscript);
      } else {
        statusText.textContent = 'Did not catch anything. Tap to try again!';
      }
    }
  };

  recognition.onerror = (event) => {
    isRecording = false;
    resetMicUI();
    if (event.error !== 'aborted' && event.error !== 'no-speech') {
      statusText.textContent = 'Mic error: ' + event.error;
    }
  };

  recognition.start();
  micBtn.textContent = '⏹️ Tap to Send';
  micBtn.classList.add('recording');
  statusText.textContent = 'Listening... Speak now!';
}

function stopRecording() {
  unlockSafariAudio();
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }
}

function resetMicUI() {
  micBtn.textContent = '🎤 Tap to Speak';
  micBtn.classList.remove('recording');
}

// ==========================================
// 5. GEMINI AI & GRAMMAR CHECKER
// ==========================================
async function processUserMessage(userText) {
  appendMessage(userText, 'user-msg');
  statusText.innerText = 'Thinking & checking grammar...';

   const systemInstruction = `You are a friendly English conversation partner and silent grammar coach.
  The user is speaking aloud to practice English.
  IMPORTANT: Completely ignore missing punctuation, commas, periods, or capitalization because the input comes from speech-to-text. Only mark "has_mistakes": true if there is an actual spoken grammar, tense, vocabulary, or phrasing error.
  Respond ONLY in valid JSON with this exact structure:
  {
    "reply": "Your natural, conversational response to keep the chat going (do NOT mention their grammar mistakes here).",
    "has_mistakes": true,
    "corrected": "The corrected version of what the user said (or 'Perfect!' if no mistakes)",
    "explanation": "A short, friendly 1-sentence explanation of the spoken grammar fix (or empty string if none)."
  }`;

  conversationHistory.push({ role: "user", parts: [{ text: userText }] });

  try {
  const apiKey = getApiKey();
const host = ['generativelanguage', 'googleapis', 'com'].join('.');
const path = '/v1beta/models/gemini-3.5-flash-lite:generateContent';
const response = await fetch(
  'https://' + host + path,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },

        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: conversationHistory,
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const rawJson = data.candidates[0].content.parts[0].text;
    const result = JSON.parse(rawJson);

    conversationHistory.push({ role: "model", parts: [{ text: result.reply }] });

    appendGrammarFeedback(result);
    appendMessage(result.reply, 'ai-msg');
    speakText(result.reply);
    statusText.innerText = 'Tap below to reply';

  } catch (err) {
    console.error('Fetch error details:', err);
    // Remove failed message from history so conversation stays clean
    conversationHistory.pop();
    statusText.innerText = 'Error: ' + err.message;
  }
}

// ==========================================
// 6. TEXT-TO-SPEECH & UI RENDERING
// ==========================================
const sharedPlayer = new Audio();

function unlockSafariAudio() {
  sharedPlayer.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
  sharedPlayer.play().catch(() => {});
}

async function speakText(text) {
  window.speechSynthesis.cancel();
  sharedPlayer.pause();

  if (getVoiceEngine() === 'gemini') {
    await playGeminiVoice(text);
  } else {
    playAppleVoice(text);
  }
}

function playAppleVoice(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.98;
  window.speechSynthesis.speak(u);
}
