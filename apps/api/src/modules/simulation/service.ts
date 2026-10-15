import { withTransaction, type Database } from '../../db/queryable.js';
import { ApiError } from '../../http/errors.js';
import { createShopUsers, deleteUsers } from '../identity/index.js';
import { deleteSimulatedShops, insertSimulatedShops } from '../shops/index.js';
import { generateShops, type GenerateInput } from './generate.js';

export interface SimulatedShopLogin {
  shopId: string;
  token: string;
}

class PhoneClash extends Error {}

/** A phone already belongs to someone (an earlier batch with the same seed): try the next seed. */
const MAX_ATTEMPTS = 10;

/**
 * Creates simulated users, sessions and shops in one transaction and returns each shop's id with
 * the owner's session token, so the simulator can answer pings as that shop through the real API.
 */
export async function createSimulatedShops(
  db: Database,
  input: GenerateInput,
): Promise<SimulatedShopLogin[]> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const specs = generateShops({ ...input, seed: input.seed + attempt });
    try {
      return await withTransaction(db, async (tx) => {
        const users = await createShopUsers(
          tx,
          specs.map((s) => s.phone),
        );
        if (!users) throw new PhoneClash();
        const ids = await insertSimulatedShops(
          tx,
          specs.map((s, i) => ({
            ownerUserId: (users[i] as { userId: string }).userId,
            phone: s.phone,
            name: s.name,
            lat: s.lat,
            lng: s.lng,
            categories: s.categories,
          })),
        );
        return ids.map((shopId, i) => ({ shopId, token: (users[i] as { token: string }).token }));
      });
    } catch (error) {
      if (!(error instanceof PhoneClash)) throw error;
    }
  }
  throw new ApiError(409, 'phones_taken', 'Could not find free phone numbers; use another seed');
}

/** Removes every simulated shop with its owner user (sessions), pings and stock. */
export async function removeSimulatedShops(
  db: Database,
): Promise<{ shops: number; users: number }> {
  return withTransaction(db, async (tx) => {
    const owners = await deleteSimulatedShops(tx);
    const users = owners.length > 0 ? await deleteUsers(tx, owners) : 0;
    return { shops: owners.length, users };
  });
}
