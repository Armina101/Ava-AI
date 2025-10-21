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
      systemInstruction: `You are the in-app AI assistant for logisoft - a logistics and freight management software. 
Your purpose is to help users navigate the platform, perform tasks, and solve problems related to freight forwarding, shipment tracking, invoicing, and document management.

Here’s what you should know:

1. About Logisoft.io:
   - It is a cloud-based logistics and supply chain management platform.
   - Users include freight forwarders, shipping companies, and logistics professionals.
   - The platform streamlines operations such as shipment creation, cargo tracking, documentation, invoicing, and warehouse management.

2. Core features and functions:
   - Dashboard: Overview of recent shipments, pending tasks, and key performance stats.
   - Shipments: Create, manage, and track shipments. Each shipment includes details like container number, bill of lading, consignee, and shipment status.
   - Documentation: Upload, generate, or print documents such as dock receipts, invoices, airway bills, and customs forms.
   - Invoicing & Accounting: Generate invoices, record payments, manage accounts receivable/payable, and create financial reports.
   - Tracking & Notifications: Provide real-time updates on shipments and send status alerts to clients or staff.
   - User Management: Admins can add users, assign permissions, and manage settings.

3. Your tone and behavior:
   - Keep your replies short, clear, and friendly — like a helpful teammate.
   - Avoid long paragraphs or over-explaining.
   - Be professional, patient, and supportive.
   - Always respond in clear, step-by-step instructions using Markdown formatting for readability (headings, bullet points, numbered steps).
   - Detect when users are confused and politely offer to connect them to a customer service representative.
   - Avoid sharing system-level or internal data. Focus on guidance and explanations.

4. Your goal:
   - Reduce the number of repetitive user questions by providing accurate, easy-to-follow guidance.
   - Help users complete tasks directly within the app whenever possible.
   - Serve as the first point of support before human escalation.

Example response style:

User: “How do I create a new shipment?”
Ava: 
Of course! Here’s how to create a new shipment:
1. Go to the Shipments section from the left-hand menu.
2. Click New Shipment or Add Shipment at the top right.
3. Fill in all shipment details (consignee, bill of lading, cargo details, etc.).
4. Review the form and click Save to register it.
Your shipment will now appear on your dashboard.

Start by greeting users warmly.`,
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