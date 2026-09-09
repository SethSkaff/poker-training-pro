/** Physical denomination accounting. Poker legality and award amounts live elsewhere. */
export type ChipInventory = Readonly<Record<number, number>>;
export const CHIP_DENOMINATIONS = [1, 5, 25, 100, 500, 1_000, 5_000, 25_000, 100_000] as const;
export type ChipAccount = `player:${string}` | `bet:${string}` | `collected:${string}` | `pot:${string}` | "house";
export type ChipMovementReason = "small-blind" | "big-blind" | "ante" | "wager" | "collect" | "pot-allocation" | "refund" | "payout" | "change";
export interface ChipMovement {
  readonly sequence: number;
  readonly from: ChipAccount;
  readonly to: ChipAccount;
  readonly chips: ChipInventory;
  readonly value: number;
  readonly reason: ChipMovementReason;
  /** Both legs of an equal-value exchange share this ID. */
  readonly exchangeId?: number;
}
export interface ChipLedger {
  readonly version: 1;
  accounts: Partial<Record<ChipAccount, ChipInventory>>;
  readonly tournamentValue: number;
  readonly bankValue: number;
  readonly denominationTotals: ChipInventory;
  nextSequence: number;
  /** Current hand only; nextSequence remains monotonic across hands. */
  movements: ChipMovement[];
}

function amount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Chip amounts must be non-negative safe integers");
}

export function chipValue(chips: ChipInventory): number {
  let value = 0;
  for (const [key, count] of Object.entries(chips)) {
    const denomination = Number(key);
    if (!CHIP_DENOMINATIONS.includes(denomination as typeof CHIP_DENOMINATIONS[number])) {
      throw new Error(`Unknown chip denomination ${key}`);
    }
    amount(count);
    value += denomination * count;
    amount(value);
  }
  return value;
}

/** Deterministic issue rack, used once at entry, never to repack winnings. */
export function startingChipInventory(value: number): ChipInventory {
  amount(value);
  const chips: Record<number, number> = {};
  let remaining = value;
  // 5,000 in working chips supports the local 25/50 and regional 50/75 openings.
  if (remaining >= 5_000) {
    Object.assign(chips, { 25: 12, 100: 12, 500: 7 });
    remaining -= 5_000;
    const thousands = Math.min(10, Math.floor(remaining / 1_000));
    if (thousands) chips[1_000] = thousands;
    remaining -= thousands * 1_000;
  }
  // Opening racks use 5k as their largest denomination, even for a 60k event.
  for (const denomination of [...CHIP_DENOMINATIONS].reverse().filter((d) => d <= 5_000)) {
    const count = Math.floor(remaining / denomination);
    if (count) chips[denomination] = (chips[denomination] ?? 0) + count;
    remaining -= count * denomination;
  }
  return chips;
}

export function combineChipInventories(inventories: readonly (ChipInventory | undefined)[]): ChipInventory {
  const result: Record<number, number> = {};
  for (const chips of inventories) {
    if (!chips) continue;
    chipValue(chips);
    for (const [d, count] of Object.entries(chips)) result[Number(d)] = (result[Number(d)] ?? 0) + count;
  }
  return result;
}

export function createChipLedger(players: readonly { id: string; stack: number; chipInventory?: ChipInventory }[]): ChipLedger {
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new Error("Duplicate chip owner");
  const tournamentValue = players.reduce((sum, p) => { amount(p.stack); return sum + p.stack; }, 0);
  amount(tournamentValue);
  const accounts: ChipLedger["accounts"] = {};
  for (const p of players) {
    const inventory = p.chipInventory ?? startingChipInventory(p.stack);
    if (chipValue(inventory) !== p.stack) throw new Error(`Opening inventory does not match ${p.id}'s stack`);
    accounts[`player:${p.id}`] = { ...inventory };
  }
  // Finite reserve: enough of each denomination to exchange the entire field.
  // House value is separate from tournament money and cannot be awarded.
  accounts.house = Object.fromEntries(CHIP_DENOMINATIONS.map((d) => [d, Math.ceil(tournamentValue / d)]));
  const ledger: ChipLedger = {
    version: 1, accounts, tournamentValue, bankValue: chipValue(accounts.house),
    denominationTotals: combineChipInventories(Object.values(accounts)), nextSequence: 1, movements: [],
  };
  assertChipLedger(ledger);
  return ledger;
}

export function cloneChipLedger(source: ChipLedger, newHand = false): ChipLedger {
  return {
    ...source,
    accounts: Object.fromEntries(Object.entries(source.accounts).map(([id, chips]) => [id, { ...chips }])),
    movements: newHand ? [] : [...source.movements],
  };
}

