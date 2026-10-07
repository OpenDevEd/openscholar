import { getDocumentSize } from "convex/values";
import { QueryStream } from "convex-helpers/server/stream";

type Item = NonNullable<unknown>;

/**
 * A stream of what \`load\` makes of each row of \`rows\`, in their order and with their
 * cursor, where what it loads counts toward the page's \`maximumBytesRead\`: a page of
 * small index rows joined to large documents stops on the joined bytes, not the rows'.
 * \`size\` is the bytes the join adds; by default the whole loaded document.
 */
export class JoinStream<Row extends Item, Out extends Item> extends QueryStream<Out> {
  constructor(
    private rows: QueryStream<Row>,
    private load: (row: Row) => Promise<Out | null>,
    private size: (out: Out) => number = (out) => getDocumentSize(out as never),
  ) {
    super();
  }
  getOrder() { return this.rows.getOrder(); }
  getIndexFields() { return this.rows.getIndexFields(); }
  getEqualityIndexFilter() { return this.rows.getEqualityIndexFilter(); }
  narrow(bounds: Parameters<QueryStream<Row>["narrow"]>[0]): JoinStream<Row, Out> {
    return new JoinStream(this.rows.narrow(bounds), this.load, this.size);
  }
  iterWithKeys(trackBandwidth = false): ReturnType<QueryStream<Out>["iterWithKeys"]> {
    const { rows, load, size } = this;
    return {
      [Symbol.asyncIterator]() {
        const iterator = rows.iterWithKeys(trackBandwidth)[Symbol.asyncIterator]();
        return {
          async next() {
            const next = await iterator.next();
            if (next.done) return { done: true as const, value: undefined };
            const [row, key, bytes] = next.value;
            const out = row ? await load(row) : null;
            return { done: false as const, value: [out, key, bytes + (out && trackBandwidth ? size(out) : 0)] as const };
          },
        };
      },
    };
  }
}
