import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import { CALLBACK_KEY, Messages } from "../Defaults/index.js";
import {
  saveAudioHandler,
  saveDocumentHandler,
  saveImageHandler,
  saveVideoHandler,
} from "../Utils/save-media.js";
import { WhatsappError } from "../Error/index.js";
import { parseMessageStatusCodeToReadable } from "../Utils/message-status.js";
import { getSQLiteSessionIds, SQLiteStore } from "../Store/Sqlite.js";
import { createDelay } from "../Utils/create-delay.js";
import pino from "pino";

const sessions = new Map();
const callback = new Map();
const retryCount = new Map();

const P = pino({
  level: "silent",
});

const startSession = async (
  sessionId = "mysession",
  options = { printQR: true }
) => {
  if (isSessionExistAndRunning(sessionId))
    throw new WhatsappError(Messages.sessionAlreadyExist(sessionId));

  const { version } = await fetchLatestBaileysVersion();
  const startSocket = async () => {
    const store = options.store || new SQLiteStore(sessionId);
    const sock = makeWASocket({
      version,
      auth: store.state,
      logger: P,
      markOnlineOnConnect: false,
      browser: Browsers.ubuntu("Chrome"),
    });
    sessions.set(sessionId, { sock: sock, store });
    try {
      sock.ev.process(async (events) => {
        if (events["connection.update"]) {
          const update = events["connection.update"];
          const { connection, lastDisconnect } = update;
          if (update.qr) {
            callback.get(CALLBACK_KEY.ON_QR)?.({
              sessionId,
              qr: update.qr,
            });
            options.onQRUpdated?.(update.qr);
            if (options.printQR) {
              QRCode.toString(
                update.qr,
                { type: "terminal", small: true },
                (error, qrcode) => {
                  console.log(sessionId + ":");
                  console.log(qrcode);
                }
              );
            }
          }
          if (connection == "connecting") {
            callback.get(CALLBACK_KEY.ON_CONNECTING)?.(sessionId);
            options.onConnecting?.();
          }
          if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode;
            let retryAttempt = retryCount.get(sessionId) ?? 0;
            let shouldRetry;
            if (code != DisconnectReason.loggedOut && retryAttempt < 10) {
              shouldRetry = true;
            }
            if (shouldRetry) {
              retryAttempt++;
              retryCount.set(sessionId, retryAttempt);
              startSocket();
            } else {
              retryCount.delete(sessionId);
              deleteSession(sessionId);
              callback.get(CALLBACK_KEY.ON_DISCONNECTED)?.(sessionId);
              options.onDisconnected?.();
            }
          }
          if (connection == "open") {
            retryCount.delete(sessionId);
            callback.get(CALLBACK_KEY.ON_CONNECTED)?.(sessionId);
            options.onConnected?.();
          }
        }
        if (events["creds.update"]) {
          await store.saveCreds();
        }
        if (events["messages.update"]) {
          const msg = events["messages.update"][0];
          const data = {
            sessionId: sessionId,
            messageStatus: parseMessageStatusCodeToReadable(msg.update.status),
            ...msg,
          };
          callback.get(CALLBACK_KEY.ON_MESSAGE_UPDATED)?.(data);
          options.onMessageUpdated?.(data);
        }
        if (events["messages.upsert"]) {
          const msg = events["messages.upsert"].messages?.[0];
          if (msg?.message?.protocolMessage) {
            return;
          }
          msg.sessionId = sessionId;
          msg.saveImage = (path) => saveImageHandler(msg, path);
          msg.saveVideo = (path) => saveVideoHandler(msg, path);
          msg.saveDocument = (path) => saveDocumentHandler(msg, path);
          msg.saveAudio = (path) => saveAudioHandler(msg, path);
          callback.get(CALLBACK_KEY.ON_MESSAGE_RECEIVED)?.({
            ...msg,
          });
          options.onMessageReceived?.(msg);
        }
      });
      return sock;
    } catch (error) {
      return sock;
    }
  };
  return startSocket();
};

