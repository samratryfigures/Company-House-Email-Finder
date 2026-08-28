export const SERPER_CREDITS_ERROR = "SERPER_CREDITS";
export const SERPER_KEY_MISSING = "SERPER_KEY_MISSING";

export function isSerperKeyError(message: string | null | undefined): boolean {
  if (!message) return false;
  return message.includes(SERPER_CREDITS_ERROR) || message.includes(SERPER_KEY_MISSING);
}

export function companyNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function leadIdentityKey(name: string, companyNumber?: string | null): string {
  const number = companyNumber?.trim().toUpperCase().replace(/[\s-]/g, "");
  if (number) return `num:${number}`;
  return `name:${companyNameKey(name)}`;
}
