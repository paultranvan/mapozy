// travels -> client -> auth -> expo-secure-store (native ESM); mock so Jest can
// load the module graph (TiimeApiError is a value import from ../client).
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import type { Db } from '../../../db/client';
import { createMockDb } from '../../../db/mockDb';
import { runMigrations } from '../../../db/migrations';
import { listDiagnosticEvents } from '../../../db/diagnostics';
import {
  listCandidates,
  retryExpenseReport,
  sendCandidate,
  travelSignature,
  type Coord,
  type ExpenseReportContext,
  type TiimeCandidate,
} from '../travels';
import { listFailedExpenseReports } from '../../../db/connectorTravels';
import { TiimeApiError } from '../client';

const EMPTY_ADDR = {
  street: null,
  houseNumber: null,
  postalCode: null,
  city: null,
  country: null,
};

// A place a user tagged as their workplace. Trips are matched to it by
// geographic proximity (nearestUserPoi), NOT via the trip's start/end place
// FK columns — those reference auto-clustered places that are frequently
// evicted/dangling and don't carry the user's category tag.
const WORK: Coord = { lat: 48.8, lon: 2.3 };
// Far outside the 100m work zone.
const HOME: Coord = { lat: 48.9, lon: 2.4 };
const ELSEWHERE_A: Coord = { lat: 48.95, lon: 2.5 };
const ELSEWHERE_B: Coord = { lat: 49.0, lon: 2.6 };

function lineStringGeojson(departure: Coord, arrival: Coord): string {
  return JSON.stringify({
    type: 'LineString',
    coordinates: [
      [departure.lon, departure.lat],
      [arrival.lon, arrival.lat],
    ],
  });
}

async function insertUserPlace(
  db: Db,
  opts: { name: string; category: string; coord: Coord; radiusM?: number }
): Promise<number> {
  const now = 1_700_000_000_000;
  const res = await db.runAsync(
    `INSERT INTO places(kind, name, category, latitude, longitude, radius_m, first_seen_ms, last_seen_ms)
     VALUES('user', ?, ?, ?, ?, ?, ?, ?)`,
    opts.name,
    opts.category,
    opts.coord.lat,
    opts.coord.lon,
    opts.radiusM ?? 100,
    now,
    now
  );
  return res.lastInsertRowId as number;
}