export function accountChips(ledger: ChipLedger, account: ChipAccount): ChipInventory {
  return ledger.accounts[account] ?? {};
}

/** Bounded exact selection: prefer larger available chips, backtrack when necessary. */
function select(chips: ChipInventory, value: number): ChipInventory | undefined {
  const denominations = [...CHIP_DENOMINATIONS].reverse().filter((d) => (chips[d] ?? 0) > 0);
  const suffix = new Array<number>(denominations.length + 1).fill(0);
  for (let i = denominations.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + denominations[i] * chips[denominations[i]];
  const failed = new Set<string>();
  function search(index: number, remaining: number): Record<number, number> | undefined {
    if (!remaining) return {};
    if (index === denominations.length || remaining > suffix[index]) return undefined;
    const key = `${index}:${remaining}`;
    if (failed.has(key)) return undefined;
    const d = denominations[index];
    const minimum = Math.max(0, Math.ceil((remaining - suffix[index + 1]) / d));
    for (let count = Math.min(chips[d], Math.floor(remaining / d)); count >= minimum; count--) {
      const tail = search(index + 1, remaining - count * d);
      if (tail) return count ? { ...tail, [d]: count } : tail;
    }
    failed.add(key);
    return undefined;
  }
  return search(0, value);
}

function move(ledger: ChipLedger, from: ChipAccount, to: ChipAccount, chips: ChipInventory, reason: ChipMovementReason, exchangeId?: number): void {
  const value = chipValue(chips);
  if (!value) return;
  const debit = { ...accountChips(ledger, from) };
  const credit = { ...accountChips(ledger, to) };
  for (const [key, count] of Object.entries(chips)) {
    const d = Number(key);
    if ((debit[d] ?? 0) < count) throw new Error(`Insufficient ${d} chips in ${from}`);
    debit[d] -= count;
    if (!debit[d]) delete debit[d];
    credit[d] = (credit[d] ?? 0) + count;
  }
  ledger.accounts[from] = debit;
  ledger.accounts[to] = credit;
  ledger.movements.push({ sequence: ledger.nextSequence++, from, to, chips: { ...chips }, value, reason, ...(exchangeId === undefined ? {} : { exchangeId }) });
}

/** Mutates a transaction-local ledger. Failed transactions must be discarded. */
export function transferChipValue(ledger: ChipLedger, from: ChipAccount, to: ChipAccount, value: number, reason: ChipMovementReason): void {
  amount(value);
  if (from === to || from === "house" || to === "house") throw new Error("Use an equal-value exchange for house transfers");
  if (chipValue(accountChips(ledger, from)) < value) throw new Error(`Insufficient chip value in ${from}`);
  let selection = select(accountChips(ledger, from), value);
  const unit = [...CHIP_DENOMINATIONS].reverse().find((d) => value % d === 0 &&
    Object.entries(accountChips(ledger, from)).every(([key, count]) => !count || Number(key) % d === 0)) ?? 1;
  while (!selection) {
    // Break the smallest available chip that can improve granularity. Every
    // exchange lowers denomination, so this terminates even for exact all-ins.
    const d = CHIP_DENOMINATIONS.find((candidate) => candidate > unit && (accountChips(ledger, from)[candidate] ?? 0) > 0);
    if (!d) throw new Error("Cannot make exact chip change");
    const smaller = Object.fromEntries(Object.entries(accountChips(ledger, "house")).filter(([key]) => Number(key) < d));
    const change = select(smaller, d);
    if (!change) throw new Error("Dealer bank cannot make change");
    const exchangeId = ledger.nextSequence;
    move(ledger, from, "house", { [d]: 1 }, "change", exchangeId);
    move(ledger, "house", from, change, "change", exchangeId);
    selection = select(accountChips(ledger, from), value);
  }
  move(ledger, from, to, selection, reason);
}

export function collectChipBets(ledger: ChipLedger): void {
  for (const key of Object.keys(ledger.accounts).sort()) {
    if (!key.startsWith("bet:")) continue;
    const from = key as ChipAccount;
    transferChipValue(ledger, from, `collected:${key.slice(4)}`, chipValue(accountChips(ledger, from)), "collect");
  }
}

export function assertChipLedger(ledger: ChipLedger): void {
  const total = combineChipInventories(Object.values(ledger.accounts));
  for (const d of CHIP_DENOMINATIONS) {
    if ((total[d] ?? 0) !== (ledger.denominationTotals[d] ?? 0)) throw new Error(`Chip quantity conservation failed for ${d}`);
  }
  if (chipValue(accountChips(ledger, "house")) !== ledger.bankValue) throw new Error("Dealer bank value changed");
  if (chipValue(total) - ledger.bankValue !== ledger.tournamentValue) throw new Error("Tournament chip value changed");
}
