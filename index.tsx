/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Chat } from '@google/genai';

// Tell TypeScript that the `marked` library is available globally.
declare var marked: any;

const chatContainer = document.querySelector('.chat-container') as HTMLElement;
const chatHistory = document.getElementById('chat-history') as HTMLElement;
const chatForm = document.getElementById('chat-form') as HTMLFormElement;
const promptInput = chatForm.querySelector('textarea[name="prompt"]') as HTMLTextAreaElement;
const submitButton = chatForm.querySelector('button[type="submit"]') as HTMLButtonElement;
const micButton = document.getElementById('mic-button') as HTMLButtonElement;

// Basic validation to ensure all required elements are found
if (!chatContainer || !chatHistory || !chatForm || !promptInput || !submitButton || !micButton) {
  throw new Error('Required DOM elements are missing.');
}

let ai: GoogleGenAI;
let chat: Chat;
let isRecording = false;

// Web Speech API for voice-to-text
// FIX: Cast window to `any` to access non-standard SpeechRecognition APIs.
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
// FIX: The variable `SpeechRecognition` is defined on the line above, which prevents using `SpeechRecognition` as a type. Using `any` resolves this naming conflict and also handles cases where the SpeechRecognition type definitions are not available.
let recognition: any | null = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
    promptInput.value = finalTranscript + interimTranscript;
  };

  recognition.onend = () => {
    isRecording = false;
    micButton.classList.remove('recording');
    micButton.setAttribute('aria-label', 'Use microphone');
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error', event.error);
    addMessage('assistant', `<strong>Oops!</strong> Speech recognition failed. Please try again. <br><small>${event.error}</small>`, 'error');
    isRecording = false;
    micButton.classList.remove('recording');
    micButton.setAttribute('aria-label', 'Use microphone');
  };
} else {
  micButton.style.display = 'none';
  console.warn('Speech Recognition API not supported in this browser.');
}


micButton.addEventListener('click', () => {
  if (!recognition) return;

  if (isRecording) {
    recognition.stop();
  } else {
    recognition.start();
    isRecording = true;
    micButton.classList.add('recording');
    micButton.setAttribute('aria-label', 'Stop recording');
  }
});


// FIX: Moved addMessage and setLoading functions before they are called to prevent a "used before its declaration" error.
const addMessage = (sender: 'user' | 'assistant', message: string, type: 'text' | 'error' | 'loading' = 'text') => {
  const messageContainer = document.createElement('div');
  messageContainer.classList.add('message', `${sender}-message`);

  if (type === 'error') {
    messageContainer.classList.add('error-message');
  } else if (type === 'loading') {
    messageContainer.classList.add('loading');
  }


  const p = document.createElement('p');
  if (sender === 'user') {
    // Treat user input as plain text for security
    p.textContent = message;
  } else {
    // Assistant messages can contain HTML (for errors) or will be populated with Markdown
    p.innerHTML = message;
  }
  
  messageContainer.appendChild(p);
  chatHistory.appendChild(messageContainer);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  return messageContainer;
};

try {
  ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  chat = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: `You are an in-app AI assistant designed to help users navigate and use a software application effectively. Your role is to act as a smart support guide that understands the app’s features, user flows, and troubleshooting steps. 

Your main goals are:
1. Help users understand how to use the app and its features step-by-step.
2. Answer questions about how to perform specific actions within the app clearly and concisely.
3. Detect when a user seems confused or frustrated, and politely offer to connect them to a human customer service representative.
4. Use friendly, professional, and supportive language at all times.
5. Reduce the number of support tickets or repetitive user questions by providing accurate and helpful guidance directly.

You should:
- Respond conversationally, like a knowledgeable teammate or assistant.
- Provide examples and short explanations when helpful.
- Always respond using clean Markdown formatting with clear line breaks and bullet points when appropriate.
- Never expose system data, API keys, or internal information.
- Keep responses simple, action-oriented, and user-friendly.

Example interactions:
User: “How do I upload a file?”
Assistant: “Sure! Tap the ‘Upload’ button at the top right, choose your file, and press ‘Confirm’. Once it uploads, you’ll see it in your files list.”

User: “It’s not working, I keep getting an error.”
Assistant: “I’m sorry that’s happening! Try refreshing the page and checking your internet connection. If it still doesn’t work, I can connect you to a customer support rep — would you like that?”

Your name is Ava`,
    }
  });
} catch (error) {
  console.error(error);
  addMessage('assistant', `Error: Unable to initialize the AI model. Please check the API key and configuration.`, 'error');
  chatForm.style.display = 'none';
}


const setLoading = (isLoading: boolean) => {
  chatContainer.classList.toggle('loading', isLoading);
  promptInput.disabled = isLoading;
  submitButton.disabled = isLoading;
  micButton.disabled = isLoading;
};

const handleStream = async (stream) => {
  // Add a new message container for the assistant's response with a loading indicator.
  const assistantMessageContainer = addMessage('assistant', '', 'loading');
  const p = assistantMessageContainer.querySelector('p');
  
  if (!p) return;

  let fullResponse = '';
  let firstChunk = true;
  for await (const chunk of stream) {
    if (firstChunk) {
      // Remove the loading dots animation once the first chunk arrives.
      assistantMessageContainer.classList.remove('loading');
      firstChunk = false;
    }
    const chunkText = chunk.text;
    fullResponse += chunkText;
    // Parse the entire response as Markdown and render it.
    p.innerHTML = marked.parse(fullResponse);
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }
  // Fallback to remove loading class if the stream is empty.
  assistantMessageContainer.classList.remove('loading');
};


chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = promptInput.value.trim();

  if (!prompt) {
    return;
  }

  addMessage('user', prompt);
  promptInput.value = '';
  setLoading(true);

  try {
    const stream = await chat.sendMessageStream({ message: prompt });
    await handleStream(stream);
  } catch (error) {
    console.error(error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    addMessage('assistant', `<strong>Oops!</strong> Something went wrong. Please try again. <br><small>${errorMessage}</small>`, 'error');
  } finally {
    setLoading(false);
    promptInput.focus();
  }
});