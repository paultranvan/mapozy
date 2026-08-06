// expenseReports -> client -> auth -> expo-secure-store (native ESM); mock so
// Jest can load the module graph.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import {
  buildComputeTravelDto,
  buildExpenseReportPayload,
  computeTravelAmount,
  extractComputedTravel,
  createExpenseReport,
  fetchExpenseReportVehicle,
  toComputeVehicle,
  toExpenseReportTravel,
  toExpenseReportVehicle,
} from '../expenseReports';
import type {
  TiimeComputeTravel,
  TiimeExpenseReportVehicleRaw,
  TiimeOwner,
  TiimeTravelPayload,
} from '../types';

// Captured verbatim from GET /v1/accounts/companies/243813/expense_report_vehicles.
const RAW_VEHICLE: TiimeExpenseReportVehicleRaw & {
  external_already_paid_amount: number;
  external_previous_distance: number;
} = {
  owner: { id: 802498, lastname: 'Tran Van ', firstname: 'Paul' },
  is_mileage_updatable: true,
  id: 58697,
  name: 'Yaris ',
  created_at: '2026-07-25 14:46:25',
  external_already_paid_amount: 0,
  external_previous_distance: 0,
};

const OWNER: TiimeOwner = {
  id: 802498,
  firstname: 'Paul',
  lastname: 'Tran Van ',
  phone: null,
  email: 'paul@example.com',
  active_company: 243813,
  roles: ['ROLE_USER'],
};

const TRAVEL_PAYLOAD: TiimeTravelPayload = {
  id: null,
  locked: null,
  comment: '',
  tags: [],
  date: '2026-07-22 07:45:28',
  distance: 18,
  departure_address: {
    street: '21 Allée du Parc de la Bièvre',
    postal_code: '94240',
    city: "L'Haÿ-les-Roses",
    country: 'France',
  },
  arrival_address: {
    street: '37 Rue Pierre Poli',
    postal_code: '92130',
    city: 'Issy-les-Moulineaux',
    country: 'France',
  },
  arrival_company_name: 'Linagora',
  vehicle_id: 58697,
  round_trip: false,
};

function computedTravel(): TiimeComputeTravel {
  // What compute_travels_amount returns: the DTO we sent, with the amount.
  return {
    ...buildComputeTravelDto({ travelId: 5561847, travel: TRAVEL_PAYLOAD, vehicle: RAW_VEHICLE }),
    estimatedAmount: 7.69,
  };
}

describe('toComputeVehicle', () => {
  it('drops the external_* fields the payloads never carry and emits archivedAt', () => {
    expect(toComputeVehicle(RAW_VEHICLE)).toEqual({
      id: 58697,
      createdAt: '2026-07-25 14:46:25',
      owner: { id: 802498, firstName: 'Paul', lastName: 'Tran Van ' },
      name: 'Yaris ',
      // Absent from the source response: a vehicle offered for an expense
      // report is active by definition.
      archivedAt: null,
      isMileageUpdatable: true,
    });
  });
});

describe('toExpenseReportVehicle', () => {
  it('adds owner_id and lowercases firstname/lastname (not first_name)', () => {
    expect(toExpenseReportVehicle(toComputeVehicle(RAW_VEHICLE))).toEqual({
      id: 58697,
      created_at: '2026-07-25 14:46:25',
      owner: { id: 802498, firstname: 'Paul', lastname: 'Tran Van ' },
      owner_id: 802498,
      name: 'Yaris ',
      archived_at: null,
      is_mileage_updatable: true,
    });
  });
});

describe('buildComputeTravelDto', () => {
  it('matches the captured compute_travels_amount request shape', () => {
    const dto = buildComputeTravelDto({
      travelId: 5561847,
      travel: TRAVEL_PAYLOAD,
      vehicle: RAW_VEHICLE,
    });
    expect(dto).toEqual({
      id: 5561847,
      date: '2026-07-22 07:45:28',
      locked: false,
      distance: 18,
      estimatedAmount: 0,
      comment: '',
      vehicle: {
        id: 58697,
        createdAt: '2026-07-25 14:46:25',
        owner: { id: 802498, firstName: 'Paul', lastName: 'Tran Van ' },
        name: 'Yaris ',
        archivedAt: null,
        isMileageUpdatable: true,
      },
      tags: [],
      vehicleOwner: { id: 802498, firstName: 'Paul', lastName: 'Tran Van ' },
      departureAddress: {
        street: '21 Allée du Parc de la Bièvre',
        postalCode: '94240',
        city: "L'Haÿ-les-Roses",
        country: 'France',
      },
      arrivalCompanyName: 'Linagora',
      arrivalAddress: {
        street: '37 Rue Pierre Poli',
        postalCode: '92130',
        city: 'Issy-les-Moulineaux',
        country: 'France',
      },
      roundTrip: false,
      isUsedByExpenseReport: false,
    });
  });

  it('sends estimatedAmount 0 — this call is what fills it in', () => {
    const dto = buildComputeTravelDto({
      travelId: 1,
      travel: TRAVEL_PAYLOAD,
      vehicle: RAW_VEHICLE,
    });
    expect(dto.estimatedAmount).toBe(0);
  });
});

