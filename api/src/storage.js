const PARTITION = "waitlist";
const COOLDOWN_MS = 60 * 60 * 1000;

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isConflict(error) {
  return error.statusCode === 409 || error.statusCode === 412;
}

export function isMissingEntity(error) {
  return error.statusCode === 404 && ["ResourceNotFound", "EntityNotFound"].includes(error.code);
}

export class WaitlistStore {
  constructor(table, limits) {
    this.table = table;
    this.limits = limits;
  }

  async get(id) {
    try {
      return await this.table.getEntity(PARTITION, id);
    } catch (error) {
      if (isMissingEntity(error)) return null;
      throw error;
    }
  }

  async claim(record, now) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await this.get(record.rowKey);
      if (existing && (existing.status === "confirmed" ||
          now - Date.parse(existing.lastRequestedAt) < COOLDOWN_MS)) return false;
      try {
        if (existing) {
          await this.table.updateEntity({ ...record, partitionKey: PARTITION }, "Replace", { etag: existing.etag });
        } else {
          await this.table.createEntity({ ...record, partitionKey: PARTITION });
        }
        return true;
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    throw new RequestError(503, "The waitlist is busy. Please try again shortly.");
  }

  async reserveEmail(now, limit) {
    const window = new Date(now).toISOString().slice(0, 13);
    for (let attempt = 0; attempt < 5; attempt++) {
      let existing;
      try {
        existing = await this.limits.getEntity("limits", "email-budget");
      } catch (error) {
        if (!isMissingEntity(error)) throw error;
      }
      const count = existing?.window === window ? existing.count : 0;
      if (count >= limit) throw new RequestError(429, "The waitlist is receiving too many requests. Please try again in an hour.");
      const record = { partitionKey: "limits", rowKey: "email-budget", window, count: count + 1 };
      try {
        if (existing) {
          await this.limits.updateEntity(record, "Replace", { etag: existing.etag });
        } else {
          await this.limits.createEntity(record);
        }
        return;
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    throw new RequestError(503, "The waitlist is busy. Please try again shortly.");
  }

  async releaseFailedClaim(id, generation, now) {
    const record = await this.get(id);
    if (!record || record.generation !== generation || record.status !== "pending") return;
    try {
      await this.table.updateEntity({
        partitionKey: PARTITION,
        rowKey: id,
        lastRequestedAt: new Date(now - COOLDOWN_MS + 60_000).toISOString(),
      }, "Merge", { etag: record.etag });
    } catch (error) {
      if (!isConflict(error)) throw error;
    }
  }

  async confirm(id, generation, now) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const record = await this.get(id);
      if (!record || record.generation !== generation) return false;
      if (record.status === "confirmed") return true;
      if (Date.parse(record.expiresAt) <= now) return false;
      try {
        await this.table.updateEntity({
          partitionKey: PARTITION,
          rowKey: id,
          status: "confirmed",
          confirmedAt: new Date(now).toISOString(),
        }, "Merge", { etag: record.etag });
        return true;
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    throw new RequestError(503, "The waitlist is busy. Please try again shortly.");
  }

  async remove(id, generation) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const record = await this.get(id);
      if (!record) return true;
      if (record.generation !== generation) return false;
      try {
        await this.table.deleteEntity(PARTITION, id, { etag: record.etag });
        return true;
      } catch (error) {
        if (isMissingEntity(error)) return true;
        if (!isConflict(error)) throw error;
      }
    }
    throw new RequestError(503, "The waitlist is busy. Please try again shortly.");
  }
}
