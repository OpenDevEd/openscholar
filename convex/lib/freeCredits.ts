import { getFreeCreditCapForPlan, type PlanType } from "./constants";

export type ApplyFreeCreditCapArgs = {
  currentFreeBalance: number;
  amountToAdd: number;
  cap: number;
};

export type ApplyFreeCreditCapResult = {
  newFreeBalance: number;
  actualAdded: number;
  cap: number;
};

export function applyFreeCreditCap(args: ApplyFreeCreditCapArgs): ApplyFreeCreditCapResult {
  const { currentFreeBalance, amountToAdd, cap } = args;

  if (amountToAdd <= 0) {
    return {
      newFreeBalance: currentFreeBalance + amountToAdd,
      actualAdded: amountToAdd,
      cap,
    };
  }

  if (currentFreeBalance >= cap) {
    return {
      newFreeBalance: currentFreeBalance,
      actualAdded: 0,
      cap,
    };
  }

  const newFreeBalance = Math.min(currentFreeBalance + amountToAdd, cap);

  return {
    newFreeBalance,
    actualAdded: newFreeBalance - currentFreeBalance,
    cap,
  };
}

export function applyTierFreeCreditCap(args: {
  plan: PlanType;
  currentFreeBalance: number;
  amountToAdd: number;
}): ApplyFreeCreditCapResult {
  const cap = getFreeCreditCapForPlan(args.plan);
  return applyFreeCreditCap({
    currentFreeBalance: args.currentFreeBalance,
    amountToAdd: args.amountToAdd,
    cap,
  });
}
