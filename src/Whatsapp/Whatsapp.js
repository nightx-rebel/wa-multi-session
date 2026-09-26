import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  proto,
} from "baileys";
import QRCode from "qrcode";
import { CALLBACK_KEY, Messages } from "../Defaults/index.js";
import { WhatsappError } from "../Error/index.js";
import pino from "pino";
import {
  jsonBufferToStringParser,
  stringToJsonBufferParser,
} from "../Utils/json-parser.js";
import { Boom } from "@hapi/boom";
import { parseMessageStatusCodeToReadable } from "../Utils/message-status.js";
import {
  saveAudioHandler,
  saveDocumentHandler,
  saveImageHandler,
  saveVideoHandler,
} from "../Utils/save-media.js";
import { createDelay, phoneToJid } from "../Utils/index.js";
import mime from "mime";

class Whatsapp {
  sessions = new Map();
  callback = new Map();
  retryCount = new Map();

  constructor(props) {
    if (!props.adapter) {
      throw new WhatsappError(Messages.adapterNotProvided());
    }
    this.adapter = props.adapter;
    this.P = pino({ level: props.debugLevel || "silent" });

    this.applyCallbacks(props);

    if (props.autoLoad ?? true) {
      this.load();
    }
  }

  async getSessionsIds() {
    return Array.from(this.sessions.keys());
  }

  async getSessionById(sessionId) {
    const session = this.sessions.get(sessionId);
    return session;
  }

  async getSessionByIdReadyOrThrow(sessionId) {
    const session = await this.getSessionById(sessionId);
    if (!session) throw new WhatsappError(Messages.sessionNotFound(sessionId));
    if (session.status !== "connected")
      throw new WhatsappError(Messages.sessionNotReady(sessionId));

    return session;
  }

  async isSessionExistAndRunning(sessionId) {
    if (await this.getSessionById(sessionId)) {
      return true;
    }
    return false;
  }

  getStore = async (sessionId) => {
    const creds =
      stringToJsonBufferParser(await this.adapter.readData(sessionId, "creds")) ||
      initAuthCreds();

    return {
      state: {
        creds: creds,
        keys: {
          get: async (type, ids) => {
            const data = {};
            for (const id of ids) {
              let value = stringToJsonBufferParser(
                await this.adapter.readData(sessionId, `${type}-${id}`)
              );
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            }
            return data;
          },
          set: async (data) => {
            for (const category in data) {
              for (const id in data[category]) {
                const value = data[category][id];
                if (value) {
                  await this.adapter.writeData(
                    sessionId,
                    `${category}-${id}`,
                    category,
                    jsonBufferToStringParser(value)
                  );
                } else {
                  await this.adapter.deleteData(sessionId, `${category}-${id}`);
                }
              }
            }
          },
        },
      },
      saveCreds: async () => {
        await this.adapter.writeData(
          sessionId,
          "creds",
          "credentials",
          jsonBufferToStringParser(creds)
        );
      },
      clearCreds: async () => {
        await this.adapter.clearData(sessionId);
      },
    };
  };

