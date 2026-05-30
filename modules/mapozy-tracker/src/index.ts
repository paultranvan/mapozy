import { NativeModule, requireNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';
import type {
  TrackingConfig,
  TrackingStatus,
  LocationUpdate,
  ActivityUpdate,
  ActivityType,
  MotionState,
  StationaryUpdate,
} from './MapozyTracker.types';

interface MapozyTrackerEvents extends Record<string, (...args: any[]) => void> {
  onLocation: (event: LocationUpdate) => void;
  onActivity: (event: ActivityUpdate) => void;
  onStationary: (event: StationaryUpdate) => void;
}

declare class MapozyTrackerNativeModule extends NativeModule<MapozyTrackerEvents> {
  start(config: TrackingConfig): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  isTracking(): Promise<boolean>;
  getStatus(): Promise<TrackingStatus>;
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
}

const Native = requireNativeModule<MapozyTrackerNativeModule>('MapozyTracker');

export const MapozyTracker = {
  start: (cfg: TrackingConfig) => Native.start(cfg),
  stop: () => Native.stop(),
  restart: () => Native.restart(),
  isTracking: () => Native.isTracking(),
  getStatus: () => Native.getStatus(),
  isIgnoringBatteryOptimizations: () => Native.isIgnoringBatteryOptimizations(),
  requestIgnoreBatteryOptimizations: () => Native.requestIgnoreBatteryOptimizations(),
  addLocationListener: (cb: (l: LocationUpdate) => void): EventSubscription =>
    Native.addListener('onLocation', cb),
  addActivityListener: (cb: (a: ActivityUpdate) => void): EventSubscription =>
    Native.addListener('onActivity', cb),
  addStationaryListener: (cb: (s: StationaryUpdate) => void): EventSubscription =>
    Native.addListener('onStationary', cb),
};

export type {
  TrackingConfig,
  TrackingStatus,
  LocationUpdate,
  ActivityUpdate,
  ActivityType,
  MotionState,
  StationaryUpdate,
};
