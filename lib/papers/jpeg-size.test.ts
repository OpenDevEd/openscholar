import { describe, expect, it } from "vitest";
import { jpegSize } from "./jpeg-size";

// A report's cover is a JPEG; its stored shape, which the cover's frame takes, is read from its header (#cover-shape).
const segment = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
const jpeg = (...parts: number[][]) => new Uint8Array([0xff, 0xd8, ...parts.flat(), 0xff, 0xd9]);
// A baseline frame header: 8-bit precision, 450 tall, 800 wide, one component.
const sof = (marker: number) => segment(marker, [8, 0x01, 0xc2, 0x03, 0x20, 1, 1, 0x11, 0]);

describe("a JPEG's size", () => {
  it("is read from its frame header, after the segments before it", () => {
    expect(jpegSize(jpeg(segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), segment(0xdb, Array(65).fill(1)), sof(0xc0)))).toEqual({ width: 800, height: 450 });
  });
  it("is read from a progressive one too, past its Huffman tables", () => {
    expect(jpegSize(jpeg(segment(0xc4, Array(20).fill(0)), sof(0xc2)))).toEqual({ width: 800, height: 450 });
  });
  it("is unknown for anything else", () => {
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(jpegSize(jpeg(segment(0xe0, [1, 2, 3])))).toBeNull();
  });
});