async function insertTrip(
  db: Db,
  opts: {
    departure: Coord;
    arrival: Coord;
    mode?: string;
    startMs?: number;
    distanceM?: number;
  }
): Promise<number> {
  const startMs = opts.startMs ?? 1_700_000_000_000;
  const geojson = lineStringGeojson(opts.departure, opts.arrival);
  const res = await db.runAsync(
    `INSERT INTO trips(start_time_ms, end_time_ms, distance_m, duration_s, dominant_mode, geojson, created_at_ms)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
    startMs,
    startMs + 1_800_000,
    opts.distanceM ?? 32000,
    1800,
    opts.mode ?? 'car',
    geojson,
    startMs
  );
  return res.lastInsertRowId as number;
}

function findCandidate(cands: TiimeCandidate[], tripId: number): TiimeCandidate | undefined {
  return cands.find((c) => c.tripId === tripId);
}

describe('travelSignature', () => {
  const startMs = 1_700_000_000_000;
  const base = { startMs, distanceM: 32000, departure: WORK, arrival: HOME };

  it('is stable for identical content and ignores trip id', () => {
    expect(travelSignature(base)).toBe(travelSignature({ ...base }));
  });

  it('differs when distance or endpoint coordinates differ', () => {
    expect(travelSignature(base)).not.toBe(travelSignature({ ...base, distanceM: 33000 }));
    expect(travelSignature(base)).not.toBe(
      travelSignature({ ...base, arrival: ELSEWHERE_A })
    );
    expect(travelSignature(base)).not.toBe(
      travelSignature({ ...base, departure: ELSEWHERE_A })
    );
  });

  it('produces the day|km|lat,lon|lat,lon coord-based format', () => {
    const d = new Date(startMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    const expectedDay = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const sig = travelSignature({
      startMs,
      distanceM: 32499,
      departure: { lat: 48.8, lon: 2.3 },
      arrival: { lat: 48.85001, lon: 2.35001 },
    });
    expect(sig).toBe(`${expectedDay}|32|48.8000,2.3000|48.8500,2.3500`);
  });
});

describe('listCandidates', () => {
  it('includes a car trip whose ARRIVAL lands inside a work-tagged place zone, with the place name as arrivalCompanyName', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const trip = await insertTrip(db, { departure: HOME, arrival: WORK });

    const cands = await listCandidates(db);
    const found = findCandidate(cands, trip);
    expect(found).toBeDefined();
    expect(found?.arrivalCompanyName).toBe('Acme Corp');
    expect(found?.departure).toEqual(HOME);
    expect(found?.arrival).toEqual(WORK);
  });

  it('includes a car trip whose DEPARTURE lands inside a work-tagged place zone', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const trip = await insertTrip(db, { departure: WORK, arrival: HOME });

    const cands = await listCandidates(db);
    expect(findCandidate(cands, trip)).toBeDefined();
  });

  it('excludes a car trip far from every work place', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const trip = await insertTrip(db, { departure: ELSEWHERE_A, arrival: ELSEWHERE_B });

    const cands = await listCandidates(db);
    expect(findCandidate(cands, trip)).toBeUndefined();
  });

  it('excludes a non-car trip even if it ends at the work place (mode filter)', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const trip = await insertTrip(db, { departure: HOME, arrival: WORK, mode: 'bike' });

    const cands = await listCandidates(db);
    expect(findCandidate(cands, trip)).toBeUndefined();
  });

  it('returns no candidates when the user has no work-tagged place at all', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Home', category: 'home', coord: HOME });
    await insertTrip(db, { departure: HOME, arrival: WORK });

    const cands = await listCandidates(db);
    expect(cands).toEqual([]);
  });

  it('excludes a recomputed trip (new trip id, same endpoints/day/km) already sent under a different id', async () => {
    // Core fix under test: Mapozy recompute deletes+recreates trips with a NEW
    // id but stable endpoint coordinates (from the geojson, not the volatile
    // place FK). A trip already sent to Tiime must not reappear as a
    // candidate just because its trip id changed.
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const tripA = await insertTrip(db, { departure: HOME, arrival: WORK });

    const post = jest.fn(async () => ({ id: 999 }));
    const client = { get: jest.fn(), post } as any;

    const candsBefore = await listCandidates(db);
    const candidate = findCandidate(candsBefore, tripA);
    if (!candidate) throw new Error('expected tripA to be a candidate');

    await sendCandidate(db, client, candidate, {
      vehicleId: 58697,
      companyId: 243813,
      roundTrip: false,
      arrivalCompanyName: 'Acme Corp',
      departure: EMPTY_ADDR,
      arrival: EMPTY_ADDR,
    });

    // Simulate recompute: a brand-new trip id, identical start time,
    // distance and endpoints (as a fresh geojson would still encode).
    const tripB = await insertTrip(db, { departure: HOME, arrival: WORK });
    expect(tripB).not.toBe(tripA);

    const candsAfter = await listCandidates(db);
    expect(findCandidate(candsAfter, tripB)).toBeUndefined();
  });

  it('sends a candidate, POSTs to the verified path, and records dedup', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const trip = await insertTrip(db, { departure: HOME, arrival: WORK });

    const post = jest.fn(async () => ({ id: 999 }));
    const client = { get: jest.fn(), post } as any;

    const cands = await listCandidates(db);
    const candidate = findCandidate(cands, trip);
    if (!candidate) throw new Error('expected a candidate');

    const result = await sendCandidate(db, client, candidate, {
      vehicleId: 58697,
      companyId: 243813,
      roundTrip: false,
      arrivalCompanyName: 'Acme Corp',
      departure: EMPTY_ADDR,
      arrival: EMPTY_ADDR,
    });

    expect(result.travelId).toBe(999);
    expect(post).toHaveBeenCalledWith(
      '/v1/companies/243813/users/me/travels',
      expect.objectContaining({ vehicle_id: 58697 })
    );

    const candsAfter = await listCandidates(db);
    expect(findCandidate(candsAfter, trip)).toBeUndefined();
  });

  it('logs a diagnostic with status+body on a failed send, and does not record dedup', async () => {
    const db = createMockDb();
    await runMigrations(db);
    await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
    const trip = await insertTrip(db, { departure: HOME, arrival: WORK });

    const post = jest.fn(async () => {
      throw new TiimeApiError('POST', '/v1/x', 500, '{"message":"nope"}');
    });
    const client = { get: jest.fn(), post } as any;

    const candidate = findCandidate(await listCandidates(db), trip);
    if (!candidate) throw new Error('expected a candidate');

    let threw = false;
    try {
      await sendCandidate(db, client, candidate, {
        vehicleId: 58697,
        companyId: 243813,
        roundTrip: false,
        arrivalCompanyName: 'Acme Corp',
        departure: EMPTY_ADDR,
        arrival: EMPTY_ADDR,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const events = await listDiagnosticEvents(db, { type: 'tiime_send' });
    expect(events.length).toBe(1);
    expect(events[0]!.payload).toMatchObject({
      ok: false,
      status: 500,
      body: '{"message":"nope"}',
    });
    // A failed send must NOT record dedup — the trip stays a candidate.
    expect(findCandidate(await listCandidates(db), trip)).toBeDefined();
  });
});

// --------------------------------------------------------------------------
// Expense reports. A Tiime travel is not claimable until it is attached to a
// mileage expense report, so a send optionally chains three more calls. The
// invariant under test throughout: creating the travel and creating its report
// are separate outcomes, and a failed report never un-sends a landed travel.
// --------------------------------------------------------------------------

const REPORT_CONTEXT: ExpenseReportContext = {
  owner: {
    id: 802498,
    firstname: 'Paul',
    lastname: 'Tran Van ',
    phone: null,
    email: 'paul@example.com',
    active_company: 243813,
    roles: ['ROLE_USER'],
  },
  vehicle: {
    id: 58697,
    name: 'Yaris ',
    created_at: '2026-07-25 14:46:25',
    is_mileage_updatable: true,
    owner: { id: 802498, firstname: 'Paul', lastname: 'Tran Van ' },
  },
};

const SEND_OPTS = {
  vehicleId: 58697,
  companyId: 243813,
  roundTrip: false,
  arrivalCompanyName: 'Acme Corp',
  departure: EMPTY_ADDR,
  arrival: EMPTY_ADDR,
};

/** A client whose POSTs are routed by path, so a test can fail exactly one leg
 *  of the chain while the others behave. */
function routedClient(overrides: Record<string, () => Promise<unknown>> = {}) {
  const calls: string[] = [];
  const post = jest.fn(async (path: string, body: any) => {
    calls.push(path);
    const override = Object.entries(overrides).find(([frag]) => path.includes(frag));
    if (override) return override[1]();
    if (path.includes('/travels')) return { id: 999 };
    if (path.includes('compute_travels_amount')) {
      return { travels: [{ ...body.travels[0], estimatedAmount: 7.69 }], expense_report_id: null };
    }
    if (path.includes('expense_reports')) return { id: 4242 };
    throw new Error(`unexpected POST ${path}`);
  });
  return { calls, client: { get: jest.fn(), post } as any };
}

async function candidateFor(db: Db, trip: number): Promise<TiimeCandidate> {
  const c = findCandidate(await listCandidates(db), trip);
  if (!c) throw new Error('expected a candidate');
  return c;
}

async function seedCandidate(db: Db): Promise<TiimeCandidate> {
  await runMigrations(db);
  await insertUserPlace(db, { name: 'Acme Corp', category: 'work', coord: WORK });
  const trip = await insertTrip(db, { departure: HOME, arrival: WORK });
  return candidateFor(db, trip);
}

describe('sendCandidate — expense report leg', () => {
  it('chains compute then create, and reports both ids', async () => {
    const db = createMockDb();
    const candidate = await seedCandidate(db);
    const { calls, client } = routedClient();

    const result = await sendCandidate(db, client, candidate, {
      ...SEND_OPTS,
      expenseReport: REPORT_CONTEXT,
    });

    expect(result).toEqual({ travelId: 999, expenseReportId: 4242, expenseReportError: null });
    expect(calls).toEqual([
      '/v1/companies/243813/users/me/travels',
      '/v1/accounts/companies/243813/compute_travels_amount',
      '/v1/accounts/companies/243813/users/me/expense_reports?expand=preview_available',
    ]);
  });

  it('sends the server-computed amount, not the 0 placeholder', async () => {
    const db = createMockDb();
    const candidate = await seedCandidate(db);
    const { client } = routedClient();

    await sendCandidate(db, client, candidate, { ...SEND_OPTS, expenseReport: REPORT_CONTEXT });

    const reportCall = client.post.mock.calls.find(([p]: [string]) =>
      p.includes('expense_reports')
    );
    expect(reportCall[1].travels[0].estimated_amount).toBe(7.69);
  });

  it('makes no /v1/accounts call at all when the report was not requested', async () => {
    const db = createMockDb();
    const candidate = await seedCandidate(db);
    const { calls, client } = routedClient();

    const result = await sendCandidate(db, client, candidate, SEND_OPTS);

    expect(result).toEqual({ travelId: 999, expenseReportId: null, expenseReportError: null });
    expect(calls.some((p) => p.includes('/v1/accounts/'))).toBe(false);
    expect(await listFailedExpenseReports(db, 'tiime')).toEqual([]);
  });

  it('keeps the travel deduped and does NOT throw when the report fails', async () => {
    const db = createMockDb();
    const candidate = await seedCandidate(db);
    const { client } = routedClient({
      expense_reports: async () => {
        throw new TiimeApiError('POST', '/v1/x', 422, '{"message":"nope"}');
      },
    });

    const result = await sendCandidate(db, client, candidate, {
      ...SEND_OPTS,
      expenseReport: REPORT_CONTEXT,
    });

    // The travel DID land in Tiime: re-sending it would duplicate it.
    expect(result.travelId).toBe(999);
    expect(result.expenseReportId).toBeNull();
    expect(result.expenseReportError).toContain('nope');
    expect(findCandidate(await listCandidates(db), candidate.tripId)).toBeUndefined();

    const failed = await listFailedExpenseReports(db, 'tiime');
    expect(failed).toHaveLength(1);
    // The computed travel is persisted, so the retry is a single call.
    expect(failed[0]!.travel?.estimated_amount).toBe(7.69);
    expect(failed[0]!.externalTravelId).toBe('999');
  });

  it('records a failure with no replayable body when the amount call is what failed', async () => {
    const db = createMockDb();
    const candidate = await seedCandidate(db);
    const { client } = routedClient({
      compute_travels_amount: async () => {
        throw new TiimeApiError('POST', '/v1/x', 500, 'boom');
      },
    });

    const result = await sendCandidate(db, client, candidate, {
      ...SEND_OPTS,
      expenseReport: REPORT_CONTEXT,
    });

    expect(result.travelId).toBe(999);
    expect(result.expenseReportError).toContain('boom');
    const failed = await listFailedExpenseReports(db, 'tiime');
    expect(failed[0]!.travel).toBeNull();
  });

  it('logs a diagnostic for the report leg on success and failure', async () => {
    const db = createMockDb();
    const candidate = await seedCandidate(db);
    const { client } = routedClient({
      expense_reports: async () => {
        throw new TiimeApiError('POST', '/v1/x', 422, 'bad');
      },
    });

    await sendCandidate(db, client, candidate, { ...SEND_OPTS, expenseReport: REPORT_CONTEXT });

    // Every step of the chain logs, so a failure is attributable to one of
    // them without reproducing it.
    const events = await listDiagnosticEvents(db, { type: 'tiime_expense_report' });
    const byStep = Object.fromEntries(
      events.map((e) => [(e.payload as any).step, e.payload as any])
    );
    expect(byStep.compute).toMatchObject({ ok: true, estimatedAmount: 7.69 });
    expect(byStep.create).toMatchObject({ ok: false, status: 422, body: 'bad' });
  });

  it('logs the response verbatim when no travel can be read out of it', async () => {
    // The failure seen on-device: HTTP 200, but nothing we could parse. Without
    // the body in the log there is nothing to debug from.
    const db = createMockDb();
    const candidate = await seedCandidate(db);
    const { client } = routedClient({
      compute_travels_amount: async () => ({ message: 'something else entirely' }),
    });

    const result = await sendCandidate(db, client, candidate, {
      ...SEND_OPTS,
      expenseReport: REPORT_CONTEXT,
    });

    expect(result.expenseReportError).toContain('returned no travel');
    const events = await listDiagnosticEvents(db, { type: 'tiime_expense_report' });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      ok: false,
      step: 'compute',
      error: 'no travel in response',
      response: { message: 'something else entirely' },
    });
    // The request that provoked it is logged too — both halves are needed.
    expect((events[0]!.payload as any).request.id).toBe(999);
  });
});

describe('retryExpenseReport', () => {
  it('replays only the final POST, from the stored computed travel', async () => {
    const db = createMockDb();
    const candidate = await seedCandidate(db);
    const failing = routedClient({
      expense_reports: async () => {
        throw new TiimeApiError('POST', '/v1/x', 500, 'down');
      },
    });
    await sendCandidate(db, failing.client, candidate, {
      ...SEND_OPTS,
      expenseReport: REPORT_CONTEXT,
    });
    const row = (await listFailedExpenseReports(db, 'tiime'))[0]!;

    const retry = routedClient();
    const reportId = await retryExpenseReport(db, retry.client, row, {
      companyId: 243813,
      owner: REPORT_CONTEXT.owner,
    });

    expect(reportId).toBe(4242);
    // No travel recreation, no second amount computation — a recomputed amount
    // could differ and silently change what is claimed.
    expect(retry.calls).toEqual([
      '/v1/accounts/companies/243813/users/me/expense_reports?expand=preview_available',
    ]);
    expect(await listFailedExpenseReports(db, 'tiime')).toEqual([]);
  });

  it('leaves the row retryable when the replay fails again', async () => {
    const db = createMockDb();
    const candidate = await seedCandidate(db);
    const failing = routedClient({
      expense_reports: async () => {
        throw new TiimeApiError('POST', '/v1/x', 500, 'down');
      },
    });
    await sendCandidate(db, failing.client, candidate, {
      ...SEND_OPTS,
      expenseReport: REPORT_CONTEXT,
    });
    const row = (await listFailedExpenseReports(db, 'tiime'))[0]!;

    await expect(
      retryExpenseReport(db, failing.client, row, {
        companyId: 243813,
        owner: REPORT_CONTEXT.owner,
      })
    ).rejects.toThrow();

    const still = await listFailedExpenseReports(db, 'tiime');
    expect(still).toHaveLength(1);
    expect(still[0]!.travel?.estimated_amount).toBe(7.69);
  });
});
