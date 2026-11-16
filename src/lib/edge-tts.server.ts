// Server-only: natural Persian speech from Microsoft Edge's free "Read aloud" neural voices.
// Opens one short WebSocket per sentence and returns the finished MP3.
import { EDGE_TRUSTED_CLIENT_TOKEN, edgeSecMsGec } from "./edge-tts-token";

const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".")[0];
const ENDPOINT = "speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const SYNTH_TIMEOUT_MS = 15_000;

export type EdgeVoice = { voice: string; pitch: string; rate: string };

export class TtsError extends Error {}

type MessageData = string | ArrayBuffer | Blob | Uint8Array;
type Socket = {
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: "message", listener: (event: { data: MessageData }) => void): void;
  addEventListener(type: "close" | "error", listener: (event: unknown) => void): void;
};
type WorkerSocket = Socket & { accept(): void };
declare const WebSocketPair: unknown;

function randomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeXml(text: string) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

async function openSocket(signal: AbortSignal): Promise<Socket> {
  const query =
    `TrustedClientToken=${EDGE_TRUSTED_CLIENT_TOKEN}&ConnectionId=${randomHex(16)}` +
    `&Sec-MS-GEC=${edgeSecMsGec()}&Sec-MS-GEC-Version=2-${CHROMIUM_FULL_VERSION}`;
  const headers: Record<string, string> = {
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: `muid=${randomHex(16).toUpperCase()};`,
  };

  // Published app (Worker runtime): outbound WebSockets are opened with fetch + Upgrade.
  if (typeof WebSocketPair !== "undefined") {
    const response = await fetch(`https://${ENDPOINT}?${query}`, { headers: { ...headers, Upgrade: "websocket" }, signal });
    const socket = (response as Response & { webSocket?: WorkerSocket | null }).webSocket;
    if (!socket) throw new TtsError(`Voice service refused the connection (${response.status})`);
    socket.accept();
    return socket;
  }

  // Dev server (Node): the built-in WebSocket client accepts extra headers.
  const Ctor = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;
  const socket = new Ctor(`wss://${ENDPOINT}?${query}`, { headers });
  socket.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new TtsError("Voice service connection failed")), { once: true });
    signal.addEventListener("abort", () => reject(new TtsError("Voice service timed out")), { once: true });
  });
  return socket as unknown as Socket;
}

async function toBytes(data: MessageData) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await (data as Blob).arrayBuffer());
}

/** Speak `text` with the given voice; resolves with the complete MP3. */
export async function synthesizeSpeech(text: string, voice: EdgeVoice): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNTH_TIMEOUT_MS);
  let socket: Socket | undefined;
  try {
    socket = await openSocket(controller.signal);
    const open = socket;
    const chunks: Uint8Array[] = [];
    const done = new Promise<void>((resolve, reject) => {
      let pending = Promise.resolve();
      open.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          if (event.data.includes("Path:turn.end")) pending.then(resolve, reject);
          return;
        }
        pending = pending.then(async () => {
          const bytes = await toBytes(event.data);
          if (bytes.length < 2) return;
          const headerLength = (bytes[0]! << 8) | bytes[1]!;
          const header = new TextDecoder().decode(bytes.subarray(2, 2 + headerLength));
          if (header.includes("Path:audio")) chunks.push(bytes.subarray(2 + headerLength));
        });
      });
      open.addEventListener("close", () => reject(new TtsError("Voice service closed early")));
      open.addEventListener("error", () => reject(new TtsError("Voice service failed")));
      controller.signal.addEventListener("abort", () => reject(new TtsError("Voice service timed out")), { once: true });
    });

    const timestamp = new Date().toUTCString();
    const requestId = randomHex(16);
    open.send(
      `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"${OUTPUT_FORMAT}"}}}}`,
    );
    open.send(
      `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n` +
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='fa-IR'>` +
        `<voice name='${voice.voice}'><prosody pitch='${voice.pitch}' rate='${voice.rate}' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`,
    );
    await done;
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (total === 0) throw new TtsError("Voice service returned no audio");
    const audio = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }
    return audio;
  } finally {
    clearTimeout(timer);
    try {
      socket?.close(1000);
    } catch {
      // Already closed.
    }
  }
}
