const TOKEN_KEY = "vp_device_token"
const API_BASE_KEY = "vp_api_base"

export async function getDeviceToken(): Promise<string | null> {
  const data = await chrome.storage.session.get(TOKEN_KEY)
  return (data[TOKEN_KEY] as string | undefined) ?? null
}

export async function setDeviceToken(token: string): Promise<void> {
  await chrome.storage.session.set({ [TOKEN_KEY]: token })
}

export async function getApiBase(): Promise<string> {
  const data = await chrome.storage.local.get(API_BASE_KEY)
  return (data[API_BASE_KEY] as string | undefined) ?? "http://127.0.0.1:3100"
}

export async function setApiBase(base: string): Promise<void> {
  await chrome.storage.local.set({ [API_BASE_KEY]: base.replace(/\/$/, "") })
}
