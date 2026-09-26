import { Messages } from "../Defaults/index.js";
import { getSession } from "../Socket/index.js";
import { phoneToJid } from "../Utils/index.js";
import { createDelay } from "../Utils/create-delay.js";
import { isExist } from "../Utils/is-exist.js";
import mime from "mime";
import { WhatsappError } from "../Error/index.js";

const sendTextMessage = async ({
  sessionId,
  to,
  text = "",
  isGroup = false,
  ...props
}) => {
  const session = getSession(sessionId);
  if (!session) throw new WhatsappError(Messages.sessionNotFound(sessionId));
  to = phoneToJid({ to, isGroup });

  return await session.sock.sendMessage(
    to,
    {
      text: text,
      linkPreview: null,
    },
    {
      quoted: props.answering,
    }
  );
};

const sendImage = async ({
  sessionId,
  to,
  text = "",
  isGroup = false,
  media,
  ...props
}) => {
  const session = getSession(sessionId);
  if (!session) throw new WhatsappError(Messages.sessionNotFound(sessionId));
  to = phoneToJid({ to, isGroup });

  if (!media)
    throw new WhatsappError("parameter media must be Buffer or String URL");
  return await session.sock.sendMessage(
    to,
    {
      image:
        typeof media == "string"
          ? {
              url: media,
            }
          : media,
      caption: text,
    },
    {
      quoted: props.answering,
    }
  );
};

const sendVideo = async ({
  sessionId,
  to,
  text = "",
  isGroup = false,
  media,
  ...props
}) => {
  const session = getSession(sessionId);
  if (!session) throw new WhatsappError(Messages.sessionNotFound(sessionId));
  to = phoneToJid({ to, isGroup });

  if (!media)
    throw new WhatsappError("parameter media must be Buffer or String URL");
  return await session.sock.sendMessage(
    to,
    {
      video:
        typeof media == "string"
          ? {
              url: media,
            }
          : media,
      caption: text,
    },
    {
      quoted: props.answering,
    }
  );
};

const sendDocument = async ({
  sessionId,
  to,
  text = "",
  isGroup = false,
  media,
  filename,
  ...props
}) => {
  const session = getSession(sessionId);
  if (!session) throw new WhatsappError(Messages.sessionNotFound(sessionId));
  to = phoneToJid({ to, isGroup });

  if (!media) {
    throw new WhatsappError(`Invalid Media`);
  }

  const mimetype = mime.getType(filename);
  if (!mimetype) {
    throw new WhatsappError(`Filename must include valid extension`);
  }

  return await session.sock.sendMessage(
    to,
    {
      fileName: filename,
      document:
        typeof media == "string"
          ? {
              url: media,
            }
          : media,
      mimetype: mimetype,
      caption: text,
    },
    {
      quoted: props.answering,
    }
  );
};

const sendVoiceNote = async ({
  sessionId,
  to,
  isGroup = false,
  media,
  ...props
}) => {
  const session = getSession(sessionId);
  if (!session) throw new WhatsappError(Messages.sessionNotFound(sessionId));
  to = phoneToJid({ to, isGroup });

  if (!media) {
    throw new WhatsappError(`Invalid Media`);
  }

  return await session.sock.sendMessage(
    to,
    {
      audio:
        typeof media == "string"
          ? {
              url: media,
            }
          : media,
      ptt: true,
    },
    {
      quoted: props.answering,
    }
  );
};

const sendSticker = async ({
  sessionId,
  to,
  isGroup,
  media,
  ...props
}) => {
  const session = getSession(sessionId);
  if (!session) throw new WhatsappError(Messages.sessionNotFound(sessionId));
  to = phoneToJid({ to, isGroup });

  if (!media) {
    throw new WhatsappError(`Invalid Media`);
  }

  return await session.sock.sendMessage(
    to,
    {
      sticker:
        typeof media == "string"
          ? {
              url: media,
            }
          : media,
    },
    {
      quoted: props.answering,
    }
  );
};

const sendTyping = async ({
  sessionId,
  to,
  duration = 1000,
  isGroup = false,
}) => {
  to = phoneToJid({ to, isGroup });
  const session = getSession(sessionId);
  if (!session) throw new WhatsappError(Messages.sessionNotFound(sessionId));

  await session.sock.sendPresenceUpdate("composing", to);
  await createDelay(duration);
  await session.sock.sendPresenceUpdate("available", to);
};

const readMessage = async ({ sessionId, key }) => {
  const session = getSession(sessionId);
  if (!session) throw new WhatsappError(Messages.sessionNotFound(sessionId));

  await session.sock.readMessages([key]);
};

const sendPoll = async ({
  sessionId,
  to,
  poll,
  isGroup = false,
  ...props
}) => {
  const session = getSession(sessionId);
  if (!session) throw new WhatsappError(Messages.sessionNotFound(sessionId));
  to = phoneToJid({ to, isGroup });

  const pollMsg = {
    poll: {
      name: poll.name,
      values: poll.values,
      selectableCount: poll.selectableCount || 1,
    },
  };

  return await session.sock.sendMessage(to, pollMsg, {
    quoted: props.answering,
  });
};

export {
  sendTextMessage,
  sendImage,
  sendVideo,
  sendDocument,
  sendVoiceNote,
  sendSticker,
  sendTyping,
  readMessage,
  sendPoll,
  isExist,
};