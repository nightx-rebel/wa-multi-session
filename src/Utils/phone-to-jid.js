import { WhatsappError } from "../Error/index.js";

const phoneToJid = ({ to, isGroup = false }) => {
  if (!to) throw new WhatsappError('parameter "to" is required');
  let number = to.toString().replace(/\s|\+/g, "");

  if (number.includes("@")) {
    return number;
  }

  const isGroupJidFormat = isGroup && /^\d+-\d+$/.test(number);

  if (!isGroupJidFormat) {
    number = number.replace(/-/g, "");
  }

  if (isGroup) {
    if (!number.endsWith("@g.us")) number = number + "@g.us";
  } else {
    number = number.replace(/\s|\+/gim, "");
    if (!number.endsWith("@s.whatsapp.net"))
      number = number + "@s.whatsapp.net";
  }

  return number;
};

export { phoneToJid };