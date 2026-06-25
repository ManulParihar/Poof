import { describe, it, expect, vi } from "vitest";
import { jitterMs, pickDecoyAmount, runDecoyRounds, type DecoyRoundInfo } from "./decoy";

const ADDR = { pubkey: "123", encPub: "a".repeat(64) };

describe("decoy helpers", () => {
  it("jitter stays within bounds", () => {
    for (let i = 0; i < 100; i++) {
      const ms = jitterMs(2, 5);
      expect(ms).toBeGreaterThanOrEqual(2000);
      expect(ms).toBeLessThanOrEqual(5000);
    }
  });

  it("picks a positive sub-balance amount", () => {
    const bal = 100_0000000n;
    for (let i = 0; i < 50; i++) {
      const a = pickDecoyAmount(bal);
      expect(a).toBeGreaterThan(0n);
      expect(a).toBeLessThanOrEqual(bal);
    }
    expect(pickDecoyAmount(0n)).toBe(0n);
  });
});

describe("runDecoyRounds", () => {
  it("runs all rounds and self-sends each time", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const phases: DecoyRoundInfo[] = [];
    const done = await runDecoyRounds({
      rounds: 3, currencyId: 0, minDelaySec: 0, maxDelaySec: 0,
      send, address: ADDR, balanceOf: () => 10_0000000n,
      onRound: (i) => phases.push(i),
    });
    expect(done).toBe(3);
    expect(send).toHaveBeenCalledTimes(3);
    // each call targets our own address
    for (const call of send.mock.calls) {
      expect(call[1]).toBe(ADDR.pubkey);
      expect(call[2]).toBe(ADDR.encPub);
      expect(call[3]).toBeGreaterThan(0n);
    }
    expect(phases.filter((p) => p.phase === "done")).toHaveLength(3);
  });

  it("stops on a send failure", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("boom"));
    const done = await runDecoyRounds({
      rounds: 5, currencyId: 0, minDelaySec: 0, maxDelaySec: 0,
      send, address: ADDR, balanceOf: () => 10_0000000n,
    });
    expect(done).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("stops when there's no balance", async () => {
    const send = vi.fn();
    const done = await runDecoyRounds({
      rounds: 3, currencyId: 0, minDelaySec: 0, maxDelaySec: 0,
      send, address: ADDR, balanceOf: () => 0n,
    });
    expect(done).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("honors an aborted signal before sending", async () => {
    const send = vi.fn();
    const ac = new AbortController();
    ac.abort();
    const done = await runDecoyRounds({
      rounds: 3, currencyId: 0, minDelaySec: 0, maxDelaySec: 0,
      send, address: ADDR, balanceOf: () => 10_0000000n, signal: ac.signal,
    });
    expect(done).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