describe('toExpenseReportTravel', () => {
  it('maps camelCase to snake_case, adding vehicle_id and dropping vehicleOwner', () => {
    const snake = toExpenseReportTravel(computedTravel());
    expect(snake).toEqual({
      id: 5561847,
      date: '2026-07-22 07:45:28',
      locked: false,
      distance: 18,
      estimated_amount: 7.69,
      comment: '',
      vehicle: {
        id: 58697,
        created_at: '2026-07-25 14:46:25',
        owner: { id: 802498, firstname: 'Paul', lastname: 'Tran Van ' },
        owner_id: 802498,
        name: 'Yaris ',
        archived_at: null,
        is_mileage_updatable: true,
      },
      // Present only in the snake payload.
      vehicle_id: 58697,
      tags: [],
      departure_address: {
        street: '21 Allée du Parc de la Bièvre',
        postal_code: '94240',
        city: "L'Haÿ-les-Roses",
        country: 'France',
      },
      arrival_company_name: 'Linagora',
      arrival_address: {
        street: '37 Rue Pierre Poli',
        postal_code: '92130',
        city: 'Issy-les-Moulineaux',
        country: 'France',
      },
      round_trip: false,
      is_used_by_expense_report: false,
    });
    // vehicleOwner exists only on the camel side.
    expect('vehicleOwner' in snake).toBe(false);
    expect('vehicle_owner' in snake).toBe(false);
  });

  it('carries the server-computed amount through, not the 0 we sent', () => {
    expect(toExpenseReportTravel(computedTravel()).estimated_amount).toBe(7.69);
  });
});

describe('buildExpenseReportPayload', () => {
  it('names and dates the report from the TRAVEL day, not from today', () => {
    const payload = buildExpenseReportPayload({
      travel: toExpenseReportTravel(computedTravel()),
      owner: OWNER,
    });
    expect(payload.name).toBe('Note de frais kilométrique du 22/07/2026');
    expect(payload.date).toBe('2026-07-22');
  });

  it('matches the captured expense_reports request envelope', () => {
    const payload = buildExpenseReportPayload({
      travel: toExpenseReportTravel(computedTravel()),
      owner: OWNER,
    });
    expect(payload).toMatchObject({
      id: null,
      owner: OWNER,
      advanced_expenses: [],
      comment: '',
      tags: [],
      payment_status: null,
      expense_type: 'travel',
      lifecycle_status: 'saved',
    });
    expect(payload.travels).toHaveLength(1);
  });

  it('keeps the French Tiime-side label whatever the app locale is', () => {
    const payload = buildExpenseReportPayload({
      travel: toExpenseReportTravel(computedTravel()),
      owner: OWNER,
    });
    expect(payload.name.startsWith('Note de frais kilométrique du ')).toBe(true);
  });
});

describe('endpoints', () => {
  it('fetches the vehicle from the accounts prefix, filtered by owner and date', async () => {
    const get = jest.fn(async () => ({ vehicles: [RAW_VEHICLE] }));
    const client = { get, post: jest.fn() } as any;

    const v = await fetchExpenseReportVehicle(client, {
      companyId: 243813,
      ownerId: 802498,
      vehicleId: 58697,
      nowMs: new Date(2026, 7, 5, 12, 0, 0).getTime(),
    });

    expect(v.id).toBe(58697);
    expect(get).toHaveBeenCalledWith(
      '/v1/accounts/companies/243813/expense_report_vehicles?owners=802498&date=%3C=2026-08-05'
    );
  });

  it('fails loudly when the configured vehicle is not offered for expense reports', async () => {
    const get = jest.fn(async () => ({ vehicles: [RAW_VEHICLE] }));
    const client = { get, post: jest.fn() } as any;

    await expect(
      fetchExpenseReportVehicle(client, {
        companyId: 243813,
        ownerId: 802498,
        vehicleId: 999,
        nowMs: Date.now(),
      })
    ).rejects.toThrow(/999/);
  });

  it('posts one travel to compute_travels_amount and returns the computed one', async () => {
    const computed = computedTravel();
    const post = jest.fn(async () => ({ travels: [computed], expense_report_id: null }));
    const client = { get: jest.fn(), post } as any;
    const dto = buildComputeTravelDto({
      travelId: 5561847,
      travel: TRAVEL_PAYLOAD,
      vehicle: RAW_VEHICLE,
    });

    const res = await computeTravelAmount(client, 243813, dto);

    expect(res.estimatedAmount).toBe(7.69);
    expect(post).toHaveBeenCalledWith('/v1/accounts/companies/243813/compute_travels_amount', {
      travels: [dto],
      expense_report_id: null,
    });
  });

  it('also reads a computed travel out of a bare array response', async () => {
    // Defensive, not evidence-based: the envelope is the only shape we have
    // captured, but a hard failure on a plausible variant costs a whole
    // build-and-test round trip to discover.
    expect(extractComputedTravel([computedTravel()])?.estimatedAmount).toBe(7.69);
  });

  it('returns null (never throws) on a response it cannot read', () => {
    expect(extractComputedTravel({ travels: [] })).toBeNull();
    expect(extractComputedTravel({ message: 'nope' })).toBeNull();
    expect(extractComputedTravel([])).toBeNull();
    expect(extractComputedTravel(null)).toBeNull();
  });

  it('posts the expense report to the captured path, expand included', async () => {
    const post = jest.fn(async () => ({ id: 4242 }));
    const client = { get: jest.fn(), post } as any;
    const payload = buildExpenseReportPayload({
      travel: toExpenseReportTravel(computedTravel()),
      owner: OWNER,
    });

    const res = await createExpenseReport(client, 243813, payload);

    expect(res.id).toBe(4242);
    expect(post).toHaveBeenCalledWith(
      '/v1/accounts/companies/243813/users/me/expense_reports?expand=preview_available',
      payload
    );
  });
});