  async startSession(sessionId, options = { printQR: true }) {
    if (await this.isSessionExistAndRunning(sessionId))
      throw new WhatsappError(Messages.sessionAlreadyExist(sessionId));

    const { version } = await fetchLatestBaileysVersion();
    const startSocket = async () => {
      const store = await this.getStore(sessionId);
      const sock = makeWASocket({
        version,
        auth: store.state,
        logger: this.P,
        markOnlineOnConnect: false,
        browser: Browsers.ubuntu("Chrome"),
      });
      this.sessions.set(sessionId, {
        sock: sock,
        store: store,
        status: "connecting",
      });
      try {
        sock.ev.process(async (events) => {
          if (events["connection.update"]) {
            const update = events["connection.update"];
            const { connection, lastDisconnect } = update;
            if (update.qr) {
              this.callback.get(CALLBACK_KEY.ON_QR)?.({
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
              this.callback.get(CALLBACK_KEY.ON_CONNECTING)?.(sessionId);
              options.onConnecting?.();
              const session = this.sessions.get(sessionId);
              if (session) this.sessions.get(sessionId).status = "connecting";
            }
            if (connection === "close") {
              const code = lastDisconnect?.error?.output?.statusCode;
              let retryAttempt = this.retryCount.get(sessionId) ?? 0;
              let shouldRetry = false;
              if (code != DisconnectReason.loggedOut && retryAttempt < 10) {
                shouldRetry = true;
              }
              if (shouldRetry) {
                retryAttempt++;
                this.retryCount.set(sessionId, retryAttempt);
                startSocket();
              } else {
                const session = this.sessions.get(sessionId);
                if (session)
                  this.sessions.get(sessionId).status = "disconnected";
                this.retryCount.delete(sessionId);
                this.deleteSession(sessionId);
                this.callback.get(CALLBACK_KEY.ON_DISCONNECTED)?.(sessionId);
                options.onDisconnected?.();
              }
            }
            if (connection == "open") {
              this.retryCount.delete(sessionId);
              this.callback.get(CALLBACK_KEY.ON_CONNECTED)?.(sessionId);
              const session = this.sessions.get(sessionId);
              if (session) this.sessions.get(sessionId).status = "connected";
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
              messageStatus: parseMessageStatusCodeToReadable(
                msg.update.status
              ),
              ...msg,
            };
            this.callback.get(CALLBACK_KEY.ON_MESSAGE_UPDATED)?.(data);
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
            this.callback.get(CALLBACK_KEY.ON_MESSAGE_RECEIVED)?.({
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
    try {
      return startSocket();
    } catch (error) {
      console.error("!! => session error");
    }
  }

  async startSessionWithPairingCode(sessionId, options) {
    console.warn(
      "startSessionWithPairingCode is currently in beta testing. Please report any issues."
    );
    if (await this.isSessionExistAndRunning(sessionId))
      throw new WhatsappError(Messages.sessionAlreadyExist(sessionId));

    const { version } = await fetchLatestBaileysVersion();
    const startSocket = async () => {
      let isPairingCodeRequested = false;
      const store = await this.getStore(sessionId);
      const sock = makeWASocket({
        version,
        auth: store.state,
        logger: this.P,
        markOnlineOnConnect: false,
        browser: Browsers.ubuntu("Chrome"),
      });
      this.sessions.set(sessionId, {
        sock: sock,
        store: store,
        status: "connecting",
      });

      try {
        sock.ev.process(async (events) => {
          if (events["connection.update"]) {
            const update = events["connection.update"];
            const { connection, lastDisconnect } = update;
            if (update.qr) {
              this.callback.get(CALLBACK_KEY.ON_QR)?.({
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
              await createDelay(2000);

              try {
                const code = await sock.requestPairingCode(options.phoneNumber);
                this.callback.get(CALLBACK_KEY.ON_PAIRING_CODE)?.(
                  sessionId,
                  code
                );
                options.onPairingCode?.(code);
              } catch (error) {
                console.log("Error Requesting Pairing Code", error);
                isPairingCodeRequested = false;
              }
            }

            if (connection == "connecting") {
              this.callback.get(CALLBACK_KEY.ON_CONNECTING)?.(sessionId);
              options.onConnecting?.();
              const session = this.sessions.get(sessionId);
              if (session) this.sessions.get(sessionId).status = "connecting";
            }
            if (connection === "close") {
              const code = lastDisconnect?.error?.output?.statusCode;
              let retryAttempt = this.retryCount.get(sessionId) ?? 0;
              let shouldRetry = false;
              if (code != DisconnectReason.loggedOut && retryAttempt < 10) {
                shouldRetry = true;
              }
              if (shouldRetry) {
                retryAttempt++;
                this.retryCount.set(sessionId, retryAttempt);
                startSocket();
              } else {
                const session = this.sessions.get(sessionId);
                if (session)
                  this.sessions.get(sessionId).status = "disconnected";
                this.retryCount.delete(sessionId);
                this.deleteSession(sessionId);
                this.callback.get(CALLBACK_KEY.ON_DISCONNECTED)?.(sessionId);
                options.onDisconnected?.();
              }
            }
            if (connection == "open") {
              this.retryCount.delete(sessionId);
              this.callback.get(CALLBACK_KEY.ON_CONNECTED)?.(sessionId);
              const session = this.sessions.get(sessionId);
              if (session) this.sessions.get(sessionId).status = "connected";
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
              messageStatus: parseMessageStatusCodeToReadable(
                msg.update.status
              ),
              ...msg,
            };
            this.callback.get(CALLBACK_KEY.ON_MESSAGE_UPDATED)?.(data);
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
            this.callback.get(CALLBACK_KEY.ON_MESSAGE_RECEIVED)?.({
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
    try {
      return startSocket();
    } catch (error) {
      console.error("!! => session error");
    }
  }

  async deleteSession(sessionId) {
    const session = await this.getSessionById(sessionId);
    try {
      await session?.sock.logout().catch(() => {});
      await session?.store.clearCreds().catch(() => {});
    } catch (error) {}
    session?.sock.end(undefined);
    this.sessions.delete(sessionId);
  }

  applyCallbacks(props) {
    if (props.onConnecting) {
      this.callback.set(CALLBACK_KEY.ON_CONNECTING, props.onConnecting);
    }
    if (props.onConnected) {
      this.callback.set(CALLBACK_KEY.ON_CONNECTED, props.onConnected);
    }
    if (props.onDisconnected) {
      this.callback.set(CALLBACK_KEY.ON_DISCONNECTED, props.onDisconnected);
    }
    if (props.onPairingCode) {
      this.callback.set(CALLBACK_KEY.ON_PAIRING_CODE, props.onPairingCode);
    }
    if (props.onMessageUpdated) {
      this.callback.set(
        CALLBACK_KEY.ON_MESSAGE_UPDATED,
        props.onMessageUpdated
      );
    }
    if (props.onMessageReceived) {
      this.callback.set(
        CALLBACK_KEY.ON_MESSAGE_RECEIVED,
        props.onMessageReceived
      );
    }
    if (props.onQRUpdated) {
      this.callback.set(CALLBACK_KEY.ON_QR, props.onQRUpdated);
    }
  }

  async load() {
    try {
      const sessionIds = (await this.adapter.listSessions?.()) || [];
      for (const sessionId of sessionIds) {
        if (await this.isSessionExistAndRunning(sessionId)) {
          continue;
        }

        await this.startSession(sessionId);
      }
    } catch (error) {
      this.P.error("Failed to load sessions from adapter: " + error);
    }
  }

  sendText = async (props) => {
    const session = await this.getSessionByIdReadyOrThrow(props.sessionId);
    const to = phoneToJid({ to: props.to, isGroup: props.isGroup });

    return await session.sock.sendMessage(
      to,
      {
        text: props.text,
        linkPreview: null,
      },
      {
        quoted: props.answering,
      }
    );
  };

  sendImage = async (props) => {
    const session = await this.getSessionByIdReadyOrThrow(props.sessionId);
    const to = phoneToJid({ to: props.to, isGroup: props.isGroup });

    return await session.sock.sendMessage(
      to,
      {
        image:
          typeof props.media == "string"
            ? {
                url: props.media,
              }
            : props.media,
        caption: props.text,
      },
      {
        quoted: props.answering,
      }
    );
  };

  sendVideo = async (props) => {
    const session = await this.getSessionByIdReadyOrThrow(props.sessionId);
    const to = phoneToJid({ to: props.to, isGroup: props.isGroup });

    return await session.sock.sendMessage(
      to,
      {
        video:
          typeof props.media == "string"
            ? {
                url: props.media,
              }
            : props.media,
        caption: props.text,
      },
      {
        quoted: props.answering,
      }
    );
  };

  sendDocument = async (props) => {
    const session = await this.getSessionByIdReadyOrThrow(props.sessionId);
    const to = phoneToJid({ to: props.to, isGroup: props.isGroup });

    if (!props.media) {
      throw new WhatsappError(`Invalid Media`);
    }

    const mimetype = mime.getType(props.filename);
    if (!mimetype) {
      throw new WhatsappError(`Filename must include valid extension`);
    }

    return await session.sock.sendMessage(
      to,
      {
        fileName: props.filename,
        document:
          typeof props.media == "string"
            ? {
                url: props.media,
              }
            : props.media,
        mimetype: mimetype,
        caption: props.text,
      },
      {
        quoted: props.answering,
      }
    );
  };

  sendAudio = async (props) => {
    const session = await this.getSessionByIdReadyOrThrow(props.sessionId);
    const to = phoneToJid({ to: props.to, isGroup: props.isGroup });

    if (!props.media) {
      throw new WhatsappError(`Invalid Media`);
    }

    return await session.sock.sendMessage(
      to,
      {
        audio:
          typeof props.media == "string"
            ? {
                url: props.media,
              }
            : props.media,
        ptt: props.asVoiceNote ?? false,
      },
      {
        quoted: props.answering,
      }
    );
  };

  sendSticker = async (props) => {
    const session = await this.getSessionByIdReadyOrThrow(props.sessionId);
    const to = phoneToJid({ to: props.to, isGroup: props.isGroup });

    if (!props.media) {
      throw new WhatsappError(`Invalid Media`);
    }

    return await session.sock.sendMessage(
      to,
      {
        sticker:
          typeof props.media == "string"
            ? {
                url: props.media,
              }
            : props.media,
      },
      {
        quoted: props.answering,
      }
    );
  };

  sendPoll = async (props) => {
    const session = await this.getSessionByIdReadyOrThrow(props.sessionId);
    const to = phoneToJid({ to: props.to, isGroup: props.isGroup });

    const pollMsg = {
      poll: {
        name: props.poll.name,
        values: props.poll.values,
        selectableCount: props.poll.selectableCount || 1,
      },
    };

    return await session.sock.sendMessage(to, pollMsg, {
      quoted: props.answering,
    });
  };

  sendTypingIndicator = async (props) => {
    const session = await this.getSessionByIdReadyOrThrow(props.sessionId);
    const to = phoneToJid({ to: props.to, isGroup: props.isGroup });

    await session.sock.sendPresenceUpdate("composing", to);
    await createDelay(props.duration);
    await session.sock.sendPresenceUpdate("available", to);
  };

  readMessage = async (props) => {
    const session = await this.getSessionByIdReadyOrThrow(props.sessionId);

    await session.sock.readMessages([props.key]);
  };

  async getProfile(props) {
    const session = await this.getSessionByIdReadyOrThrow(props.sessionId);

    const [profilePictureUrl, status] = await Promise.allSettled([
      session.sock.profilePictureUrl(props.target, "image", 5000),
      session.sock.fetchStatus(props.target),
    ]);
    return {
      profilePictureUrl:
        profilePictureUrl.status === "fulfilled"
          ? profilePictureUrl.value || null
          : null,
      status: status.status === "fulfilled" ? status.value || null : null,
    };
  }

  async isExist(props) {
    try {
      const session = await this.getSessionByIdReadyOrThrow(props.sessionId);
      const receiver = phoneToJid({
        to: props.to,
        isGroup: props.isGroup,
      });
      if (!props.isGroup) {
        const one = Boolean(
          (await session?.sock.onWhatsApp(receiver))?.[0]?.exists
        );
        return one;
      } else {
        return Boolean((await session.sock.groupMetadata(receiver)).id);
      }
    } catch (error) {
      throw error;
    }
  }
}

export { Whatsapp };