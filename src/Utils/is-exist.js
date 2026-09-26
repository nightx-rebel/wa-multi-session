import { WhatsappError } from "../Error/index.js";
import { getSession } from "../Socket/index.js";
import { phoneToJid } from "./phone-to-jid.js";

const isExist = async ({ sessionId, to, isGroup = false }) => {
  try {
    const session = getSession(sessionId);
    if (!session) throw new WhatsappError("Session ID Not Found!");
    const receiver = phoneToJid({ to: to, isGroup: isGroup });
    if (!isGroup) {
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
};

export { isExist };