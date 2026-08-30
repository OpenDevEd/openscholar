const APPLICATION_UUID = /^[a-z0-9]{24}$/u;

export function isCoolifyApplicationUuid(value: unknown): value is string {
  return typeof value === "string" && APPLICATION_UUID.test(value);
}
