class CREDENTIALS {}

CREDENTIALS.DIR_NAME = "wa_credentials";
CREDENTIALS.DATABASE_NAME = "database.db";
CREDENTIALS.PREFIX = "_credentials";

const CALLBACK_KEY = {
  ON_MESSAGE_RECEIVED: "on-message-received",
  ON_QR: "on-qr",
  ON_CONNECTED: "on-connected",
  ON_DISCONNECTED: "on-disconnected",
  ON_CONNECTING: "on-connecting",
  ON_MESSAGE_UPDATED: "on-message-updated",
  ON_PAIRING_CODE: "on-pairing-code",
};

class Messages {
  static sessionAlreadyExist = (sessionId) =>
    `Session ID: "${sessionId}" is already exist, Try another Session ID.`;

  static sessionNotFound = (sessionId) =>
    `Session with ID: "${sessionId}" Not Exist!`;

  static sessionNotReady = (sessionId) =>
    `Session with ID: "${sessionId}" Not Ready!`;

  static paremetersRequired = (props) =>
    `Parameter ${
      typeof props == "string"
        ? props
        : props instanceof Array
        ? props.join(", ")
        : ""
    } is required`;

  static adapterNotProvided = () =>
    `Adapter instance is required in Whatsapp constructor`;
}

export { CREDENTIALS, CALLBACK_KEY, Messages };