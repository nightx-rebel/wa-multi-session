import { BufferJSON } from "baileys";

const stringToJsonBufferParser = (str) => {
  try {
    return JSON.parse(str, BufferJSON.reviver);
  } catch (error) {
    return null;
  }
};

const jsonBufferToStringParser = (obj) => {
  try {
    return JSON.stringify(obj, BufferJSON.replacer);
  } catch (error) {
    return null;
  }
};

export { stringToJsonBufferParser, jsonBufferToStringParser };