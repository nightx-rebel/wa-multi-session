# WhatsApp Multi Session

A Baileys-based WhatsApp client for running multiple linked-device sessions in one Node.js application. Keep this source in your bot project and import its features directly; this project is private and is not intended to be published as an npm package.

## Contents

- [Requirements](#requirements)
- [Use from a bot project](#use-from-a-bot-project)
- [Create a client](#create-a-client)
- [Sessions](#sessions)
- [Messaging](#messaging)
- [Incoming messages and events](#incoming-messages-and-events)
- [Profile and recipient checks](#profile-and-recipient-checks)
- [Storage adapters](#storage-adapters)
- [Standalone API](#standalone-api)
- [Public API reference](#public-api-reference)
- [Troubleshooting and security](#troubleshooting-and-security)

## Requirements

- A Node.js version supported by the installed Baileys 7 release.
- An ESM project. This project sets `"type": "module"` in its `package.json`.
- A WhatsApp account to link as a companion device.
- Redis only if you choose `RedisAdapter`. `SQLiteAdapter` stores credentials in a local SQLite database.

From the folder containing this project's `package.json`, install its dependencies:

```sh
npm install
```

This installs the runtime dependencies for local source use; it does not install `wa-multi-session` from npm. If the code lives in a subfolder, make sure the bot can resolve these dependencies from that folder.

## Use from a bot project

Keep the source folder inside your application and import its ESM entry point. For example:

```text
my-bot/
├── bot.js
└── wa-multi-session/
    └── src/
        └── index.js
```

From `bot.js`, use the relative path to `src/index.js`:

```js
import {
  Whatsapp,
  RedisAdapter,
  SQLiteAdapter,
} from "./wa-multi-session/src/index.js";
```

The import path is relative to the file doing the import. Use `.js` extensions for local ESM imports.

## Create a client

Every `Whatsapp` instance requires a storage adapter. This example uses Redis and explicitly starts a session, so automatic session loading is disabled:

```js
import { Whatsapp, RedisAdapter } from "./wa-multi-session/src/index.js";

const whatsapp = new Whatsapp({
  adapter: new RedisAdapter({
    url: process.env.REDIS_URL ?? "redis://localhost:6379",
  }),
  autoLoad: false,
  debugLevel: "silent",
  onConnecting: (sessionId) => console.log(`${sessionId}: connecting`),
  onConnected: (sessionId) => console.log(`${sessionId}: connected`),
  onDisconnected: (sessionId) => console.log(`${sessionId}: disconnected`),
  onMessageReceived: async (message) => {
    console.log("Received message in", message.sessionId);
  },
});

await whatsapp.startSession("primary");
await whatsapp.startSession("support"); // a second independent session
```

Constructor options:

| Option | Description |
| --- | --- |
| `adapter` | Required storage adapter instance. |
| `autoLoad` | Load session IDs returned by `adapter.listSessions()` during construction. Defaults to `true`. Set to `false` when starting sessions yourself. |
| `debugLevel` | Pino log level. Defaults to `"silent"`. |
| `onConnecting(sessionId)` | Called when a session begins or resumes connecting. |
| `onConnected(sessionId)` | Called when a session connects. |
| `onDisconnected(sessionId)` | Called after a session disconnects and is removed. |
| `onQRUpdated({ sessionId, qr })` | Called when a QR code is available. |
| `onPairingCode(sessionId, code)` | Called when a pairing code is generated. |
| `onMessageReceived(message)` | Called for incoming messages with `sessionId` and media save helpers attached. |
| `onMessageUpdated(data)` | Called when a message status changes. |

When `autoLoad` is enabled, the constructor starts loading sessions but does not return a promise for that operation. Call `await whatsapp.load()` to wait for a later load explicitly.

## Sessions

### Start with a QR code

`printQR` defaults to `true` and prints the QR code in the terminal. You can receive the QR string in a per-session callback instead:

```js
await whatsapp.startSession("support", {
  printQR: false,
  onQRUpdated: (qr) => console.log("Scan this QR with WhatsApp:", qr),
  onConnected: () => console.log("Support session is ready"),
});
```

Scan the QR code using WhatsApp's linked-device flow. Authentication is saved by the configured adapter and reused the next time the session starts.

### Start with a pairing code

Pairing-code login is marked beta by the implementation. Supply the phone number with its country code:

```js
await whatsapp.startSessionWithPairingCode("support", {
  phoneNumber: "6281234567890",
  onPairingCode: (code) => {
    console.log("Enter this code in WhatsApp:", code);
  },
});
```

### List, inspect, and delete sessions

```js
const sessionIds = await whatsapp.getSessionsIds();
const session = await whatsapp.getSessionById("support");

console.log(sessionIds);
console.log(session?.status); // connecting, connected, or disconnected

await whatsapp.deleteSession("support");
```

`deleteSession()` logs out, clears saved credentials through the adapter, and removes the session from this client. Starting an already-running session ID throws `WhatsappError`.

Unexpected socket closures are retried up to 10 times. A logged-out session is not retried.

## Messaging

Every client messaging method takes a `sessionId`. Phone numbers can be strings or numbers. Set `isGroup: true` for group recipients; a WhatsApp JID can be passed directly. Most send methods accept `answering` to quote a message.

### Text

```js
await whatsapp.sendText({
  sessionId: "support",
  to: "6281234567890",
  text: "Hello!",
  answering: receivedMessage, // optional quoted message
});
```

### Images and videos

`media` can be a local `Buffer` or a URL string. `text` is used as the caption.

```js
import { readFile } from "node:fs/promises";

await whatsapp.sendImage({
  sessionId: "support",
  to: "6281234567890",
  media: await readFile("./photo.jpg"),
  text: "Photo caption",
});

await whatsapp.sendVideo({
  sessionId: "support",
  to: "6281234567890",
  media: "https://example.com/clip.mp4",
  text: "Video caption",
});
```

### Documents, audio, and stickers

Documents need a `filename` with a recognized extension so the MIME type can be detected. Set `asVoiceNote: true` to send audio as a voice note.

```js
await whatsapp.sendDocument({
  sessionId: "support",
  to: "6281234567890",
  filename: "report.pdf",
  media: await readFile("./report.pdf"),
  text: "Monthly report",
});

await whatsapp.sendAudio({
  sessionId: "support",
  to: "6281234567890",
  media: await readFile("./voice.ogg"),
  asVoiceNote: true,
});

await whatsapp.sendSticker({
  sessionId: "support",
  to: "6281234567890",
  media: await readFile("./sticker.webp"),
});
```

### Polls, typing, and read receipts

```js
await whatsapp.sendPoll({
  sessionId: "support",
  to: "6281234567890",
  poll: {
    name: "Choose a time",
    values: ["Morning", "Afternoon", "Evening"],
    selectableCount: 1,
  },
});

await whatsapp.sendTypingIndicator({
  sessionId: "support",
  to: "6281234567890",
  duration: 1500,
});

await whatsapp.readMessage({
  sessionId: "support",
  key: receivedMessage.key,
});
```

## Incoming messages and events

Incoming messages are Baileys message objects with these additions:

- `sessionId`: the session that received the message.
- `saveImage(path)`, `saveVideo(path)`, and `saveAudio(path)`: download that message's media to the supplied path.
- `saveDocument(pathWithoutExtension)`: save the document and append the extension from its original filename.

Example reply handler:

```js
const whatsapp = new Whatsapp({
  adapter: new RedisAdapter({ url: process.env.REDIS_URL }),
  autoLoad: false,
  onMessageReceived: async (message) => {
    if (message.key.fromMe || message.key.remoteJid?.includes("status")) return;

    const recipient = message.key.participant ?? message.key.remoteJid;
    if (!recipient) return;

    await whatsapp.readMessage({
      sessionId: message.sessionId,
      key: message.key,
    });
    await whatsapp.sendText({
      sessionId: message.sessionId,
      to: recipient,
      text: `You said: ${message.message?.conversation ?? ""}`,
      answering: message,
    });
  },
});

await whatsapp.startSession("support");
```

`onMessageUpdated(data)` receives the message fields plus `sessionId` and `messageStatus`. Status values are `error`, `pending`, `server`, `delivered`, `read`, and `played`.

Per-session callbacks passed to `startSession()` receive the QR string and no session ID for `onConnecting`, `onConnected`, and `onDisconnected`. Constructor-level lifecycle callbacks receive the session ID; constructor-level `onQRUpdated` receives `{ sessionId, qr }`.

## Profile and recipient checks

```js
const exists = await whatsapp.isExist({
  sessionId: "support",
  to: "6281234567890",
});

const profile = await whatsapp.getProfile({
  sessionId: "support",
  target: "6281234567890@s.whatsapp.net",
});

console.log(profile.profilePictureUrl, profile.status);
```

`isExist()` checks a user or, with `isGroup: true`, a group. `getProfile()` returns `profilePictureUrl` and `status`; either value is `null` if WhatsApp does not provide it.

## Storage adapters

### Redis

```js
import { RedisAdapter } from "./wa-multi-session/src/index.js";

const adapter = new RedisAdapter({
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
  keyPrefix: "my-bot:whatsapp:", // optional; default: wa_multi_session:
});
```

The Redis connection is opened on first storage access. Keep the same prefix when reusing existing session data.

### SQLite

```js
import { SQLiteAdapter } from "./wa-multi-session/src/index.js";

const adapter = new SQLiteAdapter({
  databasePath: "./data/whatsapp.db", // optional
});
```

The default database path is `./wa_credentials/database.db`. The adapter creates the parent directory and authentication table automatically. SQLite is suitable for a single-process bot; use shared storage such as Redis when sessions must be available across application instances.

### Custom adapter

An adapter must implement these asynchronous methods:

| Method | Expected behavior |
| --- | --- |
| `readData(sessionId, key)` | Return the stored string or `null`. |
| `writeData(sessionId, key, category, data)` | Store a string value. |
| `deleteData(sessionId, key)` | Delete one key. |
| `clearData(sessionId)` | Delete all data for one session. |
| `listSessions()` | Optional. Return session IDs for automatic loading. |

## Standalone API

The root entry also exports a legacy functional API backed by its own in-memory session registry and SQLite auth store. Choose either this API or the `Whatsapp` class for a session; they do not share session registries.

```js
import {
  startSession,
  onMessageReceived,
  onQRUpdated,
  sendTextMessage,
  deleteSession,
} from "./wa-multi-session/src/index.js";

onQRUpdated(({ sessionId, qr }) => console.log(sessionId, qr));
onMessageReceived((message) => console.log(message));

await startSession("legacy-session");
await sendTextMessage({
  sessionId: "legacy-session",
  to: "6281234567890",
  text: "Hello from the standalone API",
});
```

Standalone message helpers are `sendTextMessage`, `sendImage`, `sendVideo`, `sendDocument`, `sendVoiceNote`, `sendSticker`, `sendPoll`, `sendTyping`, and `readMessage`. They use payloads similar to the client methods; `sendTyping` uses `duration` and defaults to `1000` milliseconds.

Other standalone exports:

| Export | Purpose |
| --- | --- |
| `startSession(sessionId, options)` | Start a QR session; `sessionId` defaults to `"mysession"`. |
| `startSessionWithPairingCode(sessionId, options)` | Start the beta pairing-code flow. |
| `startWhatsapp` | Deprecated alias for `startSession`. |
| `deleteSession(sessionId)` | Log out and remove a standalone session. |
| `getAllSession()` / `getSession(sessionId)` | Inspect the standalone session registry. |
| `loadSessionsFromStorage(getOptions?)` | Load session IDs from the legacy SQLite store. |
| `onConnecting`, `onConnected`, `onDisconnected` | Register lifecycle listeners; each receives `sessionId`. |
| `onQRUpdated` | Register a listener receiving `{ sessionId, qr }`. |
| `onPairingCode` | Register a listener receiving `(sessionId, code)`. |
| `onMessageReceived` / `onMessageUpdate` | Register message listeners. |
| `getProfileInfo`, `isExist` | Profile and recipient helpers for standalone sessions. |
| `phoneToJid`, `setCredentialsDir`, `createDelay` | Utility functions. `setCredentialsDir` changes the legacy SQLite store directory. |
| `baileys` | Re-export of the Baileys module namespace. |

## Public API reference

The `Whatsapp` instance provides:

| Method | Description |
| --- | --- |
| `startSession(sessionId, options?)` | Start a QR-linked session. |
| `startSessionWithPairingCode(sessionId, options)` | Start the beta pairing-code flow. |
| `getSessionsIds()` | List sessions known to this client. |
| `getSessionById(sessionId)` | Return session data (`sock`, `store`, and `status`) or `undefined`. |
| `deleteSession(sessionId)` | Log out, clear saved credentials, and remove the session. |
| `load()` | Load sessions listed by the adapter. |
| `sendText`, `sendImage`, `sendVideo`, `sendDocument`, `sendAudio`, `sendSticker`, `sendPoll` | Send supported message types. |
| `sendTypingIndicator`, `readMessage` | Send composing presence and mark a message as read. |
| `isExist`, `getProfile` | Check a recipient or retrieve profile information. |

Send and lookup methods require a connected session. Otherwise they throw `WhatsappError` with a session-not-found or session-not-ready message.

## Troubleshooting and security

- **Session is not ready:** wait for `onConnected` before sending messages.
- **QR is not visible:** keep `printQR` enabled or handle `onQRUpdated`.
- **Automatic restore does not run:** enable `autoLoad` and ensure the adapter implements `listSessions()`.
- **Redis sessions are missing:** verify the Redis URL and keep the same `keyPrefix` between restarts.
- **Document send fails:** provide a filename with a recognized extension.
- **Protect credentials:** authentication data is persisted by your adapter. Do not commit the SQLite database, Redis dumps, QR codes, or other session credentials to source control.
- **WhatsApp connectivity:** this project uses Baileys and relies on WhatsApp linked-device behavior. Review Baileys compatibility and WhatsApp's terms before deploying.

## Related projects

- [Baileys](https://github.com/WhiskeySockets/Baileys)
- [wa-gateway](https://github.com/mimamch/wa-gateway)
