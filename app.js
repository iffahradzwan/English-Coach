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
  if (!SR) {
    statusText.textContent = 'Speech recognition not supported.';
  }
}

function createFreshRecognizer() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';

  rec.onresult = (event) => {
    let text = '';
    for (let i = 0; i < event.results.length; i++) {
      text += event.results[i].transcript;
    }
    latestTranscript = text.trim();
    statusText.textContent = latestTranscript ? 'Listening: ' + latestTranscript : 'Listening...';
  };

  rec.onerror = (event) => {
    if (event.error !== 'aborted' && event.error !== 'no-speech') {
      statusText.textContent = 'Mic error: ' + event.error;
    }
  };


  return rec;
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
let currentAudio = null;

async function speakText(text) {
  window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  const engine = getVoiceEngine();

  if (engine === 'gemini') {
    await playGeminiVoice(text);
  } else if (engine === 'edge') {
    await playEdgeVoice(text);
  } else {
    playAppleVoice(text);
  }
}

function playAppleVoice(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.98;
  window.speechSynthesis.speak(utterance);
}
async function playGeminiVoice(text) {
  try {
    const host = ['generativelanguage', 'googleapis', 'com'].join('.');
    const path = '/v1beta/models/gemini-2.5-flash-preview-tts:generateContent';
    const res = await fetch('https://' + host + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': getApiKey()
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } }
          }
        }
      })
    });

    const data = await res.json();
    const audioB64 = data.candidates[0].content.parts[0].inlineData.data;
    const wavUrl = makeWavFromPcm(audioB64, 24000);
    currentAudio = new Audio(wavUrl);
    await currentAudio.play();
  } catch (e) {
    console.error('Gemini TTS failed, falling back to Apple voice:', e);
    playAppleVoice(text);
  }
}

async function playEdgeVoice(text) {
  const workerUrl = getEdgeUrl();
  if (!workerUrl) {
    playAppleVoice(text);
    return;
  }
  try {
    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, voice: 'en-US-JennyNeural' })
    });
    const blob = await res.blob();
    currentAudio = new Audio(URL.createObjectURL(blob));
    await currentAudio.play();
  } catch (e) {
    console.error('Edge TTS failed, falling back to Apple voice:', e);
    playAppleVoice(text);
  }
}
function makeWavFromPcm(base64Str, sampleRate) {
  const raw = window.atob(base64Str);
  const pcmLen = raw.length;
  const wavBuf = new ArrayBuffer(44 + pcmLen);
  const view = new DataView(wavBuf);

  const putStr = (offset, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  putStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmLen, true);
  putStr(8, 'WAVE');
  putStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  putStr(36, 'data');
  view.setUint32(40, pcmLen, true);

  const bytes = new Uint8Array(wavBuf, 44);
  for (let i = 0; i < pcmLen; i++) bytes[i] = raw.charCodeAt(i);

  return URL.createObjectURL(new Blob([wavBuf], { type: 'audio/wav' }));
}

function appendMessage(text, className) {
  const div = document.createElement('div');
  div.className = 'msg ' + className;
  div.textContent = text;
  chatContainer.appendChild(div);
  scrollToBottom();
}

function appendGrammarFeedback(result) {
  const div = document.createElement('div');
  div.className = 'grammar-box';

  const title = document.createElement('div');
  if (result.has_mistakes) {
    title.className = 'grammar-title';
    title.textContent = '✍️ Grammar Check';
    div.appendChild(title);

    const better = document.createElement('div');
    better.textContent = 'Better: "' + result.corrected + '"';
    div.appendChild(better);

    const exp = document.createElement('div');
    exp.className = 'grammar-explanation';
    exp.textContent = result.explanation;
    div.appendChild(exp);
  } else {
    title.className = 'grammar-title perfect';
    title.textContent = '✅ Grammar Check: Great job!';
    div.appendChild(title);
  }

  chatContainer.appendChild(div);
  scrollToBottom();
}

function clearChat() {
  conversationHistory = [];
  chatContainer.textContent = '';
  appendMessage('Conversation cleared! Ready whenever you are.', 'ai-msg');
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}
