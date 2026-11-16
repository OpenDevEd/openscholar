import { describe, expect, it } from "vitest";
import { payment } from "./report";

describe("what paying for a report comes to", () => {
  it("takes the price from the balance, and has a card buy exactly what is missing", () => {
    expect(payment({ price: 10, balance: 12, payWith: "balance", off: 0 })).toEqual({ fromBalance: 10, bought: 0, spare: 0, raised: false, discount: 0, fromCredit: 0, idle: 0, due: 0 });
    // $4.50 held: the balance pays all of it, and the card the other $5.50.
    expect(payment({ price: 10, balance: 4.5, payWith: "balance", off: 0 })).toEqual({ fromBalance: 4.5, bought: 5.5, spare: 0, raised: false, discount: 0, fromCredit: 0, idle: 0, due: 5.5 });
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
    expect(payment({ price: 10, balance: 9.8, payWith: "balance", off: 0 })).toEqual({ fromBalance: 9, bought: 1, spare: 0.8, raised: false, discount: 0, fromCredit: 0, idle: 0, due: 1 });
    expect(payment({ price: 10, balance: 9.8, payWith: "balance", off: 0.5 })).toMatchObject({ bought: 1, discount: 0.5, due: 0.5 });
    expect(payment({ price: 10, balance: 9, payWith: "balance", off: 0 })).toMatchObject({ fromBalance: 9, bought: 1, spare: 0 });
  });

  it("by card, buys the whole price whatever the balance holds", () => {
    expect(payment({ price: 30, balance: 50, payWith: "card", off: 0 })).toEqual({ fromBalance: 0, bought: 30, spare: 0, raised: false, discount: 0, fromCredit: 0, idle: 0, due: 30 });
  });

  it("takes a code off what the card buys, never off what the balance pays", () => {
    expect(payment({ price: 10, balance: 4.5, payWith: "balance", off: 0.5 })).toEqual({ fromBalance: 4.5, bought: 5.5, spare: 0, raised: false, discount: 2.75, fromCredit: 0, idle: 0, due: 2.75 });
    expect(payment({ price: 10, balance: 12, payWith: "balance", off: 0.5 })).toMatchObject({ discount: 0, due: 0 });
    expect(payment({ price: 30, balance: 0, payWith: "card", off: 1 })).toMatchObject({ discount: 30, due: 0 });
    // Half off $5.67 is $2.835: Autumn, which quotes and bills it, rounds what is to pay up, so $2.84 is due.
    expect(payment({ price: 10, balance: 4.33, payWith: "balance", off: 0.5 })).toMatchObject({ bought: 5.67, discount: 2.83, due: 2.84 });
    expect(payment({ price: 10, balance: 4.99, payWith: "balance", off: 0.5 })).toMatchObject({ bought: 5.01, discount: 2.5, due: 2.51 });
    // A third off $10 is $3.33, to the cent.
    expect(payment({ price: 10, balance: 0, payWith: "card", off: 1 / 3 })).toMatchObject({ discount: 3.33, due: 6.67 });
  });

  it("takes Stripe credit off what a saved card pays, after the balance and the code", () => {
    expect(payment({ price: 10, balance: 0, payWith: "card", off: 0, credit: 70.39 })).toMatchObject({ fromCredit: 10, idle: 0, due: 0 });
    expect(payment({ price: 10, balance: 0, payWith: "card", off: 0, credit: 3 })).toMatchObject({ fromCredit: 3, due: 7 });
    // The balance pays $4.50, the card buys $5.50, and the credit takes $3 of that.
    expect(payment({ price: 10, balance: 4.5, payWith: "balance", off: 0, credit: 3 })).toEqual({ fromBalance: 4.5, bought: 5.5, spare: 0, raised: false, discount: 0, fromCredit: 3, idle: 0, due: 2.5 });
    // A code comes off first: half of $10 leaves $5, which $3 of credit lowers to $2.
    expect(payment({ price: 10, balance: 0, payWith: "card", off: 0.5, credit: 3 })).toMatchObject({ discount: 5, fromCredit: 3, due: 2 });
    expect(payment({ price: 10, balance: 12, payWith: "balance", off: 0, credit: 3 })).toMatchObject({ fromCredit: 0, idle: 0, due: 0 });
  });

  it("with no card saved, counts Stripe credit only when it covers it all, as Stripe's page doesn't use it", () => {
    expect(payment({ price: 10, balance: 0, payWith: "card", off: 0, credit: 70.39, cardSaved: false })).toMatchObject({ fromCredit: 10, idle: 0, due: 0 });
    expect(payment({ price: 10, balance: 0, payWith: "card", off: 0, credit: 3, cardSaved: false })).toMatchObject({ fromCredit: 0, idle: 3, due: 10 });
    expect(payment({ price: 10, balance: 4.5, payWith: "balance", off: 0, credit: 5.5, cardSaved: false })).toMatchObject({ fromCredit: 5.5, idle: 0, due: 0 });
  });

  it("has a card pay at least Stripe's least charge, keeping what that buys past the price in the balance", () => {
    // $9.70 in the balance and $0.70 of credit: a card would pay $0.30, which Stripe leaves owed. It buys $1.20 and pays $0.50.
    expect(payment({ price: 10, balance: 9.7, payWith: "balance", off: 0, credit: 0.7 })).toEqual({ fromBalance: 8.8, bought: 1.2, spare: 0.9, raised: true, discount: 0, fromCredit: 0.7, idle: 0, due: 0.5 });
    // By card, $9.80 of credit: the card buys $10.30, pays $0.50, and $0.30 stays in the balance.
    expect(payment({ price: 10, balance: 0, payWith: "card", off: 0, credit: 9.8 })).toMatchObject({ bought: 10.3, spare: 0.3, raised: true, fromCredit: 9.8, due: 0.5 });
    // With half off, $1 bought leaves $0.50, which Stripe charges: nothing more is bought.
    expect(payment({ price: 10, balance: 9.5, payWith: "balance", off: 0.5 })).toMatchObject({ bought: 1, raised: false, due: 0.5 });
    // With 60% off, $1 bought leaves $0.40: it buys $1.25, which leaves $0.50.
    expect(payment({ price: 10, balance: 9.5, payWith: "balance", off: 0.6 })).toMatchObject({ bought: 1.25, raised: true, due: 0.5 });
    // Nothing left for a card, or credit that covers it all, needs nothing more.
    expect(payment({ price: 10, balance: 0, payWith: "card", off: 0, credit: 10 })).toMatchObject({ bought: 10, raised: false, due: 0 });
  });
});
