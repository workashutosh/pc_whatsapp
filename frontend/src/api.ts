import { channelApi } from "./channel/api";
import { inboxApi } from "./inbox/api";
import { apiUrl, loadSession, setSession } from "./lib/http";

export { loadSession, setSession };

export const api = {
  url: apiUrl(),
  ...inboxApi,
  ...channelApi,
};
