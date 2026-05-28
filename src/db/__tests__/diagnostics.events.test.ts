import { DIAGNOSTIC_EVENTS } from '../diagnostics';

describe('DIAGNOSTIC_EVENTS', () => {
  it('exposes the survival/state/geofence/watchdog event types', () => {
    expect(DIAGNOSTIC_EVENTS.SVC_CREATE).toBe('svc_create');
    expect(DIAGNOSTIC_EVENTS.SVC_START_COMMAND).toBe('svc_start_command');
    expect(DIAGNOSTIC_EVENTS.SVC_DESTROY).toBe('svc_destroy');
    expect(DIAGNOSTIC_EVENTS.SVC_TASK_REMOVED).toBe('svc_task_removed');
    expect(DIAGNOSTIC_EVENTS.BOOT).toBe('boot');
    expect(DIAGNOSTIC_EVENTS.STATE_MOVING).toBe('state_moving');
    expect(DIAGNOSTIC_EVENTS.STATE_STATIONARY).toBe('state_stationary');
    expect(DIAGNOSTIC_EVENTS.GEOFENCE_ARMED).toBe('geofence_armed');
    expect(DIAGNOSTIC_EVENTS.GEOFENCE_EXIT).toBe('geofence_exit');
    expect(DIAGNOSTIC_EVENTS.GEOFENCE_ERROR).toBe('geofence_error');
    expect(DIAGNOSTIC_EVENTS.WATCHDOG_FIRE).toBe('watchdog_fire');
    expect(DIAGNOSTIC_EVENTS.WATCHDOG_RESTART).toBe('watchdog_restart');
    expect(DIAGNOSTIC_EVENTS.ENV_SNAPSHOT).toBe('env_snapshot');
  });
});
