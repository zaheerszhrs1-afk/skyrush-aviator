import * as crypto from "node:crypto";
import type { BetSlot, PublicBet, RoundPhase } from "./types.js";

const BOT_COUNT = 75;

const NAMES = [
  "Ali","Usman","Hassan","Ahmed","Bilal","Zain","Omar","Hamza","Tariq","Imran",
  "Faisal","Kamran","Adeel","Waqas","Asad","Raza","Shahid","Junaid","Naveed","Saad",
  "Umer","Fahad","Rizwan","Shoaib","Talha","Yasir","Zubair","Arif","Babar","Danish",
  "Ehsan","Farhan","Ghulam","Haris","Irfan","Jawad","Khalid","Luqman","Mansoor","Naeem",
  "Owais","Pervaiz","Qasim","Rehan","Salman","Tahir","Uzair","Waheed","Xander","Yousuf",
  "Zahid","Aamir","Basit","Daniyal","Ehtisham","Furqan","Ghazanfar","Haider","Ishaq","Javed",
  "Kashif","Liaqat","Murad","Noman","Obaid","Parvez","Qaiser","Rafiq","Sajid","Tanveer",
  "Umair","Vaqar","Waseem","Xain","Yaqoob"
];

interface BotBet extends PublicBet {
  targetCashout: number;
}

export class BotEngine {
  private bets: BotBet[] = [];

  /** Call once per round during WAITING phase */
  prepareRound(roundId: string, settings: { minBet: number; maxBet: number; maxCashoutMultiplier: number }): void {
    this.bets = [];
    for (let i = 0; i < BOT_COUNT; i++) {
      // ~20% sit out each round
      if (this.seeded(roundId, i, "skip") < 0.2) continue;

      const rAmt  = this.seeded(roundId, i, "amount");
      const rTgt  = this.seeded(roundId, i, "target");
      const rSlot = this.seeded(roundId, i, "slot");

      const minBet = settings.minBet;
      const maxBet = Math.min(settings.maxBet, 5_000);
      const amount = Math.round((minBet + rAmt * (maxBet - minBet)) / 16) * 16;
      const maxTarget = Math.min(settings.maxCashoutMultiplier, 8);
      const targetCashout = Number((1.05 + rTgt * (maxTarget - 1.05)).toFixed(2));
      const slot: BetSlot = rSlot > 0.5 ? "right" : "left";
      const name = NAMES[i % NAMES.length];

      this.bets.push({
        id: `bot-${roundId}-${i}`,
        player: `${name.slice(0, 1)}***${name.slice(-1)}`,
        amount,
        slot,
        status: "ACTIVE",
        targetCashout
      });
    }
  }

  /** Call every tick during RUNNING phase — marks bots as cashed out in-memory */
  onTick(phase: RoundPhase, multiplier: number): void {
    if (phase !== "RUNNING") return;
    for (const bet of this.bets) {
      if (bet.status !== "ACTIVE") continue;
      if (multiplier >= bet.targetCashout) {
        bet.status = "CASHED_OUT";
        bet.cashoutMultiplier = bet.targetCashout;
        bet.payout = Number((bet.amount * bet.targetCashout).toFixed(2));
      }
    }
  }

  /** Call when round crashes — mark remaining active bots as lost */
  settleLosses(): void {
    for (const bet of this.bets) {
      if (bet.status === "ACTIVE") bet.status = "LOST";
    }
  }

  getPublicBets(): PublicBet[] {
    return this.bets.map(({ targetCashout: _t, ...rest }) => rest);
  }

  getOnlineCount(connectedUsers: number): number {
    return BOT_COUNT + Math.max(0, connectedUsers);
  }

  private seeded(roundId: string, index: number, label: string): number {
    const hash = crypto.createHash("sha256").update(`${roundId}:${index}:${label}`).digest();
    return hash.readUInt32BE(0) / 0xffffffff;
  }
}
