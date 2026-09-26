import { CREDENTIALS } from "../Defaults/index.js";

const setCredentialsDir = (dirname = "wa_credentials") => {
  CREDENTIALS.DIR_NAME = dirname;
};

export { setCredentialsDir };