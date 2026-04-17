import { describe, it, expect } from "vitest";
import {
  validatePdfUrl,
  UnsafeUrlError,
  MAX_PDF_URL_LENGTH,
} from "../../lib/pdf/url-allowlist";

describe("validatePdfUrl", () => {
  it("accepts a public https URL", () => {
    expect(() => validatePdfUrl("https://arxiv.org/pdf/2401.00001.pdf")).not.toThrow();
  });

  it("rejects http scheme", () => {
    expect(() => validatePdfUrl("http://example.com/a.pdf")).toThrow(UnsafeUrlError);
  });

  it("rejects file scheme", () => {
    expect(() => validatePdfUrl("file:///etc/passwd")).toThrow(UnsafeUrlError);
  });

  it("rejects gopher scheme", () => {
    expect(() => validatePdfUrl("gopher://example.com/1")).toThrow(UnsafeUrlError);
  });

  it("rejects data URLs", () => {
    expect(() => validatePdfUrl("data:application/pdf;base64,AAAA")).toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects URLs with userinfo", () => {
    expect(() => validatePdfUrl("https://user@example.com/a.pdf")).toThrow(
      UnsafeUrlError,
    );
    expect(() =>
      validatePdfUrl("https://user:pass@example.com/a.pdf"),
    ).toThrow(UnsafeUrlError);
  });

  it("rejects loopback IPv4", () => {
    expect(() => validatePdfUrl("https://127.0.0.1/a.pdf")).toThrow(UnsafeUrlError);
    expect(() => validatePdfUrl("https://127.1.2.3/a.pdf")).toThrow(UnsafeUrlError);
  });

  it("rejects RFC1918 private IPv4", () => {
    expect(() => validatePdfUrl("https://10.0.0.1/a.pdf")).toThrow(UnsafeUrlError);
    expect(() => validatePdfUrl("https://192.168.1.1/a.pdf")).toThrow(
      UnsafeUrlError,
    );
    expect(() => validatePdfUrl("https://172.16.0.1/a.pdf")).toThrow(
      UnsafeUrlError,
    );
    expect(() => validatePdfUrl("https://172.31.255.255/a.pdf")).toThrow(
      UnsafeUrlError,
    );
  });

  it("accepts public-range IPv4 just outside RFC1918", () => {
    expect(() => validatePdfUrl("https://172.15.0.1/a.pdf")).not.toThrow();
    expect(() => validatePdfUrl("https://172.32.0.1/a.pdf")).not.toThrow();
  });

  it("rejects AWS IMDS metadata endpoint", () => {
    expect(() => validatePdfUrl("https://169.254.169.254/latest/meta-data/")).toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects CGNAT 100.64.0.0/10", () => {
    expect(() => validatePdfUrl("https://100.64.1.2/a.pdf")).toThrow(UnsafeUrlError);
    expect(() => validatePdfUrl("https://100.127.255.255/a.pdf")).toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects localhost", () => {
    expect(() => validatePdfUrl("https://localhost/a.pdf")).toThrow(UnsafeUrlError);
  });

  it("rejects single-label hostnames", () => {
    expect(() => validatePdfUrl("https://intranet/a.pdf")).toThrow(UnsafeUrlError);
  });

  it("rejects IPv6 loopback", () => {
    expect(() => validatePdfUrl("https://[::1]/a.pdf")).toThrow(UnsafeUrlError);
  });

  it("rejects IPv6 unique-local fc00::/7", () => {
    expect(() => validatePdfUrl("https://[fd00::1]/a.pdf")).toThrow(UnsafeUrlError);
  });

  it("rejects IPv6 link-local fe80::/10", () => {
    expect(() => validatePdfUrl("https://[fe80::1]/a.pdf")).toThrow(UnsafeUrlError);
  });

  it("rejects IPv4-mapped IPv6 loopback", () => {
    expect(() => validatePdfUrl("https://[::ffff:127.0.0.1]/a.pdf")).toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects URLs longer than MAX_PDF_URL_LENGTH", () => {
    const long = "https://example.com/" + "a".repeat(MAX_PDF_URL_LENGTH);
    expect(() => validatePdfUrl(long)).toThrow(UnsafeUrlError);
  });

  it("rejects garbage non-URL input", () => {
    expect(() => validatePdfUrl("not a url")).toThrow(UnsafeUrlError);
  });

  it("rejects empty input", () => {
    expect(() => validatePdfUrl("")).toThrow(UnsafeUrlError);
  });
});
