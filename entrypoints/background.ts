import { defineBackground } from "wxt/utils/define-background";
import { registerBackground } from "../src/background.js";

export default defineBackground(() => {
  registerBackground(chrome);
});