const startSessionWithPairingCode = async (sessionId, options) => {
  console.log(
    "startSessionWithPairingCode is currently in beta testing. Please report any issues."
  );
  if (isSessionExistAndRunning(sessionId))
    throw new WhatsappError(Messages.sessionAlreadyExist(sessionId));

  const { version } = await fetchLatestBaileysVersion();
  const startSocket = async () => {
    let isPairingCodeRequested = false;
    const store = options.store || new SQLiteStore(sessionId);
    const sock = makeWASocket({
      version,
      printQRInTerminal: false,
      auth: store.state,
      logger: P,
      markOnlineOnConnect: false,
      browser: Browsers.ubuntu("Chrome"),
    });
    sessions.set(sessionId, { sock: sock, store: store });
    try {
      sock.ev.process(async (events) => {
        if (events["connection.update"]) {
          const update = events["connection.update"];
          const { connection, lastDisconnect } = update;
          if (update.qr) {
            callback.get(CALLBACK_KEY.ON_QR)?.({
              sessionId,
              qr: update.qr,
            });
          }

          if (
            !sock.authState.creds.registered &&
            (connection === "connecting" || !!update.qr) &&
            !isPairingCodeRequested
          ) {
            isPairingCodeRequested = true;
            console.log("pairing");
            await createDelay(2000);

            try {
              const code = await sock.requestPairingCode(options.phoneNumber);
              console.log(code);
              callback.get(CALLBACK_KEY.ON_PAIRING_CODE)?.(sessionId, code);
            } catch (error) {
              console.log("Error Requesting Pairing Code", error);
              isPairingCodeRequested = false;
            }
          }

          if (connection == "connecting") {
            callback.get(CALLBACK_KEY.ON_CONNECTING)?.(sessionId);
          }
          if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode;
            let retryAttempt = retryCount.get(sessionId) ?? 0;
            let shouldRetry;
            if (code != DisconnectReason.loggedOut && retryAttempt < 10) {
              shouldRetry = true;
            }
            if (shouldRetry) {
              retryAttempt++;
            }
            if (shouldRetry) {
              retryCount.set(sessionId, retryAttempt);
              startSocket();
            } else {
              retryCount.delete(sessionId);
              deleteSession(sessionId);
              callback.get(CALLBACK_KEY.ON_DISCONNECTED)?.(sessionId);
            }
          }
          if (connection == "open") {
            retryCount.delete(sessionId);
            callback.get(CALLBACK_KEY.ON_CONNECTED)?.(sessionId);
          }
        }
        if (events["creds.update"]) {
          await store.saveCreds();
        }
        if (events["messages.update"]) {
          const msg = events["messages.update"][0];
          const data = {
            sessionId: sessionId,
            messageStatus: parseMessageStatusCodeToReadable(msg.update.status),
            ...msg,
          };
          callback.get(CALLBACK_KEY.ON_MESSAGE_UPDATED)?.(data);
        }
        if (events["messages.upsert"]) {
          const msg = events["messages.upsert"].messages?.[0];
          if (msg?.message?.protocolMessage) {
            return;
          }
          msg.sessionId = sessionId;
          msg.saveImage = (path) => saveImageHandler(msg, path);
          msg.saveVideo = (path) => saveVideoHandler(msg, path);
          msg.saveDocument = (path) => saveDocumentHandler(msg, path);
          msg.saveAudio = (path) => saveAudioHandler(msg, path);
          callback.get(CALLBACK_KEY.ON_MESSAGE_RECEIVED)?.({
            ...msg,
          });
        }
      });
      return sock;
    } catch (error) {
      return sock;
    }
  };
  return startSocket();
};

const startWhatsapp = startSession;

const deleteSession = async (sessionId) => {
  const session = getSession(sessionId);
  try {
    await session?.sock.logout();
    await session?.store.deleteCreds();
  } catch (error) {}
  session?.sock.end(undefined);
  sessions.delete(sessionId);
};

const getAllSession = () => Array.from(sessions.keys());

const getSession = (key) => sessions.get(key);

const isSessionExistAndRunning = (sessionId) => {
  if (getSession(sessionId)) {
    return true;
  }
  return false;
};

const loadSessionsFromStorage = async (getOptions) => {
  const sessionIds = await getSQLiteSessionIds();
  for (const sessionId of sessionIds) {
    const options = getOptions?.(sessionId);
    await startSession(sessionId, options || undefined);
  }

  return sessionIds;
};

const onMessageReceived = (listener) => {
  callback.set(CALLBACK_KEY.ON_MESSAGE_RECEIVED, listener);
};
const onQRUpdated = (listener) => {
  callback.set(CALLBACK_KEY.ON_QR, listener);
};
const onConnected = (listener) => {
  callback.set(CALLBACK_KEY.ON_CONNECTED, listener);
};
const onDisconnected = (listener) => {
  callback.set(CALLBACK_KEY.ON_DISCONNECTED, listener);
};
const onConnecting = (listener) => {
  callback.set(CALLBACK_KEY.ON_CONNECTING, listener);
};

const onMessageUpdate = (listener) => {
  callback.set(CALLBACK_KEY.ON_MESSAGE_UPDATED, listener);
};

const onPairingCode = (listener) => {
  callback.set(CALLBACK_KEY.ON_PAIRING_CODE, listener);
};

export {
  startSession,
  startSessionWithPairingCode,
  startWhatsapp,
  deleteSession,
  getAllSession,
  getSession,
  loadSessionsFromStorage,
  onMessageReceived,
  onQRUpdated,
  onConnected,
  onDisconnected,
  onConnecting,
  onMessageUpdate,
  onPairingCode,
};