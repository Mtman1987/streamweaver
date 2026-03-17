import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

type PointsDoc = {
  points: number;
  username?: string;
  displayName?: string;
  updatedAt?: string;
};

export class PointsService {
  private static instance: PointsService;

  static getInstance(): PointsService {
    if (!PointsService.instance) {
      PointsService.instance = new PointsService();
    }
    return PointsService.instance;
  }

  private getUserRef(twitchId: string) {
    return doc(db, 'points', twitchId);
  }

  async getPoints(twitchId: string): Promise<number> {
    const snap = await getDoc(this.getUserRef(twitchId));
    const data = snap.exists() ? (snap.data() as Partial<PointsDoc>) : null;
    return typeof data?.points === 'number' ? data.points : 0;
  }

  async deductPoints(twitchId: string, amount: number): Promise<boolean> {
    const current = await this.getPoints(twitchId);
    if (current < amount) return false;

    await setDoc(
      this.getUserRef(twitchId),
      {
        points: current - amount,
        updatedAt: new Date().toISOString(),
      } satisfies PointsDoc,
      { merge: true }
    );

    return true;
  }

  async addPoints(
    twitchId: string,
    username: string | undefined,
    displayName: string | undefined,
    amount: number
  ): Promise<void> {
    const current = await this.getPoints(twitchId);

    await setDoc(
      this.getUserRef(twitchId),
      {
        points: current + amount,
        username,
        displayName,
        updatedAt: new Date().toISOString(),
      } satisfies PointsDoc,
      { merge: true }
    );
  }
}
