const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f]");

export function safeReturnPath(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    CONTROL_CHARACTERS.test(value)
  ) {
    return "/favorites";
  }

  try {
    const url = new URL(value, "https://vocalhub.invalid");
    return url.origin === "https://vocalhub.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/favorites";
  } catch {
    return "/favorites";
  }
}
