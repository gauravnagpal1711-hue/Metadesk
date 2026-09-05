/**
 * Creative generation. Independent pieces:
 *   1. generateImage        -> OpenAI gpt-image-1, Replicate, or Gemini/Imagen (Vertex AI),
 *                               whichever is configured, in that priority order.
 *   2. generateCopy         -> Claude writes headline / primary text / CTA for the same brief.
 *   3. startVideo/pollVideo -> Gemini/Veo (Vertex AI) — the only video provider; generation
 *                               is a long-running job, so the caller polls until it's done.
 * Reference images are accepted as base64 and passed to providers that support edits.
 */
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function imageProvider() {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.REPLICATE_API_TOKEN) return 'replicate';
  if (vertexConfigured()) return 'vertex';
  return null;
}

export function videoProvider() {
  return vertexConfigured() ? 'vertex' : null;
}

function vertexConfigured() {
  return !!(process.env.GOOGLE_CLOUD_PROJECT
    && (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON));
}

// Railway's filesystem doesn't persist a saved credentials file across
// redeploys, so production hands us the service-account JSON directly as an
// env var; write it to a temp file once and point ADC at it, since
// @google/genai's Vertex mode only knows how to load credentials from a file.
let credsBootstrapped = false;
function ensureGoogleCredentialsFile() {
  if (credsBootstrapped) return;
  credsBootstrapped = true;
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const file = path.join(os.tmpdir(), 'google-credentials.json');
    fs.writeFileSync(file, process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = file;
  }
}

let vertexClient = null;
function vertexAI() {
  if (vertexClient) return vertexClient;
  ensureGoogleCredentialsFile();
  vertexClient = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1'
  });
  return vertexClient;
}

// The standalone "Imagen" model family isn't in this project's catalog —
// Gemini's own native image output (generateContent, not generateImages)
// is what's actually available, confirmed working 2026-09-05.
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const GEMINI_VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL || 'veo-3.0-generate-001';

export function copyProvider() {
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
}

/**
 * @param {string} prompt
 * @param {object} opts { size, referenceImage (data URL) }
 * @returns {Promise<{provider:string, dataUrl:string}>}
 */
export async function generateImage(prompt, opts = {}) {
  const provider = imageProvider();
  if (!provider) throw new Error('Add OPENAI_API_KEY, REPLICATE_API_TOKEN, or a Gemini/Vertex service account to generate images.');
  if (provider === 'openai') return openaiImage(prompt, opts);
  if (provider === 'vertex') return vertexImage(prompt, opts);
  return replicateImage(prompt, opts);
}

const IMAGE_ASPECT_RATIOS = { '1024x1024': '1:1', '1024x1536': '2:3', '1536x1024': '3:2' };

async function vertexImage(prompt, { size } = {}) {
  const ai = vertexAI();
  const res = await ai.models.generateContent({
    model: GEMINI_IMAGE_MODEL,
    contents: prompt,
    config: { imageConfig: { aspectRatio: IMAGE_ASPECT_RATIOS[size] || '1:1' } }
  });
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error(res.candidates?.[0]?.finishReason || 'Gemini returned no image.');
  return { provider: `vertex:${GEMINI_IMAGE_MODEL}`, dataUrl: `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}` };
}

/**
 * Starts a Veo video generation job (takes minutes, not seconds) and returns
 * the operation name to poll with pollVideo(). Aspect ratio only: 16:9 or 9:16.
 */
export async function startVideo(prompt, { aspectRatio = '16:9' } = {}) {
  if (videoProvider() !== 'vertex') throw new Error('Add a Gemini/Vertex service account to generate video.');
  const ai = vertexAI();
  const operation = await ai.models.generateVideos({
    model: GEMINI_VIDEO_MODEL,
    prompt,
    config: { numberOfVideos: 1, aspectRatio }
  });
  return { provider: `vertex:${GEMINI_VIDEO_MODEL}`, operationName: operation.name };
}

/**
 * Polls one Veo job. Returns { done: false } while still generating, or
 * { done: true, dataUrl } / { done: true, error } once it finishes.
 */
export async function pollVideo(operationName) {
  const ai = vertexAI();
  const operation = await ai.operations.getVideosOperation({ operation: { name: operationName } });
  if (!operation.done) return { done: false };
  if (operation.error) return { done: true, error: operation.error.message || 'Video generation failed.' };
  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video?.videoBytes) return { done: true, error: 'Gemini returned no video.' };
  return { done: true, dataUrl: `data:${video.mimeType || 'video/mp4'};base64,${video.videoBytes}` };
}

async function openaiImage(prompt, { size = '1024x1024', referenceImage } = {}) {
  if (referenceImage) {
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('image', dataUrlToBlob(referenceImage), 'reference.png');
    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || 'Image edit failed.');
    return { provider: 'openai', dataUrl: `data:image/png;base64,${json.data[0].b64_json}` };
  }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size,
      n: 1,
      quality: process.env.OPENAI_IMAGE_QUALITY || 'high'
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || 'Image generation failed.');
  return { provider: 'openai', dataUrl: `data:image/png;base64,${json.data[0].b64_json}` };
}

