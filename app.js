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
function getApiKey() {
  // Remove any accidental spaces or invisible line breaks from copy-pasting on iPhone
  return (localStorage.getItem('gemini_api_key') || '').replace(/\s+/g, '');
}

function openSettings() {
  apiKeyInput.value = getApiKey();
  settingsModal.style.display = 'flex';
}

function closeSettings() {
  settingsModal.style.display = 'none';
}

function saveApiKey() {
  const key = apiKeyInput.value.replace(/\s+/g, '');
 if (!key) {
    alert('Please paste a valid Gemini API key (starts with AIza...).');
    return;
  }
  localStorage.setItem('gemini_api_key', key);
  closeSettings();
  statusText.innerText = 'API Key saved! Tap below to speak.';
}

// ==========================================
// 4. SPEECH-TO-TEXT (MICROPHONE)
// ==========================================
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    statusText.innerText = '⚠️ Speech recognition not supported. Please use Safari or Chrome.';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let interim = '';
    let currentFinal = '';

    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result && result[0] && result[0].transcript ? result[0].transcript : '';
      if (result.isFinal) {
        currentFinal += text + ' ';
      } else {
        interim += text;
      }
    }

    finalTranscript = currentFinal;
    const display = (finalTranscript + interim).trim();
    statusText.innerText = display ? 'Listening: ' + display : 'Listening... Speak now!';
  };

  recognition.onerror = (event) => {
    console.error('Speech error:', event.error);
    resetMicUI();
    statusText.innerText = 'Mic error: ' + event.error;
  };
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
  finalTranscript = '';
  isRecording = true;

  try {
    recognition.start();
    micBtn.innerText = '⏹️ Tap to Send';
    micBtn.classList.add('recording');
    statusText.innerText = 'Listening... Speak now!';
  } catch (e) {
    console.error(e);
    isRecording = false;
  }
}

function stopRecording() {
  isRecording = false;
  recognition.stop();
  resetMicUI();

  setTimeout(() => {
    const spokenText = finalTranscript.trim();
    if (spokenText) {
      processUserMessage(spokenText);
    } else {
      statusText.innerText = 'Did not catch anything. Tap to try again!';
    }
  }, 500);
}

function resetMicUI() {
  micBtn.innerText = '🎤 Tap to Speak';
  micBtn.classList.remove('recording');
}

// ==========================================
// 5. GEMINI AI & GRAMMAR CHECKER
// ==========================================
async function processUserMessage(userText) {
  appendMessage(userText, 'user-msg');
  statusText.innerText = 'Thinking & checking grammar...';

  const systemInstruction = `You are a friendly English conversation partner and silent grammar coach.
  The user is speaking to you to practice English.
  Respond ONLY in valid JSON with this exact structure:
  {
    "reply": "Your natural, conversational response to keep the chat going (do NOT mention their grammar mistakes here).",
    "has_mistakes": true,
    "corrected": "The corrected version of what the user said (or 'Perfect!' if no mistakes)",
    "explanation": "A short, friendly 1-sentence explanation of the grammar fix (or empty string if none)."
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
function speakText(text) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 1.0;
  window.speechSynthesis.speak(utterance);
}

function appendMessage(text, className) {
  const div = document.createElement('div');
  div.className = `msg ${className}`;
  div.innerText = text;
  chatContainer.appendChild(div);
  scrollToBottom();
}

function appendGrammarFeedback(result) {
  const div = document.createElement('div');
  div.className = 'grammar-box';

  if (result.has_mistakes) {
    div.innerHTML = `
      <div class="grammar-title">✍️ Grammar Check</div>
      <div><strong>Better:</strong> "${result.corrected}"</div>
      <div class="grammar-explanation">${result.explanation}</div>
    `;
  } else {
    div.innerHTML = `
      <div class="grammar-title perfect">✅ Grammar Check: Great job!</div>
    `;
  }

  chatContainer.appendChild(div);
  scrollToBottom();
}

function clearChat() {
  conversationHistory = [];
  chatContainer.innerHTML = '<div class="msg ai-msg">Conversation cleared! Ready whenever you are.</div>';
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}
