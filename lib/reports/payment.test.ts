import { describe, expect, it } from "vitest";
import { payment } from "./report";

describe("what paying for a report comes to", () => {
  it("takes the price from the balance, and has a card buy what is missing in whole dollars", () => {
    expect(payment({ price: 10, balance: 12, payWith: "balance", off: 0 })).toEqual({ fromBalance: 10, bought: 0, discount: 0, due: 0 });
    // $4.50 held: the card buys $6, and the half dollar stays in the balance.
    expect(payment({ price: 10, balance: 4.5, payWith: "balance", off: 0 })).toEqual({ fromBalance: 4, bought: 6, discount: 0, due: 6 });
    expect(payment({ price: 10, balance: 0, payWith: "balance", off: 0 })).toMatchObject({ fromBalance: 0, bought: 10, due: 10 });
    // A balance with no limit pays all of it, and one Autumn has below nothing pays none.
    expect(payment({ price: 30, balance: null, payWith: "balance", off: 0 })).toMatchObject({ fromBalance: 30, bought: 0, due: 0 });
    expect(payment({ price: 10, balance: -2, payWith: "balance", off: 0 })).toMatchObject({ fromBalance: 0, bought: 10 });
  });

  it("by card, buys the whole price whatever the balance holds", () => {
    expect(payment({ price: 30, balance: 50, payWith: "card", off: 0 })).toEqual({ fromBalance: 0, bought: 30, discount: 0, due: 30 });
  });

  it("takes a code off what the card buys, never off what the balance pays", () => {
    expect(payment({ price: 10, balance: 4.5, payWith: "balance", off: 0.5 })).toEqual({ fromBalance: 4, bought: 6, discount: 3, due: 3 });
    expect(payment({ price: 10, balance: 12, payWith: "balance", off: 0.5 })).toMatchObject({ discount: 0, due: 0 });
    expect(payment({ price: 30, balance: 0, payWith: "card", off: 1 })).toMatchObject({ discount: 30, due: 0 });
    // A third off $10 is $3.33, to the cent.
    expect(payment({ price: 10, balance: 0, payWith: "card", off: 1 / 3 })).toMatchObject({ discount: 3.33, due: 6.67 });
  });
});
