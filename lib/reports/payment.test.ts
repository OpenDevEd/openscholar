import { describe, expect, it } from "vitest";
import { payment } from "./report";

describe("what paying for a report comes to", () => {
  it("takes the price from the balance, and has a card buy exactly what is missing", () => {
    expect(payment({ price: 10, balance: 12, payWith: "balance", off: 0 })).toEqual({ fromBalance: 10, bought: 0, spare: 0, discount: 0, due: 0 });
    // $4.50 held: the balance pays all of it, and the card the other $5.50.
    expect(payment({ price: 10, balance: 4.5, payWith: "balance", off: 0 })).toEqual({ fromBalance: 4.5, bought: 5.5, spare: 0, discount: 0, due: 5.5 });
    // To the cent, whatever binary arithmetic makes of 10 - 4.33, and never a cent short of the price.
    expect(payment({ price: 10, balance: 4.33, payWith: "balance", off: 0 })).toMatchObject({ fromBalance: 4.33, bought: 5.67, due: 5.67 });
    expect(payment({ price: 10, balance: 4.333, payWith: "balance", off: 0 })).toMatchObject({ fromBalance: 4.33, bought: 5.67 });
    // A balance a hair under $4.33 doesn't hold $4.33: counting on it would leave the price a hair short once bought.
    expect(payment({ price: 10, balance: 4.329999999, payWith: "balance", off: 0 })).toMatchObject({ fromBalance: 4.32, bought: 5.68 });
    expect(payment({ price: 10, balance: 0, payWith: "balance", off: 0 })).toMatchObject({ fromBalance: 0, bought: 10, due: 10 });
    // A balance with no limit pays all of it, and one Autumn has below nothing pays none.
    expect(payment({ price: 30, balance: null, payWith: "balance", off: 0 })).toMatchObject({ fromBalance: 30, bought: 0, due: 0 });
    expect(payment({ price: 10, balance: -2, payWith: "balance", off: 0 })).toMatchObject({ fromBalance: 0, bought: 10 });
  });

  it("has a card buy at least a dollar, which Stripe takes: what that leaves over stays in the balance", () => {
    // 20 cents short: the card buys $1, the balance pays the other $9 and keeps 80 cents.
    expect(payment({ price: 10, balance: 9.8, payWith: "balance", off: 0 })).toEqual({ fromBalance: 9, bought: 1, spare: 0.8, discount: 0, due: 1 });
    expect(payment({ price: 10, balance: 9.8, payWith: "balance", off: 0.5 })).toMatchObject({ bought: 1, discount: 0.5, due: 0.5 });
    expect(payment({ price: 10, balance: 9, payWith: "balance", off: 0 })).toMatchObject({ fromBalance: 9, bought: 1, spare: 0 });
  });

  it("by card, buys the whole price whatever the balance holds", () => {
    expect(payment({ price: 30, balance: 50, payWith: "card", off: 0 })).toEqual({ fromBalance: 0, bought: 30, spare: 0, discount: 0, due: 30 });
  });

  it("takes a code off what the card buys, never off what the balance pays", () => {
    expect(payment({ price: 10, balance: 4.5, payWith: "balance", off: 0.5 })).toEqual({ fromBalance: 4.5, bought: 5.5, spare: 0, discount: 2.75, due: 2.75 });
    expect(payment({ price: 10, balance: 12, payWith: "balance", off: 0.5 })).toMatchObject({ discount: 0, due: 0 });
    expect(payment({ price: 30, balance: 0, payWith: "card", off: 1 })).toMatchObject({ discount: 30, due: 0 });
    // Half off $5.67 is $2.835: Autumn, which quotes and bills it, rounds what is to pay up, so $2.84 is due.
    expect(payment({ price: 10, balance: 4.33, payWith: "balance", off: 0.5 })).toMatchObject({ bought: 5.67, discount: 2.83, due: 2.84 });
    expect(payment({ price: 10, balance: 4.99, payWith: "balance", off: 0.5 })).toMatchObject({ bought: 5.01, discount: 2.5, due: 2.51 });
    // A third off $10 is $3.33, to the cent.
    expect(payment({ price: 10, balance: 0, payWith: "card", off: 1 / 3 })).toMatchObject({ discount: 3.33, due: 6.67 });
  });
});