async function replicateImage(prompt, { size = '1024x1024' } = {}) {
  const model = process.env.REPLICATE_MODEL || 'black-forest-labs/flux-1.1-pro';
  const [width, height] = size.split('x').map(Number);
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait'
    },
    body: JSON.stringify({ input: { prompt, width, height, output_format: 'png' } })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.detail || 'Replicate request failed.');
  const url = Array.isArray(json.output) ? json.output[0] : json.output;
  if (!url) throw new Error('Replicate returned no image.');
  const img = await fetch(url);
  const buf = Buffer.from(await img.arrayBuffer());
  return { provider: `replicate:${model}`, dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
}

/** Headline, primary text and CTA for the same brief. */
export async function generateCopy(brief, { offer, audience, language } = {}) {
  if (!copyProvider()) throw new Error('Add ANTHROPIC_API_KEY to write ad copy.');
  const instruction = [
    'Write Meta ad copy for the brief below.',
    offer ? `Offer: ${offer}` : null,
    audience ? `Audience: ${audience}` : null,
    language ? `Language: ${language}` : null,
    `Brief: ${brief}`,
    '',
    'Return ONLY a JSON object with keys: headline (max 40 chars), primary_text (max 125 chars), cta (2-3 words), image_prompt (a vivid prompt for an image generator, describing composition, lighting and mood, with no text in the image).',
    'No markdown, no preamble.'
  ]
    .filter(Boolean)
    .join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: instruction }]
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || 'Copy generation failed.');
  const text = (json.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .replace(/```json|```/g, '')
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    return { headline: '', primary_text: text, cta: '', image_prompt: brief };
  }
}

/** Whether AI reply suggestions are available. */
export function chatProvider() {
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
}

/**
 * Suggest WhatsApp replies for a lead conversation, in the voice the user uses
 * when they reply by hand in other chats.
 * @param {object} p
 * @param {{direction:'in'|'out', body:string}[]} p.conversation  current thread, oldest first
 * @param {{lead:string, reply:string}[]} p.examples  past (their-message -> your-reply) pairs from other leads
 * @param {{name?:string, stage?:string, campaign?:string, city?:string}} p.lead
 * @returns {Promise<string[]>} up to 3 suggested replies
 */
export async function suggestReplies({ conversation = [], examples = [], lead = {} }) {
  if (!chatProvider()) throw new Error('Add ANTHROPIC_API_KEY to suggest replies.');

  const thread = conversation
    .filter((m) => m.body && m.body.trim())
    .slice(-24)
    .map((m) => `${m.direction === 'out' ? 'You' : 'Lead'}: ${m.body.trim()}`)
    .join('\n');

  const style = examples
    .filter((e) => e.lead && e.reply)
    .slice(0, 12)
    .map((e, i) => `Example ${i + 1}\nLead: ${e.lead.trim()}\nYou: ${e.reply.trim()}`)
    .join('\n\n');

  const ctx = [
    lead.name ? `Lead name: ${lead.name}` : null,
    lead.stage ? `Funnel stage: ${lead.stage}` : null,
    lead.campaign ? `Came from campaign: ${lead.campaign}` : null,
    lead.city ? `City: ${lead.city}` : null
  ].filter(Boolean).join('\n');

  const instruction = [
    'You help a small business owner reply to leads on WhatsApp.',
    'Below are real examples of how THEY reply by hand. Match that voice: length, the English/Hindi (Hinglish) mix they use, punctuation, emoji use and level of formality. Keep replies short and practical, like WhatsApp — never like an email.',
    '',
    style ? `THEIR PAST REPLIES:\n${style}` : '(No past replies on file — keep it short, warm and helpful.)',
    '',
    ctx ? `THIS LEAD:\n${ctx}\n` : '',
    `CURRENT CONVERSATION (latest last):\n${thread || '(no messages yet)'}`,
    '',
    'Write 3 alternative replies they could send next. Vary the angle (answer the question, nudge toward a call or showroom visit, ask one qualifying question). Do NOT invent prices, dates, addresses or facts not shown above — if such a detail is needed, word the reply to ask for it or to promise a follow-up.',
    'Return ONLY a JSON array of 3 strings. No markdown, no preamble.'
  ].join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 700,
      messages: [{ role: 'user', content: instruction }]
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || 'Reply suggestion failed.');
  const text = (json.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .replace(/```json|```/g, '')
    .trim();
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) return arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 3);
  } catch {
    /* fall through to line-splitting */
  }
  return text
    .split('\n')
    .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function dataUrlToBlob(dataUrl) {
  const [, meta, b64] = dataUrl.match(/^data:([^;]+);base64,(.*)$/) || [];
  if (!b64) throw new Error('Reference image must be a base64 data URL.');
  return new Blob([Buffer.from(b64, 'base64')], { type: meta });
}
